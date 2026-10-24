import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ProductFull } from "@inv/shared";
import { mmk, stockClass, stockText } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import { RecordSaleSheet, StockInSheet, AdjustSheet, HistorySheet } from "../components/actions";
import { photoUrlOf } from "../components/util";

type Sheet = "sale" | "stockin" | "adjust" | "history" | null;

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { rev, toast } = useApp();
  const [p, setP] = useState<ProductFull | null>(null);
  const [colorIdx, setColorIdx] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [historyData, setHistoryData] = useState<Awaited<ReturnType<typeof api.history>> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setP(await api.product(id));
    } catch {
      nav("/", { replace: true });
    }
  }, [id, nav]);

  useEffect(() => {
    setColorIdx(0);
    void load();
  }, [load, rev]);

  if (!p) return <div className="spin">Loading…</div>;

  const color = p.colors[colorIdx];
  const total = p.totalQty;

  const openHistory = async () => {
    setHistoryData(await api.history(p!.id));
    setSheet("history");
  };

  return (
    <>
      <header className="head">
        <div className="head-top">
          <Link to="/" style={{ fontSize: 14 }}>
            ‹ Products
          </Link>
          <Link to={`/products/${p.id}/edit`} style={{ fontSize: 13, fontWeight: 620 }}>
            Edit
          </Link>
        </div>
      </header>

      <div className="detail-wrap">
        <div className="gallery">
          {color?.photos[0] ? (
            <img src={photoUrlOf(color.photos[0].filename)} alt={p.name} />
          ) : (
            <div className="ph">No photo yet — add one in Edit</div>
          )}
          {p.colors.length > 1 && (
            <>
              <button
                className="tile-btn left"
                aria-label="Previous color"
                onClick={() => setColorIdx((i) => (i - 1 + p.colors.length) % p.colors.length)}
              >
                ‹
              </button>
              <button
                className="tile-btn right"
                aria-label="Next color"
                onClick={() => setColorIdx((i) => (i + 1) % p.colors.length)}
              >
                ›
              </button>
              <span className="colorpill">{color.name}</span>
            </>
          )}
        </div>

        <div className="detail-name">{p.name}</div>
        <div className="detail-sub">
          {p.brand}
          {p.brand && p.type ? " · " : ""}
          {p.type}
          {p.colors.length > 1 ? "" : ` · ${p.colors[0]?.name ?? ""}`}
        </div>
        {p.notes && <div className="detail-notes">{p.notes}</div>}

        <div className="size-table">
          {p.sizes.map((s) => {
            const key = `${color?.id}|${s.id}`;
            const q = p.qty[key] ?? 0;
            return (
              <div className="size-row" key={s.id}>
                <span className="size-lab">{s.label}</span>
                <span />
                <span className="size-price">{mmk(s.price)}</span>
                <span className={`size-qty ${stockClass(q)}`}>{stockText(q)}</span>
              </div>
            );
          })}
        </div>

        <div className="actions">
          <button className="btn primary" onClick={() => setSheet("sale")}>
            Record sale
          </button>
          <button className="btn" onClick={() => setSheet("stockin")}>
            Stock in
          </button>
          <button className="btn" onClick={() => setSheet("adjust")}>
            Adjust
          </button>
          <button className="btn" onClick={openHistory}>
            History
          </button>
        </div>

        {total === 0 && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted)" }}>
            All colors of this product are sold out. It stays searchable (per the spec), or archive
            it from Edit.
          </div>
        )}
      </div>

      {sheet === "sale" && (
        <RecordSaleSheet
          product={p}
          onClose={() => setSheet(null)}
          onDone={() => {
            toast("Sale recorded");
            void load();
          }}
        />
      )}
      {sheet === "stockin" && (
        <StockInSheet
          product={p}
          onClose={() => setSheet(null)}
          onDone={() => {
            toast("Stock added");
            void load();
          }}
        />
      )}
      {sheet === "adjust" && (
        <AdjustSheet
          product={p}
          onClose={() => setSheet(null)}
          onDone={() => {
            toast("Stock adjusted");
            void load();
          }}
        />
      )}
      {sheet === "history" && historyData && (
        <HistorySheet
          product={p}
          history={historyData}
          onClose={() => {
            setSheet(null);
            void load();
          }}
        />
      )}
    </>
  );
}
