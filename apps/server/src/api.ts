import express from "express";
import multer from "multer";
import path from "node:path";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import * as shared from "@inv/shared";

import { HttpError } from "./errors.js";
import {
  db,
  txn,
  newId,
  getMeta,
  setMeta,
  changeSeq,
  PHOTOS_DIR,
} from "./db.js";
import * as auth from "./auth.js";
import { applyOnce } from "./ops.js";

export const api = express.Router();
api.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(PHOTOS_DIR, { recursive: true });
      cb(null, PHOTOS_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`);
    },
  }),
  limits: { fileSize: 16 * 1024 * 1024 }, // gallery picks on Apple upload originals (with ICC profile)
});

/* ---------- helpers ---------- */

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : fallback;
const int = (v: unknown): number => {
  const n = typeof v === "number" ? Math.floor(v) : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
};
const reqInt = (v: unknown, what: string): number => {
  const n = int(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(`Invalid ${what}`, 400);
  return n;
};

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

function h(fn: Handler): Handler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: "Internal error" });
      }
    });
  };
}

/* ---------- product mapping ---------- */

function productQty(productId: string): { qty: Record<string, number>; ids: Record<string, number>; total: number } {
  const rows = db
    .prepare("SELECT color_id, size_id, qty, id FROM variants WHERE product_id = ?")
    .all(productId) as { color_id: number; size_id: number; qty: number; id: number }[];
  const qty: Record<string, number> = {};
  const ids: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const key = `${r.color_id}|${r.size_id}`;
    qty[key] = r.qty;
    ids[key] = r.id;
    total += r.qty;
  }
  return { qty, ids, total };
}

function toSummary(row: any): shared.ProductSummary {
  const sizes = db
    .prepare("SELECT id, label, price FROM sizes WHERE product_id = ? ORDER BY sort")
    .all(row.id) as { id: number; label: string; price: number }[];
  const prices = sizes.map((s) => s.price);
  const { total } = productQty(row.id);
  return {
    id: row.id,
    brand: row.brand,
    type: row.type,
    name: row.name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: !!row.archived,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    totalQty: total,
    lowQty: total > 0 && total <= shared.LOW_QTY_THRESHOLD,
    outQty: total === 0,
  };
}

function toFull(row: any): shared.ProductFull {
  const summary = toSummary(row);
  const sizes = db
    .prepare("SELECT id, label, price FROM sizes WHERE product_id = ? ORDER BY sort, id")
    .all(row.id) as any[];
  const colors = (
    db
      .prepare("SELECT id, name FROM colors WHERE product_id = ? ORDER BY sort, id")
      .all(row.id) as { id: number; name: string }[]
  ).map((c) => ({
    id: c.id,
    name: c.name,
    photoIds: [] as number[],
    photos: [] as shared.PhotoInfo[],
  }));
  const photos = db
    .prepare(
      `SELECT p.id, p.filename, p.color_id FROM photos p
       JOIN colors c ON c.id = p.color_id WHERE c.product_id = ? ORDER BY p.sort, p.id`
    )
    .all(row.id) as { id: number; filename: string; color_id: number }[];
  for (const p of photos) {
    const c = colors.find((x) => x.id === p.color_id);
    if (c) {
      c.photoIds.push(p.id);
      c.photos.push({ id: p.id, filename: p.filename, url: `/photos/${p.filename}` });
    }
  }
  const { qty, ids } = productQty(row.id);
  return {
    ...summary,
    sizes: sizes.map((s) => ({ id: s.id, label: s.label, price: s.price })),
    colors,
    qty,
    variantIds: ids,
  };
}

async function productById(id: string): Promise<any> {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!row) throw new HttpError("Product not found", 404);
  return row;
}

/* ---------- meta / health ---------- */

api.get("/health", (_req, res) => {
  res.json({ ok: true, paired: auth.deviceCount() > 0 });
});

api.get("/pair-info", h(async (_req, res) => res.json(auth.pairInfo())));

api.post("/pair", h(async (req, res) => {
  const token = auth.pairWithCode(str(req.body?.code), str(req.body?.name));
  res.json({ token });
}));

api.get("/seq", h(async (req, res) => {
  res.json({ seq: changeSeq() });
}));

/* ---------- products ---------- */

api.get("/products", auth.requireDevice, h(async (req, res) => {
  const q = str(req.query.q).toLowerCase();
  const archived = str(req.query.archived) === "1";
  const limit = Math.min(reqInt(req.query.limit ?? 60, "limit") || 60, 200);
  const offset = reqInt(req.query.offset ?? 0, "offset");

  let rows: any[];
  if (q) {
    /* every word must match somewhere (fields OR color names) */
    const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
    const conds = words
      .map(
        () =>
          `(LOWER(p.brand) LIKE '%'||?||'%' OR LOWER(p.type) LIKE '%'||?||'%'
        OR LOWER(p.name) LIKE '%'||?||'%' OR LOWER(p.notes) LIKE '%'||?||'%'
        OR LOWER(c.name) LIKE '%'||?||'%')`
      )
      .join(" AND ");
    const params: any[] = [];
    for (const w of words) params.push(w, w, w, w, w);
    rows = db
      .prepare(
        `SELECT DISTINCT p.* FROM products p
         LEFT JOIN colors c ON c.product_id = p.id
         WHERE p.archived = ? AND ${conds}
         ORDER BY p.created_at DESC, p.id
         LIMIT ? OFFSET ?`
      )
      .all(archived ? 1 : 0, ...params, limit, offset);
  } else {
    rows = db
      .prepare("SELECT * FROM products WHERE archived = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?")
      .all(archived ? 1 : 0, limit, offset);
  }

  /* card enrichment: one query for all listed products' first-photo-per-color,
   * plus sizes + per-variant stock so cards can drive a size dropdown */
  type CardExtra = {
    colorNames: string[];
    colorIds: number[];
    thumbs: string[];
    sizes: shared.SizeDef[];
    variantQty: Record<string, number>;
  };
  const ids = rows.map((r: any) => r.id as string);
  const thumbsById = new Map<string, CardExtra>();
  for (const pid of ids)
    thumbsById.set(pid, { colorNames: [], colorIds: [], thumbs: [], sizes: [], variantQty: {} });
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const colorRows = db
      .prepare(`SELECT id, product_id, name FROM colors WHERE product_id IN (${placeholders}) ORDER BY sort, id`)
      .all(...ids) as { id: number; product_id: string; name: string }[];
    const colorFirst = new Map<number, string>();
    if (colorRows.length) {
      const photoRows = db
        .prepare(
          `SELECT color_id, filename FROM photos
           WHERE color_id IN (${colorRows.map(() => "?").join(",")})
           ORDER BY sort, id`
        )
        .all(...colorRows.map((c) => c.id)) as { color_id: number; filename: string }[];
      for (const pr of photoRows) if (!colorFirst.has(pr.color_id)) colorFirst.set(pr.color_id, pr.filename);
    }
    for (const c of colorRows) {
      const entry = thumbsById.get(c.product_id);
      if (!entry) continue;
      entry.colorNames.push(c.name);
      entry.colorIds.push(c.id);
      entry.thumbs.push(colorFirst.get(c.id) ?? "");
    }
    /* sizes + per-variant stock for the same products (card size dropdown) */
    const sizeRows = db
      .prepare(`SELECT product_id, id, label, price FROM sizes WHERE product_id IN (${placeholders}) ORDER BY sort, id`)
      .all(...ids) as { product_id: string; id: number; label: string; price: number }[];
    for (const s of sizeRows)
      thumbsById.get(s.product_id)?.sizes.push({ id: s.id, label: s.label, price: s.price });
    const variantRows = db
      .prepare(`SELECT product_id, color_id, size_id, qty FROM variants WHERE product_id IN (${placeholders})`)
      .all(...ids) as { product_id: string; color_id: number; size_id: number; qty: number }[];
    for (const v of variantRows) {
      const entry = thumbsById.get(v.product_id);
      if (entry) entry.variantQty[`${v.color_id}|${v.size_id}`] = v.qty;
    }
  }

  res.json(
    rows.map((r: any) => ({
      ...toSummary(r),
      ...(thumbsById.get(r.id) ?? { colorNames: [], colorIds: [], thumbs: [], sizes: [], variantQty: {} }),
    }))
  );
}));

api.get("/products/:id", auth.requireDevice, h(async (req, res) => {
  res.json(toFull(await productById(req.params.id)));
}));

function createProduct(body: any): string {
  const name = str(body.name);
  if (!name) throw new HttpError("name required", 400);
  const sizes: { label: string; price: number }[] = Array.isArray(body.sizes)
    ? body.sizes.map((s: any) => ({ label: str(s.label), price: reqInt(s.price, "price") }))
    : [];
  const colors: { name: string; photoIds: number[] }[] = Array.isArray(body.colors)
    ? body.colors.map((c: any) => ({ name: str(c.name), photoIds: Array.isArray(c.photoIds) ? c.photoIds.map(int) : [] }))
    : [];
  if (sizes.length === 0) throw new HttpError("At least one size required", 400);
  if (colors.length === 0) throw new HttpError("At least one color required", 400);
  const id = newId();
  const now = Date.now();
  txn(() => {
    db.prepare(
      "INSERT INTO products (id, brand, type, name, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, str(body.brand), str(body.type), name, str(body.notes), now, now);

    // sizes first
    const sizeIds: number[] = [];
    for (const [i, s] of sizes.entries()) {
      const r = db
        .prepare("INSERT INTO sizes (product_id, label, price, sort) VALUES (?,?,?,?)")
        .run(id, s.label || "Free", s.price, i);
      sizeIds.push(Number(r.lastInsertRowid));
    }

    // colors, photo attachment, and one variant per color×size
    for (const [i, c] of colors.entries()) {
      const cid = db
        .prepare("INSERT INTO colors (product_id, name, sort) VALUES (?,?,?)")
        .run(id, c.name || "Default", i);
      const colorId = Number(cid.lastInsertRowid);
      for (const [pi, pid] of c.photoIds.entries()) {
        db.prepare("UPDATE photos SET color_id = ?, sort = ? WHERE id = ?").run(colorId, pi, pid);
      }
      for (const sizeId of sizeIds) {
        db.prepare("INSERT INTO variants (product_id, color_id, size_id) VALUES (?,?,?)").run(
          id,
          colorId,
          sizeId
        );
      }
    }
  });
  return id;
}

api.post("/products", auth.requireDevice, h(async (req, res) => {
  const id = createProduct(req.body ?? {});
  res.json({ id });
}));

api.patch("/products/:id", auth.requireDevice, h(async (req, res) => {
  const row = await productById(req.params.id);
  const b = req.body ?? {};
  txn(() => {
    db.prepare(
      `UPDATE products SET brand = ?, type = ?, name = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(
      b.brand !== undefined ? str(b.brand) : row.brand,
      b.type !== undefined ? str(b.type) : row.type,
      b.name !== undefined ? str(b.name) : row.name,
      b.notes !== undefined ? str(b.notes) : row.notes,
      Date.now(),
      row.id
    );
    if (Array.isArray(b.sizes)) {
      for (const s of b.sizes) {
        if (s.id !== undefined) {
          db.prepare("UPDATE sizes SET label = ?, price = ? WHERE id = ? AND product_id = ?").run(
            str(s.label),
            reqInt(s.price, "price"),
            int(s.id),
            row.id
          );
        } else if (str(s.label)) {
          const r = db
            .prepare("INSERT INTO sizes (product_id, label, price, sort) VALUES (?,?,?,?)")
            .run(row.id, str(s.label), reqInt(s.price, "price"), 999);
          const sizeId = Number(r.lastInsertRowid);
          db.prepare(
            "INSERT OR IGNORE INTO variants (product_id, color_id, size_id) SELECT ?, id, ? FROM colors WHERE product_id = ?"
          ).run(row.id, sizeId, row.id);
        }
      }
    }
  });
  res.json({ id: row.id });
}));

api.post("/products/:id/archive", auth.requireDevice, h(async (req, res) => {
  const row = await productById(req.params.id);
  txn(() =>
    db.prepare("UPDATE products SET archived = ?, updated_at = ? WHERE id = ?").run(
      req.body?.archived === false ? 0 : 1,
      Date.now(),
      row.id
    )
  );
  res.json({ ok: true });
}));

api.delete("/products/:id", auth.requireDevice, h(async (req, res) => {
  const row = await productById(req.params.id);
  /* real sales must survive books — product with sales can only be archived */
  const saleCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM sale_lines sl JOIN variants v ON v.id = sl.variant_id WHERE v.product_id = ?"
      )
      .get(row.id) as { n: number }
  ).n;
  if (saleCount > 0) {
    throw new HttpError(
      "This product has sales records — archive it instead (sales history stays intact)",
      409
    );
  }
  /* deletable product: purge its stock-in/adjust movements too (they describe
   * the product's life; once the product is gone they mean nothing), then let
   * the cascade remove colors/sizes/variants/photo rows */
  const files = db
    .prepare("SELECT filename FROM photos WHERE color_id IN (SELECT id FROM colors WHERE product_id = ?)")
    .all(row.id) as { filename: string }[];
  txn(() => {
    db.prepare("DELETE FROM movements WHERE product_id = ?").run(row.id);
    db.prepare("DELETE FROM products WHERE id = ?").run(row.id);
  });
  for (const f of files) {
    try {
      unlinkSync(path.join(PHOTOS_DIR, f.filename));
    } catch {
      /* file already gone */
    }
  }
  res.json({ ok: true });
}));

/* ---------- color / photo management ---------- */

api.post("/products/:id/colors", auth.requireDevice, h(async (req, res) => {
  const row = await productById(req.params.id);
  const name = str(req.body?.name) || "Default";
  const count =
    (db.prepare("SELECT COUNT(*) AS n FROM colors WHERE product_id = ?").get(row.id) as { n: number }).n;
  txn(() => {
    const r = db.prepare("INSERT INTO colors (product_id, name, sort) VALUES (?,?,?)").run(row.id, name, count);
    const colorId = Number(r.lastInsertRowid);
    db.prepare(
      "INSERT INTO variants (product_id, color_id, size_id) SELECT ?, ?, id FROM sizes WHERE product_id = ?"
    ).run(row.id, colorId, row.id);
    res.locals = { colorId };
  });
  res.json({ colorId: res.locals?.colorId ?? 0 });
}));

api.patch("/colors/:id", auth.requireDevice, h(async (req, res) => {
  const name = str(req.body?.name);
  txn(() => db.prepare("UPDATE colors SET name = ? WHERE id = ?").run(name, int(req.params.id)));
  res.json({ ok: true });
}));

api.delete("/colors/:id", auth.requireDevice, h(async (req, res) => {
  const row = db.prepare("SELECT product_id FROM colors WHERE id = ?").get(int(req.params.id)) as any;
  if (!row) throw new HttpError("Color not found", 404);
  const remaining =
    (db.prepare("SELECT COUNT(*) AS n FROM colors WHERE product_id = ?").get(row.product_id) as { n: number }).n;
  if (remaining <= 1) throw new HttpError("A product needs at least one color", 400);
  txn(() => db.prepare("DELETE FROM colors WHERE id = ?").run(int(req.params.id)));
  res.json({ ok: true });
}));

api.post("/photos", auth.requireDevice, upload.single("photo"), h(async (req, res) => {
  /* colorId omitted/0 = photo starts unattached (used when building a new product) */
  const colorId = reqInt(req.body?.colorId ?? 0, "colorId");
  const file = req.file as Express.Multer.File | undefined;
  if (!file) throw new HttpError("photo file required", 400);
  if (!existsSync(file.path)) throw new HttpError("upload failed", 500);
  const nextSort =
    (db
      .prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM photos WHERE color_id = ?")
      .get(colorId) as { s: number }).s;
  const r = db
    .prepare("INSERT INTO photos (color_id, filename, sort, created_at) VALUES (?,?,?,?)")
    .run(colorId || null, path.basename(file.filename), nextSort, Date.now());
  txn(() => void 0); // bump change seq
  res.json({ id: Number(r.lastInsertRowid), filename: path.basename(file.filename) });
}));

api.delete("/photos/:id", auth.requireDevice, h(async (req, res) => {
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(int(req.params.id)) as any;
  if (!row) throw new HttpError("Photo not found", 404);
  txn(() => db.prepare("DELETE FROM photos WHERE id = ?").run(row.id));
  const p = path.join(PHOTOS_DIR, row.filename);
  try {
    unlinkSync(p);
  } catch {
    /* file already gone */
  }
  res.json({ ok: true });
}));

/* after crop: attach + reorder share one endpoint; also joins unattached photos to a color */
api.post("/photos/attach", auth.requireDevice, h(async (req, res) => {
  const photoIds: number[] = Array.isArray(req.body?.photoIds) ? req.body.photoIds.map(int) : [];
  const colorId = reqInt(req.body?.colorId, "colorId");
  if (photoIds.length === 0) throw new HttpError("photoIds required", 400);
  const color = db.prepare("SELECT id FROM colors WHERE id = ?").get(colorId) as { id: number } | undefined;
  if (!color) throw new HttpError("Color not found", 404);
  txn(() => {
    for (const [i, id] of photoIds.entries()) {
      db.prepare("UPDATE photos SET color_id = ?, sort = ? WHERE id = ?").run(colorId, i, id);
    }
  });
  res.json({ ok: true });
}));

api.post("/photos/reorder", auth.requireDevice, h(async (req, res) => {
  const order: number[] = Array.isArray(req.body?.photoIds) ? req.body.photoIds.map(int) : [];
  txn(() => {
    for (const [i, id] of order.entries())
      db.prepare("UPDATE photos SET sort = ? WHERE id = ?").run(i, id);
  });
  res.json({ ok: true });
}));

/* ---------- movements ---------- */

interface VariantRow {
  id: number;
  product_id: string;
  color_id: number;
  size_id: number;
  qty: number;
}

function variantById(id: number): VariantRow {
  const row = db.prepare("SELECT * FROM variants WHERE id = ?").get(id) as VariantRow | undefined;
  if (!row) throw new HttpError("Variant not found", 404);
  return row;
}

function namesFor(variant: VariantRow): { productName: string; colorName: string; sizeLabel: string; brand: string } {
  const color = db.prepare("SELECT name FROM colors WHERE id = ?").get(variant.color_id) as { name: string };
  const size = db.prepare("SELECT label FROM sizes WHERE id = ?").get(variant.size_id) as { label: string };
  const prod = db.prepare("SELECT name, brand FROM products WHERE id = ?").get(variant.product_id) as {
    name: string;
    brand: string;
  };
  return { productName: prod.name, colorName: color?.name ?? "", sizeLabel: size?.label ?? "", brand: prod?.brand ?? "" };
}

function movementStmt(): any {
  return db.prepare(
    `INSERT INTO movements (at, type, variant_id, product_id, delta, note, sale_id, device_id)
     VALUES (?,?,?,?,?,?,?,?)`
  );
}

api.post("/movements/stock-in", auth.requireDevice, h(async (req, res) => {
  const variantId = reqInt(req.body?.variantId, "variantId");
  const qty = reqInt(req.body?.qty, "qty");
  if (qty <= 0) throw new HttpError("qty must be positive", 400);
  const note = str(req.body?.note);
  applyOnce(req.body?.__op, "stock-in", () => {
    txn(() => {
      const v = variantById(variantId);
      const n = namesFor(v);
      db.prepare("UPDATE variants SET qty = qty + ? WHERE id = ?").run(qty, v.id);
      movementStmt().run(
        Date.now(),
        "stock-in",
        v.id,
        v.product_id,
        qty,
        note,
        null,
        (req as any).device?.id ?? null
      );
    });
  });
  res.json({ ok: true });
}));

api.post("/movements/adjust", auth.requireDevice, h(async (req, res) => {
  const variantId = reqInt(req.body?.variantId, "variantId");
  const setTo = reqInt(req.body?.setTo, "setTo");
  const note = str(req.body?.note);
  applyOnce(req.body?.__op, "adjust", () => {
    txn(() => {
      const v = variantById(variantId);
      const delta = setTo - v.qty;
      if (delta === 0) return;
      const n = namesFor(v);
      db.prepare("UPDATE variants SET qty = ? WHERE id = ?").run(setTo, v.id);
      movementStmt().run(
        Date.now(),
        "adjust",
        v.id,
        v.product_id,
        delta,
        note || "Adjust",
        null,
        (req as any).device?.id ?? null
      );
    });
  });
  res.json({ ok: true });
}));

/* ---------- sales / customers ---------- */

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function findOrCreateCustomer(body: any): { id: string; name: string; phone: string } {
  const name = str(body.customerName);
  const phone1 = str(body.phone1);
  const phone2 = str(body.phone2);
  const notes = str(body.customerNotes);
  if (body.customerId) {
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(str(body.customerId)) as any;
    if (row) {
      /* notes provided at sale time and the record has none: capture them */
      if (notes && !row.notes) {
        db.prepare("UPDATE customers SET notes = ? WHERE id = ?").run(notes, row.id);
      }
      return { id: row.id, name: row.name, phone: row.phone1 || row.phone2 };
    }
  }
  if (name) {
    const all = db.prepare("SELECT * FROM customers").all() as any[];
    const d1 = digits(phone1);
    const byPhone = d1
      ? all.find((c) => digits(c.phone1).endsWith(d1.slice(-4)) || digits(c.phone2).endsWith(d1.slice(-4)))
      : undefined;
    const found = byPhone ?? all.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) {
      if (phone1 && !found.phone1) {
        db.prepare("UPDATE customers SET phone1 = ? WHERE id = ?").run(phone1, found.id);
      }
      if (notes && !found.notes) {
        db.prepare("UPDATE customers SET notes = ? WHERE id = ?").run(notes, found.id);
      }
      return { id: found.id, name: found.name, phone: found.phone1 || found.phone2 || phone1 };
    }
  }
  const id = newId();
  db.prepare(
    "INSERT INTO customers (id, name, phone1, phone2, notes, created_at) VALUES (?,?,?,?,?,?)"
  ).run(id, name || "Walk-in", phone1, phone2, notes, Date.now());
  return { id, name: name || "Walk-in", phone: phone1 };
}

api.post("/sales", auth.requireDevice, h(async (req, res) => {
  const lines: { variantId: number; qty: number }[] = Array.isArray(req.body?.lines)
    ? req.body.lines.map((l: any) => ({ variantId: reqInt(l.variantId, "variantId"), qty: reqInt(l.qty, "qty") }))
    : [];
  if (lines.length === 0) throw new HttpError("Empty sale", 400);
  const discount = Math.max(0, reqInt(req.body?.discount ?? 0, "discount") || 0);

  const agg = new Map<number, number>();
  for (const l of lines) agg.set(l.variantId, (agg.get(l.variantId) ?? 0) + l.qty);

  /* Operation ID → applied exactly once; repeat submissions get the original sale */
  const saleId = applyOnce(req.body?.__op, "sale", () => {
    const saleId = newId();
    txn(() => {
      // stock check first — all-or-nothing; also totals the bill at true prices
      let itemsTotal = 0;
      for (const [vid, q] of agg) {
        const v = variantById(vid);
        if (v.qty < q) {
          const n = namesFor(v);
          throw new HttpError(`Not enough stock: ${n.productName} ${n.colorName} ${n.sizeLabel}`, 409);
        }
        itemsTotal += q * (db.prepare("SELECT price FROM sizes WHERE id = ?").get(v.size_id) as { price: number }).price;
      }
      if (discount > itemsTotal) {
        throw new HttpError(`Discount (Ks ${discount.toLocaleString("en-US")}) exceeds the bill total (Ks ${itemsTotal.toLocaleString("en-US")})`, 400);
      }
      const cust = findOrCreateCustomer(req.body ?? {});
      const at = Date.now();
      db.prepare(
        "INSERT INTO sales (id, customer_id, customer_name, customer_phone, customer_notes, discount, at) VALUES (?,?,?,?,?,?,?)"
      ).run(saleId, cust.id || null, cust.name, cust.phone, str(req.body?.customerNotes), discount, at);

      const lineStmt = db.prepare(
        `INSERT INTO sale_lines
         (sale_id, variant_id, product_id, product_name, brand, color_name, size_label, qty, price)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      for (const [vid, q] of agg) {
        const v = variantById(vid);
        const n = namesFor(v);
        const sizePrice = (
          db.prepare("SELECT price FROM sizes WHERE id = ?").get(v.size_id) as { price: number }
        ).price;
        lineStmt.run(saleId, v.id, v.product_id, n.productName, n.brand, n.colorName, n.sizeLabel, q, sizePrice);
        db.prepare("UPDATE variants SET qty = qty - ? WHERE id = ?").run(q, v.id);
        movementStmt().run(at, "sale", v.id, v.product_id, -q, "", saleId, (req as any).device?.id ?? null);
      }
    });
    return saleId;
  });
  const sale = (await getSale(saleId))!;
  res.json(sale);
}));

api.get("/sales", auth.requireDevice, h(async (req, res) => {
  const limit = Math.min(reqInt(req.query.limit ?? "60", "limit") || 60, 200);
  const ids = db.prepare("SELECT id FROM sales ORDER BY at DESC LIMIT ?").all(limit) as { id: string }[];
  const out: shared.Sale[] = [];
  for (const s of ids) {
    const sale = await getSale(s.id);
    if (sale) out.push(sale);
  }
  res.json(out);
}));

async function getSale(id: string): Promise<shared.Sale | undefined> {  const row = db.prepare("SELECT * FROM sales WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  const lines = db.prepare("SELECT * FROM sale_lines WHERE sale_id = ?").all(id) as any[];
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const discount = Math.max(0, row.discount ?? 0);
  const returnedQty = lines.reduce((a, l) => a + l.returned, 0);
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerNotes: row.customer_notes ?? "",
    at: row.at,
    total,
    discount,
    payable: total - discount,
    returnedQty,
    lines: lines.map((l) => ({
      id: l.id,
      saleId: l.sale_id,
      variantId: l.variant_id,
      productId: l.product_id,
      productName: l.product_name,
      brand: l.brand,
      colorName: l.color_name,
      sizeLabel: l.size_label,
      qty: l.qty,
      price: l.price,
      returned: l.returned,
    })),
  };
}

api.post("/sales/:id/return", auth.requireDevice, h(async (req, res) => {
  const saleId = req.params.id;
  const retLines: { saleLineId: number; qty: number }[] = Array.isArray(req.body?.lines)
    ? req.body.lines.map((l: any) => ({ saleLineId: reqInt(l.saleLineId, "saleLineId"), qty: reqInt(l.qty, "qty") }))
    : [];
  if (retLines.length === 0) throw new HttpError("Empty return", 400);
  const note = str(req.body?.note);
  applyOnce(req.body?.__op, "return", () => {
    txn(() => {
      for (const rl of retLines) {
        const line = db.prepare("SELECT * FROM sale_lines WHERE id = ? AND sale_id = ?").get(rl.saleLineId, saleId) as any;
        if (!line) throw new HttpError("Sale line not found", 404);
        const remaining = line.qty - line.returned;
        if (rl.qty <= 0 || rl.qty > remaining)
          throw new HttpError(`Invalid return qty (remaining ${remaining})`, 400);
        db.prepare("UPDATE sale_lines SET returned = returned + ? WHERE id = ?").run(rl.qty, line.id);
        const v = variantById(line.variant_id);
        db.prepare("UPDATE variants SET qty = qty + ? WHERE id = ?").run(rl.qty, v.id);
        movementStmt().run(
          Date.now(),
          "return",
          line.variant_id,
          line.product_id,
          rl.qty,
          note || "Return",
          saleId,
          (req as any).device?.id ?? null
        );
      }
    });
  });
  res.json((await getSale(saleId))!);
}));

/* ---------- customers ---------- */

api.get("/customers", auth.requireDevice, h(async (req, res) => {
  const q = str(req.query.q).toLowerCase();
  const qd = digits(q);
  let rows = db.prepare("SELECT * FROM customers ORDER BY name COLLATE NOCASE").all() as any[];
  if (q) {
    rows = rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (qd.length >= 3 && (digits(c.phone1).includes(qd) || digits(c.phone2).includes(qd)))
    );
  }
  res.json(
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone1: c.phone1,
      phone2: c.phone2,
      notes: c.notes ?? "",
      createdAt: c.created_at,
    }))
  );
}));

api.get("/customers/:id", auth.requireDevice, h(async (req, res) => {
  const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as any;
  if (!c) throw new HttpError("Customer not found", 404);
  const sales = db.prepare("SELECT id FROM sales WHERE customer_id = ? ORDER BY at DESC").all(c.id) as any[];
  const full: shared.Sale[] = [];
  for (const s of sales) {
    const sale = await getSale(s.id);
    if (sale) full.push(sale);
  }
  res.json({ customer: { id: c.id, name: c.name, phone1: c.phone1, phone2: c.phone2, notes: c.notes ?? "", createdAt: c.created_at }, sales: full });
}));

api.post("/customers", auth.requireDevice, h(async (req, res) => {
  const name = str(req.body?.name);
  if (!name) throw new HttpError("Name required", 400);
  const id = newId();
  txn(() =>
    db.prepare("INSERT INTO customers (id, name, phone1, phone2, notes, created_at) VALUES (?,?,?,?,?,?)").run(
      id,
      name,
      str(req.body?.phone1),
      str(req.body?.phone2),
      str(req.body?.notes),
      Date.now()
    )
  );
  res.json({ id });
}));

api.delete("/customers/:id", auth.requireDevice, h(async (req, res) => {
  const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as any;
  if (!c) throw new HttpError("Customer not found", 404);
  const sold = (
    db.prepare("SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?").get(c.id) as { n: number }
  ).n;
  if (sold > 0) {
    throw new HttpError("Customer has sales — edit instead of deleting", 409);
  }
  txn(() => db.prepare("DELETE FROM customers WHERE id = ?").run(c.id));
  res.json({ ok: true });
}));

api.patch("/customers/:id", auth.requireDevice, h(async (req, res) => {
  const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as any;
  if (!c) throw new HttpError("Customer not found", 404);
  txn(() =>
    db.prepare("UPDATE customers SET name = ?, phone1 = ?, phone2 = ?, notes = ? WHERE id = ?").run(
      req.body?.name !== undefined ? str(req.body.name) : c.name,
      req.body?.phone1 !== undefined ? str(req.body.phone1) : c.phone1,
      req.body?.phone2 !== undefined ? str(req.body.phone2) : c.phone2,
      req.body?.notes !== undefined ? str(req.body.notes) : c.notes,
      c.id
    )
  );
  res.json({ ok: true });
}));

/* ---------- product history ---------- */

api.get("/products/:id/history", auth.requireDevice, h(async (req, res) => {
  const product = await productById(req.params.id);
  const movs = db
    .prepare(
      `SELECT m.*, c.name AS color_name, s.label AS size_label FROM movements m
       JOIN variants v ON v.id = m.variant_id
       JOIN colors c ON c.id = v.color_id
       JOIN sizes s ON s.id = v.size_id
       WHERE m.product_id = ? ORDER BY m.at DESC, m.id DESC LIMIT 200`
    )
    .all(product.id) as any[];
  const saleIds = (
    db
      .prepare("SELECT DISTINCT sale_id FROM movements WHERE product_id = ? AND sale_id IS NOT NULL")
      .all(product.id) as { sale_id: string }[]
  ).map((r) => r.sale_id);
  const sales: shared.Sale[] = [];
  for (const sid of saleIds) {
    const sale = await getSale(sid);
    if (sale) sales.push(sale);
  }
  const lineInfo = new Map<number, { type: string; saleId: string | null }>();
  for (const m of movs) lineInfo.set(m.id, { type: m.type, saleId: m.sale_id });
  res.json({
    movements: movs.map((m) => ({
      id: m.id,
      at: m.at,
      type: m.type,
      productName: product.name,
      colorName: m.color_name,
      sizeLabel: m.size_label,
      delta: m.delta,
      note: m.note,
      saleId: m.sale_id,
    })),
    sales,
  });
}));

/* ---------- devices / settings / backup ---------- */

api.get("/devices", auth.requireDevice, h(async (_req, res) => {
  res.json(auth.listDevices());
}));

api.delete("/devices/:id", auth.requireDevice, h(async (req, res) => {
  auth.revokeDevice(int(req.params.id));
  res.json({ ok: true });
}));

api.post("/pairing/regenerate", auth.requireDeviceOrLocal, h(async (_req, res) => {
  res.json({ code: auth.regeneratePairingCode() });
}));

api.get("/settings", auth.requireDevice, h(async (_req, res) => {
  res.json({ shopName: getMeta("shop_name", "TH Fashion") });
}));

api.patch("/settings", auth.requireDevice, h(async (req, res) => {
  if (req.body?.shopName !== undefined) {
    txn(() => setMeta("shop_name", str(req.body.shopName)));
  }
  res.json({ ok: true });
}));

/* ---------- backup routes are wired in backup.ts ---------- */
import { registerBackupRoutes, startBackupJob } from "./backup.js";
registerBackupRoutes(api, auth.requireDevice);
export { startBackupJob };
