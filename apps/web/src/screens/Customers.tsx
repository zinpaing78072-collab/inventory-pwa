import { useEffect, useState } from "react";
import type { Customer, Sale } from "@inv/shared";
import { mmk } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import { BottomSheet } from "../components/BottomSheet";
import { ReturnSheet } from "../components/actions";
import { dateShort, initials, nowDateLabel } from "../components/util";

/* Customers screen: separate from products (per Q19 — settled as separate screens).
 *     Search name / phone -> chip list; tap -> history sheet with returns. */

export default function Customers() {
  const { rev } = useApp();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[] | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.customer>> | null>(null);
  const [adding, setAdding] = useState(false);
  const [returning, setReturning] = useState<{ sale: Sale; reload: () => void } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(
      () =>
        void api
          .customers(q)
          .then(setList)
          .catch(() => setList([])),
      q ? 160 : 0
    );
    return () => window.clearTimeout(t);
  }, [q, rev, adding]);

  const openDetail = async (id: string) => {
    setDetail(await api.customer(id));
  };

  return (
    <>
      <header className="head">
        <div className="head-top">
          <div className="wordmark">
            <img className="logo" src="/logo.png" alt="" />
            TH Fashion
            <small>Customers</small>
          </div>
          <span className="date">{nowDateLabel()}</span>
        </div>
        <div className="search">
          <span className="mag">⌕</span>
          <input placeholder="Search name or phone number" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear" style={{ color: "var(--muted)" }}>
              ✕
            </button>
          )}
        </div>
      </header>

      <main style={{ padding: "16px 16px 30px" }}>
        {list === null && <div className="spin">Loading…</div>}
        {list !== null && list.length === 0 && (
          <div className="empty">
            <p>
              <b>{q ? `No customers match “${q}”` : "No customers yet"}</b>
            </p>
            <p style={{ fontSize: 12 }}>
              {q ? "Try part of a name, or the last digits of a phone." : "Customers appear here when you record sales with a name."}
            </p>
          </div>
        )}
        {list !== null && list.length > 0 && (
          <div className="chips" style={{ gap: 10 }}>
            {list.map((c) => (
              <button key={c.id} className="custchip" onClick={() => void openDetail(c.id)}>
                <span className="av">{initials(c.name)}</span>
                <span>
                  <span className="cn">{c.name}</span>
                  <br />
                  <span className="cp">{c.phone1 || c.phone2 || "—"}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      {detail && (
        <CustomerSheet
          data={detail}
          onClose={() => setDetail(null)}
          onRefreshed={async () => setDetail(await api.customer(detail.customer.id))}
          onReturn={(sale) => setReturning({ sale, reload: () => void openDetail(detail.customer.id) })}
        />
      )}

      {adding && <AddCustomerSheet onClose={() => setAdding(false)} />}

      {returning && (
        <ReturnSheet
          sale={returning.sale}
          onClose={() => {
            setReturning(null);
            returning.reload();
          }}
          onDone={() => void 0}
        />
      )}

      <button className="fab" aria-label="Add customer" onClick={() => setAdding(true)}>
        +
      </button>
    </>
  );
}

/* ---------------- customer detail (bottom sheet, per prototype) ---------------- */

function CustomerSheet({
  data,
  onClose,
  onRefreshed,
  onReturn,
}: {
  data: { customer: Customer; sales: Sale[] };
  onClose: () => void;
  onRefreshed: () => Promise<void>;
  onReturn: (sale: Sale) => void;
}) {
  const c = data.customer;
  const grand = data.sales.reduce((a, s) => a + (s.payable ?? s.total), 0);
  return (
    <>
      <div className="sheetmask" onClick={onClose} />
      <div className="sheet">
        <div className="grab" />
        <div className="flexrow" style={{ margin: "6px 0 0" }}>
          <div>
            <h3 style={{ margin: 0 }}>{c.name}</h3>
            <div className="sub">
              {c.phone1}
              {c.phone2 ? ` · ${c.phone2}` : ""}
            </div>
          </div>
          <button
            className="btn small"
            onClick={async () => {
              const name = prompt("Name", c.name);
              if (name === null) return;
              const p1 = prompt("Phone 1", c.phone1);
              const p2 = prompt("Phone 2", c.phone2);
              const nt = prompt("Notes", c.notes ?? "");
              if (p1 !== null || p2 !== null || nt !== null) {
                await api.patchCustomer(c.id, {
                  name,
                  phone1: p1 ?? c.phone1,
                  phone2: p2 ?? c.phone2,
                  notes: nt ?? c.notes ?? "",
                });
                await onRefreshed();
              }
            }}
          >
            Edit
          </button>
        </div>
        {c.notes && <div className="sub" style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{c.notes}</div>}
        <div className="chips-label">Purchase history</div>
        {data.sales.length === 0 && <div className="sub" style={{ padding: "8px 0 14px" }}>No purchases yet.</div>}
        {data.sales.map((s) => (
          <div key={s.id}>
            {s.lines.map((l) => (
              <div className="hist-row" key={l.id}>
                <span className="when">{dateShort(s.at)}</span>
                <span>
                  {l.productName}{" "}
                  <span className="hist-note">
                    · {l.colorName} {l.sizeLabel} ×{l.qty}
                    {l.returned > 0 ? ` (${l.returned} returned)` : ""}
                  </span>
                </span>
                <span className="amt">{mmk(l.qty * l.price)}</span>
              </div>
            ))}
            {s.lines.some((l) => l.qty - (l.returned ?? 0) > 0) && (
              <div style={{ margin: "6px 0" }}>
                <button className="btn small" onClick={() => onReturn(s)}>
                  Return items…
                </button>
              </div>
            )}
          </div>
        ))}
        <div className="total-line">
          <span>Lifetime total</span>
          <span>{mmk(grand)}</span>
        </div>
        {data.sales.length === 0 && (
          <div className="chips" style={{ marginTop: 10 }}>
            <button
              className="btn small danger"
              onClick={async () => {
                if (!confirm(`Delete ${c.name}?`)) return;
                await api.deleteCustomer(c.id);
                onClose();
              }}
            >
              Delete customer
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- add customer ---------------- */

function AddCustomerSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState("");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      setErr("Name required");
      return;
    }
    setBusy(true);
    try {
      await api.createCustomer({ name: name.trim(), phone1, phone2, notes });
      toast("Customer added");
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
        <h3>Add customer</h3>
        <div className="frow">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="frow f2">
          <div>
            <label>Phone 1</label>
            <input inputMode="tel" value={phone1} onChange={(e) => setPhone1(e.target.value)} />
          </div>
          <div>
            <label>Phone 2</label>
            <input inputMode="tel" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
          </div>
        </div>
        <div className="frow">
          <label>Notes (optional)</label>
          <input
            placeholder="Regular, sizes, delivery address…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Add customer"}
        </button>
      </div>
    </>
  );
}
