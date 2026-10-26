import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Sale } from "@inv/shared";
import { mmk } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import { dateShort } from "../components/util";

/* Sales book: recent sales, newest first. The ＋ button opens the Record screen. */
export default function Sales() {
  const nav = useNavigate();
  const { rev } = useApp();
  const [sales, setSales] = useState<Sale[] | null>(null);

  useEffect(() => {
    void api
      .sales(60)
      .then(setSales)
      .catch(() => setSales([]));
  }, [rev]);

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
          <div className="hist-row" key={s.id}>
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
    </>
  );
}
