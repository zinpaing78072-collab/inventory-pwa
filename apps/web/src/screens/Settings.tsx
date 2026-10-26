import { useEffect, useState } from "react";
import type { DeviceInfo } from "@inv/shared";
import { api } from "../api";
import { useApp } from "../App";
import QRCode from "qrcode";

/* Settings: pairing, devices, backup. Backups live on the server phone
 * (hand-off §7); "Copy" pulls today's snapshot onto this phone. */

export default function Settings() {
  const { toast, bump, rev } = useApp();
  const [shopName, setShopName] = useState("");
  const [devices, setDevices] = useState<(DeviceInfo & { tokenTail: string })[] | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [backup, setBackup] = useState<{ lastRun: number | null; copiedOffAt: number | null; count: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      api.settings().then((s) => setShopName(s.shopName)).catch(() => void 0);
      api.devices().then(setDevices).catch(() => setDevices([]));
      api.backupStatus().then(setBackup).catch(() => void 0);
      const info = await api.pairInfo().catch(() => null);
      setCode(info?.code ?? null);
      if (typeof location !== "undefined") {
        void QRCode.toDataURL(location.origin + location.pathname, { margin: 1, width: 220 }).then(setQr);
      }
    })();
  }, [rev, code]);

  const when = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

  return (
    <>
      <header className="head">
        <div className="head-top">
          <div className="wordmark">
            <img className="logo" src="/logo.png" alt="" />
            Settings
            <small>{shopName || "TH Fashion"}</small>
          </div>
        </div>
      </header>

      <main className="detail-wrap">
        <div className="card">
          <h4>Shop name</h4>
          <div className="frow" style={{ marginTop: 4 }}>
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              onBlur={() =>
                void api.patchSettings({ shopName }).then(() => {
                  toast("Shop name saved");
                  bump();
                })
              }
            />
          </div>
        </div>

        <div className="card">
          <h4>Add another phone</h4>
          <div className="dim">
            Open the shop's address ({typeof location !== "undefined" ? location.host : "server address"}) on the
            other phone, enter this code there:
          </div>
          <div className="paircode">{code ?? "No code — tap New code"}</div>
          <div className="chips">
            <button
              className="btn small"
              onClick={async () => {
                const r = await api.regenerateCode();
                setCode(r.code);
                toast("New code generated");
              }}
            >
              New code
            </button>
            <button
              className="btn small"
              onClick={() => {
                if (!code) {
                  toast("Tap New code first");
                  return;
                }
                void navigator.clipboard?.writeText(code).then(
                  () => toast("Code copied — long-press Paste in this phone's other app instance"),
                  () => toast("Could not copy")
                );
              }}
            >
              Copy code
            </button>
            <button
              className="btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(`${location.origin}${location.pathname}`).then(
                  () => toast("Server address copied — send it to the other phone"),
                  () => toast("Could not copy")
                );
              }}
            >
              Copy server address
            </button>
          </div>
          {qr && (
            <div style={{ display: "grid", placeItems: "center", marginTop: 10 }}>
              <img src={qr} alt="Server QR" width={180} height={180} />
              <span className="dim">Scan on the other phone to reach this server</span>
            </div>
          )}
        </div>

        <div className="card">
          <h4>Paired devices</h4>
          {(devices ?? []).map((d) => (
            <div className="devrow" key={d.id}>
              <span>
                <b>{d.name}</b>
                <div className="dim">
                  last seen {when(d.lastSeen)} · token …{d.tokenTail}
                </div>
              </span>
              <button
                className="btn small danger"
                onClick={async () => {
                  if (!confirm(`Un-pair “${d.name}”? That phone will need a new code.`)) return;
                  await api.revokeDevice(d.id);
                  setDevices((ds) => (ds ?? []).filter((x) => x.id !== d.id));
                  toast("Device un-paired");
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {devices !== null && devices.length === 0 && <div className="dim">None yet.</div>}
        </div>

        <div className="card">
          <h4>Backup</h4>
          {backup && (
            <div className="dim" style={{ lineHeight: 1.6 }}>
              Last snapshot: <b>{when(backup.lastRun)}</b> ({backup.count} kept on server)
              <br />
              Copied to a phone: <b>{backup.copiedOffAt ? when(backup.copiedOffAt) : "not yet"}</b>
              {backup.lastRun && backup.copiedOffAt === null && (
                <div style={{ color: "var(--amber)", marginTop: 4 }}>
                  Server phone holds the only copy — tap Copy on this device (or the banner on Home).
                </div>
              )}
            </div>
          )}
          <div className="chips" style={{ marginTop: 10 }}>
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setBackup(await api.runBackup());
                setBusy(false);
                toast("Snapshot created");
              }}
            >
              Run backup now
            </button>
            <a className="btn small" href={`/api/backup/latest?t=${localStorage.getItem("inv_token") ?? ""}`}>
              Copy to this phone
            </a>
          </div>
        </div>

        <div className="card">
          <h4>About</h4>
          <div className="dim" style={{ lineHeight: 1.6 }}>
            Inventory PWA · online-only edits · SQLite lives on the Android server phone.
            <br />
            If this phone loses the server, edits pause until it's back.
          </div>
        </div>
      </main>
    </>
  );
}
