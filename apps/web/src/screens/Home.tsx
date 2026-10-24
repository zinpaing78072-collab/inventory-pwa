import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ProductSummary } from "@inv/shared";
import { useApp } from "../App";
import { ProductCard, type CardProduct } from "../components/productTypes";
import { nowDateLabel, photoUrlOf } from "../components/util";

/** Home: text search over products + card grid (per prototype). */
export default function Home() {
  const { rev } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [list, setList] = useState<ProductSummary[] | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    const load = async () => {
      setList(null);
      try {
        setList(await api.products(q));
      } catch {
        setList([]);
      }
    };
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, q ? 180 : 0);
    return () => window.clearTimeout(debounce.current);
  }, [q, rev]);

  const cards = useMemo<CardProduct[]>(
    () =>
      (list ?? []).map((p) => ({
        ...p,
        thumbUrls: (p.thumbs ?? []).filter(Boolean).map(photoUrlOf),
        colorNames: p.colorNames ?? [],
      })),
    [list]
  );

  const lowCount = cards.filter((p) => p.lowQty).length;

  return (
    <>
      <header className="head">
        <div className="head-top">
          <div className="wordmark">
            TH Fashion
            <small>Inventory</small>
          </div>
          <span className="date">{nowDateLabel()}</span>
        </div>
        <div className="search">
          <span className="mag">⌕</span>
          <input
            placeholder="Search products"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear" style={{ color: "var(--muted)" }}>
              ✕
            </button>
          )}
        </div>
      </header>

      <main style={{ padding: "0 16px" }}>
        {cards.length === 0 && list !== null && (
          <div className="empty">
            <p style={{ marginBottom: 4 }}>
              <b>{q ? `No matches for “${q}”` : "No products yet"}</b>
            </p>
            <p style={{ fontSize: 12 }}>
              {q ? "Try “zara”, “dress”, a color name…" : "Tap + to add your first product."}
            </p>
          </div>
        )}
        {cards.length > 0 && (
          <>
            <div className="meta-line">
              <span>
                {cards.length} product{cards.length === 1 ? "" : "s"}
              </span>
              <span>{lowCount} low stock</span>
            </div>
            <div className="grid">
              {cards.map((p) => (
                <div key={p.id} onClick={() => nav(`/products/${p.id}`)}>
                  <ProductCard p={p} />
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <Link to="/products/new" className="fab" aria-label="Add product">
        +
      </Link>
    </>
  );
}
