import { mmk, mmkRange, stockClass, stockText, type ProductSummary } from "@inv/shared";
import { useState } from "react";

/** Card shape fed by the Home screen: summary + per-color thumbnails. */
export interface CardProduct extends ProductSummary {
  thumbUrls: string[]; // first photo of each color
  colorNames: string[];
}

/** Product card for the home grid. Photos flip per color with ‹ › (per prototype).
 *  A size dropdown picks the size: price follows the size, stock follows color+size.
 *  Falls back to the old range/total display when per-size data is missing. */
export function ProductCard({ p }: { p: CardProduct }) {
  const [i, setI] = useState(0);
  const [sizeId, setSizeId] = useState<number | null>(null);
  const multi = p.thumbUrls.length > 1;
  const sizes = p.sizes ?? [];
  const colorIds = p.colorIds ?? [];
  const hasPerSize = sizes.length > 0 && colorIds.length > 0 && !!p.variantQty;
  const size = sizes.find((s) => s.id === sizeId) ?? sizes[0];

  // chosen combo's stock: 0 when the variant row doesn't exist yet
  const comboQty = hasPerSize && size ? (p.variantQty![`${colorIds[i]}|${size.id}`] ?? 0) : null;

  const priceLine =
    comboQty !== null && size ? mmk(size.price) : p.minPrice > 0 ? mmkRange(p.minPrice, p.maxPrice) : null;
  const anyLeft = comboQty ?? p.totalQty;
  const qtyCls = stockClass(anyLeft);
  const qtyLabel =
    comboQty === 0 && !p.outQty ? "None in this color/size" : stockText(anyLeft);

  return (
    <article className={"product" + (p.outQty ? " is-zero" : "")}>
      <div className="tile">
        {p.thumbUrls[0] ? (
          <img src={p.thumbUrls[i] ?? p.thumbUrls[0]} alt={p.name} loading="lazy" />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%" }} className="ph">
            No photo yet
          </div>
        )}
        {p.outQty && <span className="sochip">Sold out</span>}
        {multi && (
          <>
            <button
              className="tile-btn left"
              title="Previous color"
              aria-label="Previous color"
              onClick={(e) => {
                e.stopPropagation();
                setI((v) => (v - 1 + p.thumbUrls.length) % p.thumbUrls.length);
              }}
            >
              ‹
            </button>
            <button
              className="tile-btn right"
              title="Next color"
              aria-label="Next color"
              onClick={(e) => {
                e.stopPropagation();
                setI((v) => (v + 1) % p.thumbUrls.length);
              }}
            >
              ›
            </button>
            <span className="colorpill">{p.colorNames[i]}</span>
          </>
        )}
      </div>
      <div style={{ padding: "0 2px" }}>
        <div className="brandline">
          {p.brand}
          {p.type ? ` · ${p.type}` : ""}
          {multi ? "" : p.colorNames[0] ? ` · ${p.colorNames[0]}` : ""}
        </div>
        <div className="pname">{p.name}</div>
        {sizes.length > 1 && (
          <select
            className="sizeselect"
            value={size?.id ?? ""}
            aria-label="Size"
            onChange={(e) => setSizeId(Number(e.target.value))}
            onClick={(e) => e.stopPropagation()}
          >
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {priceLine && <div className="priceline">{priceLine}</div>}
        <div className={`stockline ${qtyCls}`}>{qtyLabel}</div>
      </div>
    </article>
  );
}
