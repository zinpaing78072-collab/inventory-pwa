import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Sale } from "@inv/shared";
import { mmk } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import { ReturnSheet } from "../components/actions";
import { dateShort } from "../components/util";

/* Sales book: recent sales, newest first. The ＋ button opens the Record screen;
 * tapping a row slides up that sale's detail (with Return when anything is
 * still returnable). */
export default function Sales() {
  const nav = useNavigate();
  const { rev } = useApp();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [open, setOpen] = useState<Sale | null>(null);
  const [returning, setReturning] = useState<Sale | null>(null);

  const load = useCallback(
    () => api.sales(60).then(setSales).catch(() => setSales([])),
    []
  );

  useEffect(() => {
    void load();
  }, [load, rev]);

  return (
    <>
      <header className="head">
        <div className="head-top">
          <div className="wordmark">
            Sales
            <small>the book · newest first</small>
          </div>
        </div>
      </header>

      <div className="sales-list">
        {sales?.length === 0 && (
          <div className="sub" style={{ padding: "16px 4px" }}>
            No sales yet. Tap ＋ to record the first one.
          </div>
        )}
        {(sales ?? []).map((s) => (
          <div className="hist-row sale-row" key={s.id} onClick={() => setOpen(s)}>
            <span className="when">{dateShort(s.at)}</span>
            <span>
              <b>{s.customerName || "Walk-in"}</b>
              <div className="hist-note">
                {s.lines.map((l) => `${l.productName} ${l.colorName} ${l.sizeLabel}×${l.qty}`).join(" · ")}
              </div>
            </span>
            <span className="amt">{mmk(s.payable)}</span>
          </div>
        ))}
      </div>

      <button className="fab" aria-label="Record a sale" onClick={() => nav("/sell")}>
        ＋
      </button>

      {/* sale detail slide */}
      {open && (
        <>
          <div className="sheetmask" onClick={() => setOpen(null)} />
          <div className="sheet">
            <div className="grab" />
            <div className="flexrow" style={{ margin: "6px 0 0" }}>
              <div>
                <h3 style={{ margin: 0 }}>{open.customerName || "Walk-in"}</h3>
                <div className="sub">{dateShort(open.at)}</div>
              </div>
            </div>
            {(open.customerPhone || open.customerNotes) && (
              <div className="sub" style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>
                {open.customerPhone}
                {open.customerNotes ? (open.customerPhone ? " · " : "") + open.customerNotes : ""}
              </div>
            )}
            <div className="chips-label">Items</div>
            {open.lines.map((l) => (
              <div className="hist-row" key={l.id}>
                <span className="when">{l.colorName ? `${l.colorName} ` : ""}{l.sizeLabel}×{l.qty}</span>
                <span>
                  {l.productName}
                  <span className="hist-note">
                    {" "}
                    · {l.price.toLocaleString("en-US")} Ks each
                    {l.returned > 0 ? ` · ${l.returned} returned` : ""}
                  </span>
                </span>
                <span className="amt">{mmk(l.qty * l.price)}</span>
              </div>
            ))}
            {open.discount > 0 && (
              <div className="hist-row">
                <span className="when" />
                <span>Discount</span>
                <span className="amt delta-neg">− {mmk(open.discount)}</span>
              </div>
            )}
            <div className="total-line">
              <span>Payable{open.discount > 0 ? " (after discount)" : ""}</span>
              <span>{mmk(open.payable)}</span>
            </div>
            {open.lines.some((l) => l.qty - (l.returned ?? 0) > 0) && (
              <div className="chips" style={{ margin: "10px 0 14px" }}>
                <button className="btn small" onClick={() => setReturning(open)}>
                  Return items…
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {returning && (
        <ReturnSheet
          sale={returning}
          onClose={() => setReturning(null)}
          onDone={() => {
            setReturning(null);
            setOpen(null);
            void load();
          }}
        />
      )}
    </>
  );
}
