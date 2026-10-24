import { mmkRange, stockClass, stockText, type ProductSummary } from "@inv/shared";
import { useState } from "react";

/** Card shape fed by the Home screen: summary + per-color thumbnails. */
export interface CardProduct extends ProductSummary {
  thumbUrls: string[]; // first photo of each color
  colorNames: string[];
}

/** Product card for the home grid. Photos flip per color with ‹ › (per prototype). */
export function ProductCard({ p }: { p: CardProduct }) {
  const [i, setI] = useState(0);
  const multi = p.thumbUrls.length > 1;
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
        {p.minPrice > 0 && <div className="priceline">{mmkRange(p.minPrice, p.maxPrice)}</div>}
        <div className={`stockline ${stockClass(p.totalQty)}`}>{stockText(p.totalQty)}</div>
      </div>
    </article>
  );
}
