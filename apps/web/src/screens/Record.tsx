import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { Customer, ProductFull, ProductSummary, SaleInput } from "@inv/shared";
import { mmk } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import { Stepper } from "../components/actions";
import { photoUrlOf } from "../components/util";

/* Record screen (route /sell): one customer, many product lines in one bill,
 * one whole-bill discount, instant commit (replaces the per-product
 * RecordSaleSheet; approved prototype: record.html). A line holds ONE product
 * but MULTIPLE colors — a dropdown picks which color's size rows you're
 * editing; quantities persist per color×size. Arriving from a product's
 * "Record sale" button preloads that product with its first color chosen. */

interface Line {
  product: ProductFull;
  ci: number; // which color the dropdown currently shows
  qty: Record<string, number>; // "colorId|sizeId" -> units (any color of this product)
  added: string[]; // "colorId|sizeId" keys with visible size rows, in add order
}

function priceOf(p: ProductFull, sizeId: number): number {
  return p.sizes.find((s) => s.id === sizeId)?.price ?? 0;
}
function lineTotal(l: Line): number {
  return Object.entries(l.qty).reduce((a, [key, q]) => a + q * priceOf(l.product, Number(key.split("|")[1])), 0);
}
function colorPieces(l: Line, colorId: number): number {
  return Object.entries(l.qty)
    .filter(([key, q]) => key.startsWith(`${colorId}|`) && q > 0)
    .reduce((a, [, q]) => a + q, 0);
}
function linePieces(l: Line): number {
  return Object.values(l.qty).reduce((a, b) => a + b, 0);
}

export default function Record() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { toast } = useApp();

  const [lines, setLines] = useState<Line[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [pickProduct, setPickProduct] = useState<ProductFull | null>(null); // sheet: color stage
  const [sums, setSums] = useState<ProductSummary[] | null>(null); // sheet: search stage
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchDebounce = useRef<number | undefined>(undefined);

  /* preload the product we came from (Record Sale button on detail) */
  const productId = params.get("product") ?? "";
  useEffect(() => {
    if (!productId) return;
    void api
      .product(productId)
      .then((p) => {
        const first = p.sizes[0]?.id ? `${p.colors[0]?.id}|${p.sizes[0].id}` : "";
        setLines([{ product: p, ci: 0, qty: {}, added: first ? [first] : [] }]);
      })
      .catch(() => setErr("Could not load that product"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* debounced search inside the add-product sheet */
  useEffect(() => {
    if (!addOpen || pickProduct) return; // closed, or sheet is in color stage
    window.clearTimeout(searchDebounce.current);
    searchDebounce.current = window.setTimeout(async () => {
      setSums(await api.products(q).catch(() => []));
    }, 160);
    return () => window.clearTimeout(searchDebounce.current);
  }, [q, pickProduct, addOpen]);

  const addLine = (p: ProductFull, ci: number) => {
    if (lines.some((l) => l.product.id === p.id)) {
      toast("Already in the bill — Add color adds its other colors");
      return;
    }
    const first = p.sizes[0]?.id;
    const key = first && p.colors[ci] ? `${p.colors[ci].id}|${first}` : "";
    /* rows open at 0 — the quantity is always a deliberate step */
    setLines((ls) => [
      ...ls,
      { product: p, ci, qty: {}, added: key ? [key] : [] },
    ]);
    setAddOpen(false);
    setPickProduct(null);
    setSums(null);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  /* pick a color from the "+ Add color…" dropdown: focus it and, if the product
   * has no rows for it yet, open its first size at 0 */
  const addColorPick = (li: number, colorId: number) =>
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== li) return l;
        const ci = Math.max(0, l.product.colors.findIndex((x) => x.id === colorId));
        const firstKey =
          l.product.sizes[0]?.id !== undefined
            ? `${colorId}|${l.product.sizes[0].id}`
            : "";
        const colorStarted = l.added.some((k) => k.startsWith(`${colorId}|`));
        return {
          ...l,
          ci,
          added: colorStarted || !firstKey ? l.added : [...l.added, firstKey],
        };
      })
    );

  const setSizeAdd = (li: number, key: string) =>
    setLines((ls) =>
      ls.map((l, i) =>
        i === li && key && !l.added.includes(key)
          ? { ...l, added: [...l.added, key], qty: { ...l.qty, [key]: 0 } }
          : l
      )
    );

  const removeSize = (li: number, key: string) =>
    setLines((ls) =>
      ls.map((l, i) =>
        i === li ? { ...l, added: l.added.filter((k) => k !== key), qty: { ...l.qty, [key]: 0 } } : l
      )
    );

  const setQty = (li: number, key: string, v: number) =>
    setLines((ls) =>
      ls.map((l, i) => (i === li ? { ...l, qty: { ...l.qty, [key]: Math.max(0, v) } } : l))
    );

  const setColor = (li: number, ci: number) =>
    setLines((ls) => ls.map((l, i) => (i === li ? { ...l, ci } : l)));

  const closeAdd = () => {
    setAddOpen(false);
    setPickProduct(null);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const removeLine = (li: number) => setLines((ls) => ls.filter((_, i) => i !== li));

  const itemsTotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const pieces = lines.reduce((a, l) => a + linePieces(l), 0);
  const payable = Math.max(0, itemsTotal - discount);

  const confirm = async () => {
    const flat: SaleInput["lines"] = [];
    for (const l of lines) {
      for (const [key, qty] of Object.entries(l.qty)) {
        if (qty <= 0) continue;
        const vid = l.product.variantIds[key];
        if (!vid) continue;
        flat.push({ variantId: vid, qty });
      }
    }
    if (flat.length === 0) {
      setErr("Add at least one item and raise its quantity");
      return;
    }
    if (discount > itemsTotal) {
      setErr(`Discount (Ks ${discount.toLocaleString("en-US")}) exceeds the bill total (Ks ${itemsTotal.toLocaleString("en-US")})`);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const sale = await api.recordSale({
        customerId,
        customerName: name.trim(),
        phone1: phone1.trim(),
        phone2: phone2.trim(),
        customerNotes: notes.trim(),
        discount,
        lines: flat,
      });
      toast(`Sale recorded · ${mmk(sale.payable)}`);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from ?? "/", { replace: true });
    } catch (e: unknown) {
      /* stock may have shifted underneath us — re-pull every product in the bill */
      setBusy(false);
      setErr(String((e as Error).message ?? e));
      void (async () => {
        const pairs = await Promise.all(
          lines.map(async (l) => ({ fresh: await api.product(l.product.id).catch(() => l.product), l }))
        );
        setLines(pairs.map(({ fresh, l }) => ({ ...l, product: fresh, qty: {} })));
      })();
    }
  };

  return (
    <div className="record-screen">
      <header className="head">
        <div className="head-top">
          <Link to="/" style={{ fontSize: 14 }}>
            ‹ Products
          </Link>
          <div className="wordmark">
            Record sale
            <small>one customer · one bill</small>
          </div>
        </div>
      </header>

      {/* customer */}
      <div className="chips-label">Customer</div>
      <div className="card">
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
      </div>

      {/* items */}
      <div className="chips-label">Items</div>
      <div className="card">
        {lines.length === 0 && (
          <div className="dim">Nothing in the bill yet — add a product below.</div>
        )}
        {lines.map((l, li) => {
          const c = l.product.colors[l.ci];
          return (
            <div className="rec-line" key={l.product.id}>
              <button className="rec-rm" title="Remove this product from the bill" onClick={() => removeLine(li)}>
                ✕
              </button>
              {c.photos[0] ? (
                <img className="rec-thumb" src={photoUrlOf(c.photos[0].filename)} alt={c.name} />
              ) : (
                <span className="rec-thumb rec-noimg">No photo</span>
              )}
              <div className="rec-mid">
                <div className="pn-row">
                  <span className="pn">{l.product.name}</span>
                </div>
                <div className="rec-chips">
                  {l.product.colors
                    .filter((cc) => l.added.some((k) => k.startsWith(`${cc.id}|`)))
                    .map((cc) => (
                      <button
                        key={cc.id}
                        className={"color-chip" + (cc.id === c.id ? " on" : "")}
                        onClick={() => setColor(li, l.product.colors.findIndex((x) => x.id === cc.id))}
                      >
                        {cc.name}
                        {colorPieces(l, cc.id) > 0 ? ` ×${colorPieces(l, cc.id)}` : ""}
                      </button>
                    ))}
                </div>
                {!l.product.colors.every((cc) => l.added.some((k) => k.startsWith(`${cc.id}|`))) && (
                  <div>
                    <select
                      className="rec-select rec-add"
                      value=""
                      onChange={(e) => e.target.value && addColorPick(li, Number(e.target.value))}
                      aria-label="Add color"
                    >
                      <option value="">＋ Add color…</option>
                      {l.product.colors
                        .filter((cc) => !l.added.some((k) => k.startsWith(`${cc.id}|`)))
                        .map((cc) => (
                          <option key={cc.id} value={cc.id}>
                            {cc.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                {l.product.sizes.map((s) => {
                  const key = `${c.id}|${s.id}`;
                  if (!l.added.includes(key)) return null;
                  return (
                    <div className="rec-row" key={s.id}>
                      <span className="lab">{s.label}</span>
                      <span className="pr">{mmk(s.price)}</span>
                      <Stepper
                        value={l.qty[key] || 0}
                        max={l.product.qty[key] ?? 0}
                        onChange={(v) => setQty(li, key, v)}
                      />
                      <button
                        className="rec-row-rm"
                        title="Remove this size from the bill"
                        onClick={() => removeSize(li, key)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <div className="rec-row">
                  <select
                    className="rec-select rec-add"
                    value=""
                    onChange={(e) => setSizeAdd(li, e.target.value)}
                    aria-label="Add size"
                  >
                    <option value="">＋ Add size…</option>
                    {l.product.sizes
                      .filter((s) => !l.added.includes(`${c.id}|${s.id}`))
                      .map((s) => (
                        <option key={s.id} value={`${c.id}|${s.id}`}>
                          {s.label}
                        </option>
                      ))}
                    {l.product.sizes.length === l.added.filter((k) => k.startsWith(`${c.id}|`)).length && (
                      <option value="" disabled>
                        all sizes added
                      </option>
                    )}
                  </select>
                </div>
              </div>
              <div className="rec-sumslot">
                <div className="amt">{mmk(lineTotal(l))}</div>
              </div>
            </div>
          );
        })}
        <button
          className="btn small"
          style={{ marginTop: 10, width: "100%" }}
          onClick={() => {
            setAddOpen(true);
            setPickProduct(null);
            setQ("");
          }}
        >
          ＋ Add product
        </button>
      </div>

      {/* discount */}
      <div className="chips-label">Discount</div>
      <div className="card">
        <div className="disc-row">
          <label>
            Less off this bill (Ks)
            <div style={{ fontSize: 11, color: "var(--muted)" }}>applied once, after all items</div>
          </label>
          <div className="discbox">
            <span className="ks">− Ks</span>
            <input
              inputMode="numeric"
              value={discount || ""}
              placeholder="0"
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
            />
          </div>
        </div>
      </div>

      {/* summary */}
      <div className="chips-label">Summary</div>
      <div className="card">
        <div className="rec-sumrow">
          <span>Items ({pieces} pcs)</span>
          <span>{mmk(itemsTotal)}</span>
        </div>
        <div className="rec-sumrow">
          <span>Discount</span>
          <span>− {mmk(discount)}</span>
        </div>
        <div className="rec-pay">
          <span>Payable</span>
          <span>{mmk(payable)}</span>
        </div>
      </div>

      {/* note + confirm bar */}
      <div className="bar">
        <input
          className="note"
          placeholder="Note for this sale (optional) — delivery, occasion…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : `Confirm sale · ${mmk(payable)}`}
        </button>
      </div>

      {/* add-product sheet */}
      <div className="sheetmask" style={{ display: addOpen ? "block" : "none" }} onClick={closeAdd} />
      <div className="sheet" style={{ display: addOpen ? "block" : "none" }}>
        <div className="grab" />
        {pickProduct ? (
          <>
            <h3>{pickProduct.name}</h3>
            <div className="sub">Which color?</div>
            <div className="chips" style={{ marginTop: 10 }}>
              {pickProduct.colors.map((c, ci) => (
                <button
                  key={c.id}
                  className="custchip"
                  onClick={() => addLine(pickProduct, ci)}
                >
                  {c.photos[0] && <img className="chipthumb" src={photoUrlOf(c.photos[0].filename)} alt="" />}
                  <span className="cn">{c.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3>Add product</h3>
            <input
              className="ssearch"
              autoFocus
              placeholder="Search brand, name, Burmese…"
              value={q}
              autoComplete="off"
              onChange={(e) => setQ(e.target.value)}
            />
            <div style={{ maxHeight: "46vh", overflowY: "auto" }}>
              {(sums ?? []).map((s) => (
                <button
                  className="pick-row"
                  key={s.id}
                  onClick={async () => {
                    try {
                      setPickProduct(await api.product(s.id));
                    } catch (e: unknown) {
                      toast(String((e as Error).message ?? e));
                    }
                  }}
                >
                  <span
                    className="pick-thumb"
                    style={{ background: "var(--panel)" }}
                  >
                    {s.thumbs?.[0] ? <img src={photoUrlOf(s.thumbs[0])} alt="" /> : "▦"}
                  </span>
                  <span>
                    <span className="pick-name">{s.name}</span>
                    <br />
                    <span className="pick-meta">
                      {s.brand}
                      {s.type ? ` · ${s.type}` : ""}
                      {s.minPrice > 0 ? ` · ${mmk(s.minPrice)}` : ""}
                    </span>
                  </span>
                  <span className="chev">›</span>
                </button>
              ))}
              {sums?.length === 0 && <div className="sub">No products match.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Same interface as the old sheet's customer block: type a name, matches from the
 * customers book appear, picking one fills phones + notes. */
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
