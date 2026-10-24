import { useEffect, useState } from "react";
import { api } from "../api";
import type { PairInfo } from "@inv/shared";

/** First-run screen shown when this phone isn't paired yet.
 * The server shows its 6-digit code (Settings screen or console), we enter it here. */
export default function Pair({ onPaired }: { onPaired: () => void }) {
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.pairInfo().then(setInfo).catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const { token } = await api.pair(code.trim(), name.trim());
      const { setToken } = await import("../api");
      setToken(token);
      onPaired();
    } catch (e: unknown) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(360px, 100%)" }}>
        <div className="wordmark" style={{ textAlign: "center", marginBottom: 22 }}>
          TH Fashion
          <small>Inventory</small>
        </div>
        <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>Pair this phone</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          Enter the 6-digit code shown on the server phone's Settings screen. One-time — after
          pairing this phone stays connected.
        </p>
        {info && (
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Server: <b>{info.shopName}</b>
            {!info.paired && info.code && (
              <>
                {" "}
                (server is new — its code is <b>{info.code}</b>)
              </>
            )}
            {info.paired && !info.code && (
              <> — open Settings there and tap “New code” to add another phone.</>
            )}
          </p>
        )}
        <div className="frow">
          <label>Pairing code</label>
          <input
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        <div className="frow">
          <label>This phone's name (optional)</label>
          <input placeholder="e.g. Shop phone, Kan's phone" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button
          className="btn primary"
          style={{ width: "100%", marginTop: 16 }}
          disabled={busy || code.length !== 6}
          onClick={submit}
        >
          {busy ? "Pairing…" : "Pair"}
        </button>
      </div>
    </div>
  );
}
