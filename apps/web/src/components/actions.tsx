import { useEffect, useMemo, useRef, useState } from "react";
import type { Movement, ProductFull, Sale } from "@inv/shared";
import { mmk, stockText } from "@inv/shared";
import { api } from "../api";
import { BottomSheet } from "./BottomSheet";
import { dateShort, photoUrlOf } from "./util";

/* ---------- image compression (client-side per hand-off §7) ---------- */

/* WebKit (Safari, iOS home-screen apps) drops a photo's ICC color profile when
 * the image is drawn through a canvas and re-encoded as JPEG — wide-gamut
 * (Display P3) gallery photos come out washed out or straight grayscale.
 * Camera shots are plain sRGB and survive, which is why this used to hit only
 * gallery picks. On Apple devices we therefore upload gallery photos as the
 * original bytes (the iOS picker delivers ready JPEGs) and only canvas-compress
 * forced camera captures. Other engines re-encode profile-safe. */
const IS_APPLE_UA = (() => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iP(hone|od|ad)/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1; // iPadOS desktop UA
})();

export async function compressImage(file: File, opts?: { force?: boolean }): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (!opts?.force && IS_APPLE_UA) return file; // keep original bytes + ICC profile
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

export function Stepper({
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


/* ---------- stock in ---------- */

export function StockInSheet({
  product,
  initialColorId,
  onClose,
  onDone,
}: {
  product: ProductFull;
  /** color shown on the detail screen — preselect its chips */
  initialColorId?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [colorId, setColorId] = useState<number>(initialColorId ?? product.colors[0]?.id ?? 0);
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
  initialColorId,
  onClose,
  onDone,
}: {
  product: ProductFull;
  /** color shown on the detail screen — preselect its chips */
  initialColorId?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [colorId, setColorId] = useState<number>(initialColorId ?? product.colors[0]?.id ?? 0);
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
  /* same visual language as the record screen: one card per product, color
   * chips switch which color's rows you're editing */
  const [products, setProducts] = useState<Map<string, ProductFull> | null>(null);
  const [ciByProduct, setCiByProduct] = useState<Record<string, number>>({});

  useEffect(() => {
    void Promise.all(
      [...new Set(sale.lines.map((l) => l.productId))].map((id) =>
        api.product(id).catch(() => null)
      )
    ).then((ps) => setProducts(new Map(ps.filter((p): p is ProductFull => !!p).map((p) => [p.id, p]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.id]);

  const remaining = (lineId: number, qty: number, returned: number) => qty - returned;
  const pieces = Object.values(sel).reduce((a, b) => a + b, 0);

  const confirm = async () => {
    const lines = Object.entries(sel)
      .filter(([, q]) => q > 0)
      .map(([lineId, q]) => ({ saleLineId: Number(lineId), qty: q }));
    if (lines.length === 0) {
      setErr("Nothing to return — raise a quantity first");
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

  /* group the sale's lines by product */
  const groups = Object.values(
    sale.lines.reduce<Record<string, { productId: string; name: string; lines: Sale["lines"] }>>(
      (acc, l) => {
        (acc[l.productId] ??= { productId: l.productId, name: l.productName, lines: [] }).lines.push(l);
        return acc;
      },
      {}
    )
  );

  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <h3>Return items</h3>
        <div className="sub">
          Sale to {sale.customerName || "Walk-in"} · {dateShort(sale.at)}
        </div>

        {groups.map((g) => {
          const p = products?.get(g.productId);
          const colorNames = [...new Set(g.lines.map((l) => l.colorName))];
          const ci = ciByProduct[g.productId] ?? 0;
          const activeColor = colorNames[ci] ?? colorNames[0];
          const colorIdx = colorNames.indexOf(activeColor);
          return (
            <div className="rec-card" key={g.productId}>
              <div className="rec-line headless">
                {p?.colors.find((c) => c.name === colorNames[colorIdx])?.photos[0] ||
                p?.colors[0]?.photos[0] ? (
                  <img
                    className="rec-thumb"
                    src={photoUrlOf(
                      (p!.colors.find((c) => c.name === colorNames[colorIdx]) ?? p!.colors[0]).photos[0].filename
                    )}
                    alt={g.name}
                  />
                ) : (
                  <span className="rec-thumb rec-noimg">No photo</span>
                )}
                <div className="rec-mid">
                  <div className="pn-row">
                    <span className="pn">{p?.name ?? g.name}</span>
                  </div>
                  {colorNames.length > 1 && (
                    <div className="rec-chips">
                      {colorNames.map((cn, i) => (
                        <button
                          key={cn}
                          className={"color-chip" + (i === colorIdx ? " on" : "")}
                          onClick={() => setCiByProduct((m) => ({ ...m, [g.productId]: i }))}
                        >
                          {cn}
                        </button>
                      ))}
                    </div>
                  )}
                  {g.lines
                    .filter((l) => l.colorName === activeColor)
                    .map((l) => {
                      const remain = remaining(l.id, l.qty, l.returned ?? 0);
                      return (
                        <div className="rec-row" key={l.id}>
                          <span className="lab">{l.sizeLabel}</span>
                          <span className="pr">{remain > 0 ? `${remain} of ${l.qty} returnable` : "fully returned"}</span>
                          <Stepper
                            value={sel[l.id] ?? 0}
                            max={remain}
                            onChange={(v) => setSel((prev) => ({ ...prev, [l.id]: v }))}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          );
        })}

        <div className="frow" style={{ marginTop: 12 }}>
          <label>Reason (optional)</label>
          <input placeholder="Wrong size, changed mind…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : `Confirm return${pieces ? ` · ${pieces} pc${pieces === 1 ? "" : "s"}` : ""}`}
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
