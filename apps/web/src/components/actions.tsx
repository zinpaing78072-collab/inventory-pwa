import { useEffect, useMemo, useRef, useState } from "react";
import type { Customer, Movement, ProductFull, Sale } from "@inv/shared";
import { mmk, stockText } from "@inv/shared";
import { api } from "../api";
import { BottomSheet } from "./BottomSheet";
import { dateShort } from "./util";

/* ---------- image compression (client-side per hand-off §7: canvas -> ~1600px JPEG) ---------- */

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const long = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 1600 / long);
    if (scale === 1 && file.size < 400_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = (await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
    )) as Blob | null;
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/* ---------- shared bits ---------- */

type VariantKey = string; // `${colorId}|${sizeId}`

function variantIdOf(p: ProductFull, key: VariantKey): number | undefined {
  return p.variantIds[key];
}
function qtyOf(p: ProductFull, key: VariantKey): number {
  return p.qty[key] ?? 0;
}
const sizePrice = (p: ProductFull, sizeId: number): number =>
  p.sizes.find((s) => s.id === sizeId)?.price ?? 0;

function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="stepper">
      <button className="step" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="n">{value}</span>
      <button className="step" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

/* ---------- customer picker (used by sale sheet) ---------- */

function CustomerFields({
  customerId,
  name,
  phone1,
  phone2,
  notes,
  set,
}: {
  customerId: string | null;
  name: string;
  phone1: string;
  phone2: string;
  notes: string;
  set: (v: { customerId?: string | null; name?: string; phone1?: string; phone2?: string; notes?: string }) => void;
}) {
  const [matches, setMatches] = useState<Customer[] | null>(null);
  const debounce = useRef<number>(undefined);

  useEffect(() => {
    const q = name.trim() || phone1.trim();
    if (q.length < 2) {
      setMatches(null);
      return;
    }
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      api
        .customers(q)
        .then((cs) => setMatches(cs.filter((c) => c.id !== customerId).slice(0, 4)))
        .catch(() => setMatches(null));
    }, 200);
    return () => window.clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, phone1]);

  return (
    <>
      <div className="frow">
        <label>Customer name</label>
        <input placeholder="For the sales book" value={name} onChange={(e) => set({ name: e.target.value, customerId: null })} />
      </div>
      {matches && matches.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {matches.map((c) => (
            <button
              key={c.id}
              className="custchip"
              onClick={() =>
                set({ customerId: c.id, name: c.name, phone1: c.phone1, phone2: c.phone2, notes: c.notes })
              }
            >
              <span className="av">{c.name.slice(0, 2).toUpperCase()}</span>
              <span>
                <span className="cn">{c.name}</span>
                <br />
                <span className="cp">{c.phone1 || c.phone2}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="frow f2">
        <div>
          <label>Phone 1</label>
          <input inputMode="tel" placeholder="09…" value={phone1} onChange={(e) => set({ phone1: e.target.value, customerId: null })} />
        </div>
        <div>
          <label>Phone 2</label>
          <input inputMode="tel" value={phone2} onChange={(e) => set({ phone2: e.target.value, customerId: null })} />
        </div>
      </div>
      <div className="frow">
        <label>Customer notes (optional)</label>
        <input placeholder="Regular, prefers dresses, delivery address…" value={notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </>
  );
}

/* ---------- record sale ---------- */

export function RecordSaleSheet({
  product,
  onClose,
  onDone,
}: {
  product: ProductFull;
  onClose: () => void;
  onDone: () => void;
}) {
  const [colorId, setColorId] = useState<number>(product.colors[0]?.id ?? 0);
  const [sel, setSel] = useState<Record<VariantKey, number>>({});
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = useMemo(() => {
    const out: { key: VariantKey; sizeLabel: string; qty: number; price: number; variantId: number }[] = [];
    for (const [key, q] of Object.entries(sel)) {
      if (q <= 0) continue;
      const sizeId = Number(key.split("|")[1]);
      const vid = variantIdOf(product, key);
      if (!vid) continue;
      out.push({
        key,
        sizeLabel: product.sizes.find((s) => s.id === sizeId)?.label ?? "?",
        qty: q,
        price: sizePrice(product, sizeId),
        variantId: vid,
      });
    }
    return out;
  }, [sel, product]);

  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);

  const confirm = async () => {
    if (lines.length === 0) {
      setErr("Add at least one item");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await api.recordSale({
        customerId,
        customerName: name.trim(),
        phone1: phone1.trim(),
        phone2: phone2.trim(),
        customerNotes: notes.trim(),
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      });
      onDone();
      onClose();
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>Record sale</h3>
        <div className="sub">{product.name}</div>

        {product.colors.length > 1 && (
          <div className="chips" style={{ marginTop: 10 }}>
            {product.colors.map((c) => (
              <button
                key={c.id}
                className="custchip"
                style={c.id === colorId ? { borderColor: "var(--ink)", fontWeight: 620 } : undefined}
                onClick={() => setColorId(c.id)}
              >
                <span className="av">{c.name.slice(0, 2).toUpperCase()}</span>
                <span className="cn">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="frow">
          <label>Quantity per size (stock shown in grey)</label>
          {product.sizes.map((s) => {
            const key = `${colorId}|${s.id}`;
            const stock = qtyOf(product, key);
            const chosen = sel[key] ?? 0;
            return (
              <div key={s.id} className="qty-edit-row">
                <span className="lab">{s.label}</span>
                <span className="pr">{mmk(s.price)}</span>
                <span className="pr" style={{ textAlign: "center" }}>
                  {stockText(stock)}
                </span>
                <Stepper
                  value={chosen}
                  min={0}
                  max={stock}
                  onChange={(v) => setSel((prev) => ({ ...prev, [key]: v }))}
                />
              </div>
            );
          })}
        </div>

        <div className="sale-total">
          <span>Total</span>
          <span>{mmk(total)}</span>
        </div>

        <CustomerFields
          customerId={customerId}
          name={name}
          phone1={phone1}
          phone2={phone2}
          notes={notes}
          set={(v) => {
            if (v.customerId !== undefined) setCustomerId(v.customerId);
            if (v.name !== undefined) setName(v.name);
            if (v.phone1 !== undefined) setPhone1(v.phone1);
            if (v.phone2 !== undefined) setPhone2(v.phone2);
            if (v.notes !== undefined) setNotes(v.notes);
          }}
        />

        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : `Confirm sale${total ? ` · ${mmk(total)}` : ""}`}
        </button>
      </div>
    </>
  );
}

/* ---------- stock in ---------- */

export function StockInSheet({
  product,
  onClose,
  onDone,
}: {
  product: ProductFull;
  onClose: () => void;
  onDone: () => void;
}) {
  const [colorId, setColorId] = useState<number>(product.colors[0]?.id ?? 0);
  const [sel, setSel] = useState<Record<VariantKey, number>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    const keys = Object.entries(sel).filter(([, q]) => q > 0);
    if (keys.length === 0) {
      setErr("Nothing to add");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      for (const [key, q] of keys) {
        const vid = variantIdOf(product, key);
        if (vid) await api.stockIn(vid, q, note);
      }
      onDone();
      onClose();
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>Stock in</h3>
        <div className="sub">Add received units to {product.name}</div>

        {product.colors.length > 1 && (
          <div className="chips" style={{ marginTop: 10 }}>
            {product.colors.map((c) => (
              <button
                key={c.id}
                className="custchip"
                style={c.id === colorId ? { borderColor: "var(--ink)", fontWeight: 620 } : undefined}
                onClick={() => setColorId(c.id)}
              >
                <span className="av">{c.name.slice(0, 2).toUpperCase()}</span>
                <span className="cn">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="frow">
          <label>Units received (now: shown on the right)</label>
          {product.sizes.map((s) => {
            const key = `${colorId}|${s.id}`;
            const v = sel[key] ?? 0;
            return (
              <div key={s.id} className="qty-edit-row">
                <span className="lab">{s.label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={v || ""}
                  placeholder="0"
                  onChange={(e) => setSel((prev) => ({ ...prev, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                />
                <span className="pr" style={{ textAlign: "center" }}>
                  {stockText(qtyOf(product, key))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="frow">
          <label>Note (optional)</label>
          <input placeholder="Supplier, delivery date…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : "Add stock"}
        </button>
      </div>
    </>
  );
}

/* ---------- adjust (set true count) ---------- */

export function AdjustSheet({
  product,
  onClose,
  onDone,
}: {
  product: ProductFull;
  onClose: () => void;
  onDone: () => void;
}) {
  const [colorId, setColorId] = useState<number>(product.colors[0]?.id ?? 0);
  const [sel, setSel] = useState<Record<VariantKey, number>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // prefill with current counts so you edit the wrong ones rather than typing zeros
    setSel({ ...product.qty });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const confirm = async () => {
    const changed = Object.entries(sel).filter(([key, v]) => v !== qtyOf(product, key));
    if (changed.length === 0) {
      setErr("Nothing changed");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      for (const [key, setTo] of changed) {
        const vid = variantIdOf(product, key);
        if (vid) await api.adjust(vid, setTo, note);
      }
      onDone();
      onClose();
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>Adjust stock</h3>
        <div className="sub">Set the true count — damaged, lost, or records drifting</div>

        {product.colors.length > 1 && (
          <div className="chips" style={{ marginTop: 10 }}>
            {product.colors.map((c) => (
              <button
                key={c.id}
                className="custchip"
                style={c.id === colorId ? { borderColor: "var(--ink)", fontWeight: 620 } : undefined}
                onClick={() => setColorId(c.id)}
              >
                <span className="av">{c.name.slice(0, 2).toUpperCase()}</span>
                <span className="cn">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="frow">
          <label>True count per size</label>
          {product.sizes.map((s) => {
            const key = `${colorId}|${s.id}`;
            return (
              <div key={s.id} className="qty-edit-row">
                <span className="lab">{s.label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={sel[key] ?? 0}
                  onChange={(e) => setSel((prev) => ({ ...prev, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                />
                <span className="pr" style={{ textAlign: "center" }}>
                  {stockText(qtyOf(product, key))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="frow">
          <label>Reason (optional)</label>
          <input placeholder="Damaged, lost, recount…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : "Save adjustments"}
        </button>
      </div>
    </>
  );
}

/* ---------- history (product) + return (sale) ---------- */

const TYPE_LABEL: Record<string, string> = {
  "stock-in": "Stock in",
  adjust: "Adjust",
  sale: "Sale",
  return: "Return",
  "sale-reverse": "Return",
};

export function ReturnSheet({
  sale,
  onClose,
  onDone,
}: {
  sale: Sale;
  onClose: () => void;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<Record<number, number>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const remaining = (lineId: number, qty: number, returned: number) => qty - returned;

  const confirm = async () => {
    const lines = Object.entries(sel)
      .filter(([, q]) => q > 0)
      .map(([lineId, q]) => ({ saleLineId: Number(lineId), qty: q }));
    if (lines.length === 0) {
      setErr("Nothing to return");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await api.returnSale(sale.id, { lines, note });
      onDone();
      onClose();
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>Return items</h3>
        <div className="sub">
          Sale to {sale.customerName || "Walk-in"} · {dateShort(sale.at)}
        </div>
        {sale.lines.map((l) => {
          const remain = remaining(l.id, l.qty, l.returned ?? 0);
          return (
            <div key={l.id} className="qty-edit-row">
              <span className="lab" style={{ fontSize: 12.5 }}>
                {l.productName.slice(0, 14)}
                <br />
                <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 10.5 }}>
                  {l.colorName} {l.sizeLabel} · {mmk(l.price)}
                </span>
              </span>
              <span className="pr" style={{ textAlign: "center" }}>
                {remain > 0 ? `${remain} returnable` : "fully returned"}
              </span>
              <Stepper
                value={sel[l.id] ?? 0}
                max={remain}
                onChange={(v) => setSel((prev) => ({ ...prev, [l.id]: v }))}
              />
            </div>
          );
        })}
        <div className="frow">
          <label>Reason (optional)</label>
          <input placeholder="Wrong size, changed mind…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : "Confirm return"}
        </button>
      </div>
    </>
  );
}

export function HistorySheet({
  product,
  history,
  onClose,
}: {
  product: ProductFull;
  history: { movements: Movement[]; sales: Sale[] };
  onClose: () => void;
}) {
  const [returning, setReturning] = useState<Sale | null>(null);
  const salesById = useMemo(() => new Map(history.sales.map((s) => [s.id, s])), [history.sales]);
  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>History — {product.name}</h3>
        <div className="sub">Most recent first · tap “Return” on a sale to reverse its units</div>
        {history.movements.map((m) => {
          const sale = m.saleId ? salesById.get(m.saleId) : undefined;
          return (
            <div className="hist-row" key={m.id}>
              <span className="when">{dateShort(m.at)}</span>
              <span>
                <b>{TYPE_LABEL[m.type] ?? m.type}</b> {m.type !== "adjust" ? "" : "→"}
                {" "}
                <span className={m.delta >= 0 ? "delta-pos" : "delta-neg"}>
                  {m.delta >= 0 ? "+" : ""}
                  {m.delta}
                </span>{" "}
                {m.colorName} {m.sizeLabel}
                {m.note && <div className="hist-note">{m.note}</div>}
                {sale && (
                  <div>
                    <button className="btn small" style={{ marginTop: 4 }} onClick={() => setReturning(sale)}>
                      Return…
                    </button>
                  </div>
                )}
              </span>
              <span />
            </div>
          );
        })}
        {history.movements.length === 0 && <div className="sub" style={{ padding: "14px 0" }}>No movements yet.</div>}
      </div>
      {returning && (
        <ReturnSheet
          sale={returning}
          onClose={() => setReturning(null)}
          onDone={() => {
            onClose(); // refresh happens via rev bump; parent refetches on next open
          }}
        />
      )}
    </>
  );
}
