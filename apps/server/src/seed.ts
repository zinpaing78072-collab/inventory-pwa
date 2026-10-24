/* Dev-only seed: reproduces the prototype's mock shop (12 products, 3 customers,
 * 4 sales) using the prototype's photos. Run: pnpm seed
 * Wipes all inventory data and devices, keeps the schema. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, rmSync, copyFileSync } from "node:fs";

import { db, txn, newId, PHOTOS_DIR, DATA_DIR } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_ASSETS = path.join(__dirname, "..", "seed-assets");

if (!readdirSync(SEED_ASSETS).length) {
  console.error("No seed assets found in apps/server/seed-assets");
  process.exit(1);
}

const DAY = 86_400_000;
const now = Date.now();

/* reset: all rows out, photos dir emptied, photos re-copied from seed assets */
for (const t of ["movements", "sale_lines", "sales", "variants", "photos", "colors", "sizes", "products", "customers", "devices"]) {
  db.exec(`DELETE FROM ${t}`);
}
rmSync(PHOTOS_DIR, { recursive: true, force: true });
import { mkdirSync } from "node:fs";
mkdirSync(PHOTOS_DIR, { recursive: true });

interface SeedProd {
  id: string;
  brand: string;
  type: string;
  name: string;
  notes: string;
  colors: { name: string; photo: string }[];
  sizes: { label: string; price: number }[];
  qty: Record<string, number>; // "Color|Size"
  createdDaysAgo: number;
}

const P: SeedProd[] = [
  { id: "gown", brand: "ZARA", type: "Dress", name: "Satin maxi gown", notes: "Supplier: Classic Fashion (Yangon). Dry clean.",
    colors: [{ name: "Red", photo: "red-satin-gown.jpg" }, { name: "Blue", photo: "blue-maxi-dress.jpg" }],
    sizes: [{ label: "S", price: 78000 }, { label: "M", price: 85000 }, { label: "L", price: 95000 }],
    qty: { "Red|S": 2, "Red|M": 1, "Red|L": 0, "Blue|S": 0, "Blue|M": 2, "Blue|L": 3 }, createdDaysAgo: 40 },
  { id: "floral", brand: "Micca", type: "Dress", name: "Floral midi dress", notes: "Best seller around Thingyan.",
    colors: [{ name: "Red floral", photo: "red-floral-midi.jpg" }, { name: "White", photo: "white-ruffle-mini.jpg" }],
    sizes: [{ label: "S", price: 52000 }, { label: "M", price: 52000 }, { label: "L", price: 58000 }],
    qty: { "Red floral|S": 3, "Red floral|M": 2, "Red floral|L": 1, "White|M": 1 }, createdDaysAgo: 35 },
  { id: "crewtee", brand: "Uniqlo", type: "Top", name: "Cotton crew tee", notes: "Restock monthly.",
    colors: [{ name: "White", photo: "white-basic-tee.jpg" }, { name: "Black", photo: "black-basic-tee.jpg" }],
    sizes: [{ label: "S", price: 18000 }, { label: "M", price: 18000 }, { label: "L", price: 20000 }],
    qty: { "White|S": 5, "White|M": 3, "White|L": 2, "Black|S": 2, "Black|M": 0, "Black|L": 4 }, createdDaysAgo: 90 },
  { id: "blazerdress", brand: "H&M", type: "Dress", name: "Blazer mini dress", notes: "",
    colors: [{ name: "Ivory", photo: "ivory-blazer-dress.jpg" }],
    sizes: [{ label: "S", price: 62000 }, { label: "M", price: 62000 }, { label: "L", price: 70000 }],
    qty: { "Ivory|S": 1, "Ivory|M": 0 }, createdDaysAgo: 20 },
  { id: "cattee", brand: "Kikoi", type: "Top", name: "Lucky cat graphic tee", notes: "",
    colors: [{ name: "Beige", photo: "beige-cat-tee.jpg" }],
    sizes: [{ label: "M", price: 22000 }, { label: "L", price: 22000 }],
    qty: { "Beige|M": 2, "Beige|L": 1 }, createdDaysAgo: 15 },
  { id: "skulltee", brand: "ZARA", type: "Top", name: "Peace print tee", notes: "",
    colors: [{ name: "Black", photo: "black-skull-tee.jpg" }],
    sizes: [{ label: "S", price: 18000 }, { label: "M", price: 20000 }],
    qty: { "Black|S": 1, "Black|M": 3 }, createdDaysAgo: 12 },
  { id: "trailstee", brand: "Kikoi", type: "Top", name: "Take the trails tee", notes: "",
    colors: [{ name: "White", photo: "white-trails-tee.jpg" }],
    sizes: [{ label: "S", price: 20000 }, { label: "M", price: 20000 }],
    qty: { "White|S": 4, "White|M": 5 }, createdDaysAgo: 8 },
  { id: "meshtop", brand: "Vero Moda", type: "Top", name: "Sheer mesh blouse", notes: "",
    colors: [{ name: "Black", photo: "black-mesh-top.jpg" }],
    sizes: [{ label: "S", price: 32000 }, { label: "M", price: 34000 }],
    qty: { "Black|S": 0, "Black|M": 2 }, createdDaysAgo: 6 },
  { id: "biker", brand: "ZARA Basic", type: "Jacket", name: "Faux leather biker jacket", notes: "",
    colors: [{ name: "Black", photo: "black-biker-jacket.jpg" }],
    sizes: [{ label: "S", price: 95000 }, { label: "M", price: 95000 }],
    qty: { "Black|S": 2, "Black|M": 4 }, createdDaysAgo: 30 },
  { id: "woolcoat", brand: "ZARA", type: "Coat", name: "Belted wool coat", notes: "",
    colors: [{ name: "Wine", photo: "wine-wool-coat.jpg" }],
    sizes: [{ label: "M", price: 120000 }, { label: "L", price: 128000 }],
    qty: { "Wine|M": 0, "Wine|L": 0 }, createdDaysAgo: 60 },
  { id: "smartcoat", brand: "Giordano", type: "Coat", name: "Tailored collar coat", notes: "",
    colors: [{ name: "Blue", photo: "blue-tailored-coat.jpg" }],
    sizes: [{ label: "S", price: 105000 }, { label: "M", price: 115000 }],
    qty: { "Blue|S": 2, "Blue|M": 3 }, createdDaysAgo: 48 },
  { id: "overshirt", brand: "Giordano", type: "Top", name: "Checked overshirt", notes: "",
    colors: [{ name: "Navy", photo: "navy-overshirt.jpg" }],
    sizes: [{ label: "M", price: 58000 }, { label: "L", price: 58000 }],
    qty: { "Navy|M": 3, "Navy|L": 4 }, createdDaysAgo: 26 },
];

const CUSTOMERS = [
  { id: "kkz", name: "Khin Khin Zaw", phones: ["0977 213 455"] },
  { id: "acm", name: "Aye Chan Moe", phones: ["0945 622 331"] },
  { id: "tw", name: "Thida Win", phones: ["0988 712 090"] },
];

txn(() => {
  db.prepare("INSERT INTO meta (k, v) VALUES ('shop_name', 'TH Fashion') ON CONFLICT(k) DO UPDATE SET v = 'TH Fashion'").run();

  const variantOf = new Map<string, number>(); // "productId|Color|Size" -> variant id

  for (const p of P) {
    db.prepare(
      "INSERT INTO products (id, brand, type, name, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(p.id, p.brand, p.type, p.name, p.notes, now - p.createdDaysAgo * DAY, now - p.createdDaysAgo * DAY);

    const sizeIds: number[] = [];
    for (const [i, s] of p.sizes.entries()) {
      const r = db.prepare("INSERT INTO sizes (product_id, label, price, sort) VALUES (?,?,?,?)").run(
        p.id, s.label, s.price, i
      );
      sizeIds.push(Number(r.lastInsertRowid));
    }
    for (const [i, c] of p.colors.entries()) {
      copyFileSync(path.join(SEED_ASSETS, c.photo), path.join(PHOTOS_DIR, c.photo));
      const colorId = Number(
        db
          .prepare("INSERT INTO colors (product_id, name, sort) VALUES (?,?,?)")
          .run(p.id, c.name, i).lastInsertRowid
      );
      db.prepare("INSERT INTO photos (color_id, filename, sort, created_at) VALUES (?,?,?,?)").run(
        colorId, c.photo, 0, now - p.createdDaysAgo * DAY
      );
      for (const [si, s] of p.sizes.entries()) {
        const qty = p.qty[`${c.name}|${s.label}`] ?? 0;
        const vr = db
          .prepare("INSERT INTO variants (product_id, color_id, size_id, qty) VALUES (?,?,?,?)")
          .run(p.id, colorId, sizeIds[si], qty);
        variantOf.set(`${p.id}|${c.name}|${s.label}`, Number(vr.lastInsertRowid));
      }
    }
  }

  for (const c of CUSTOMERS) {
    db.prepare("INSERT INTO customers (id, name, phone1, phone2, notes, created_at) VALUES (?,?,?,?,?,?)").run(
      c.id, c.name, c.phones[0] ?? "", "", "", now - 30 * DAY
    );
  }

  const addSale = (at: number, custId: string, items: { p: string; c: string; s: string; qty: number }[]) => {
    const sid = newId();
    const cust = CUSTOMERS.find((c) => c.id === custId)!;
    db.prepare("INSERT INTO sales (id, customer_id, customer_name, customer_phone, at) VALUES (?,?,?,?,?)").run(
      sid, custId, cust.name, cust.phones[0] ?? "", at
    );
    for (const it of items) {
      const variantId = variantOf.get(`${it.p}|${it.c}|${it.s}`)!;
      const v = db.prepare("SELECT * FROM variants WHERE id = ?").get(variantId) as any;
      const prod = db.prepare("SELECT name, brand FROM products WHERE id = ?").get(it.p) as any;
      const color = db.prepare("SELECT name FROM colors WHERE id = ?").get(v.color_id) as any;
      const size = db.prepare("SELECT label, price FROM sizes WHERE id = ?").get(v.size_id) as any;
      db.prepare(
        `INSERT INTO sale_lines (sale_id, variant_id, product_id, product_name, brand, color_name, size_label, qty, price)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(sid, v.id, it.p, prod.name, prod.brand, color.name, size.label, it.qty, size.price);
      /* the variant qty values in the seed table are already post-sale stock, so
         only the historic trail is recorded here — no qty arithmetic needed */
      db.prepare(
        `INSERT INTO movements (at, type, variant_id, product_id, delta, note, sale_id, device_id)
         VALUES (?,?,?,?,?,?,?,NULL)`
      ).run(at, "sale", v.id, it.p, -it.qty, "", sid);
    }
  };

  addSale(now - 12 * DAY, "kkz", [
    { p: "gown", c: "Red", s: "M", qty: 1 },
    { p: "crewtee", c: "White", s: "M", qty: 2 },
  ]);
  addSale(now - 4 * DAY, "kkz", [{ p: "overshirt", c: "Navy", s: "L", qty: 1 }]);
  addSale(now - 7 * DAY, "acm", [
    { p: "floral", c: "White", s: "M", qty: 1 },
    { p: "cattee", c: "Beige", s: "M", qty: 1 },
  ]);
  addSale(now - 10 * DAY, "tw", [{ p: "biker", c: "Black", s: "M", qty: 1 }]);
});

console.log(`Seeded ${P.length} products, ${CUSTOMERS.length} customers, 4 sales.`);
console.log(`   DB:     ${path.join(DATA_DIR, "inventory.db")}`);
console.log("All devices were reset — re-pair phones from Settings.");
