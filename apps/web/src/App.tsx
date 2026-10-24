import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";

import { api, getToken } from "./api";
import Pair from "./screens/Pair";
import Home from "./screens/Home";
import ProductDetail from "./screens/ProductDetail";
import EditProduct from "./screens/EditProduct";
import Customers from "./screens/Customers";
import Settings from "./screens/Settings";
import { BottomNav } from "./components/BottomNav";

/* ---------------- app context: pairing state, live data versioning, toasts ---------------- */

interface Ctx {
  paired: boolean;
  setPaired: (v: boolean) => void;
  /** bumps whenever any device mutates data; screens refetch on change */
  rev: number;
  bump: () => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const AppCtx = createContext<Ctx>({
  paired: false,
  setPaired: () => void 0,
  rev: 0,
  bump: () => void 0,
  toast: () => void 0,
  toastMsg: null,
});

export const useApp = () => useContext(AppCtx);

export default function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [rev, setRev] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [backupPending, setBackupPending] = useState(false);

  const bump = useCallback(() => setRev((r) => r + 1), []);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2600);
  }, []);

  /* boot: confirm pairing — server may have wiped this device (Settings -> revoke) */
  useEffect(() => {
    if (!getToken()) {
      setPaired(false);
      return;
    }
    api
      .health()
      .then((h) => {
        if (!h.paired) {
          /* server reports unpaired; verify our token against a guarded route */
          api
            .settings()
            .then(() => setPaired(true))
            .catch(() => {
              setPaired(false);
            });
        } else {
          setPaired(true);
        }
      })
      .catch(() => setPaired(false));
  }, []);

  /* polled freshness: ~5s; a change on any device bumps rev so screens refetch */
  useEffect(() => {
    if (!paired) return;
    let alive = true;
    let timer: number | undefined;
    let lastSeq: number | null = null;

    const tick = async () => {
      try {
        const { seq } = await api.seq();
        if (!alive) return;
        setOnline(true);
        if (lastSeq !== null && seq !== lastSeq) setRev((r) => r + 1);
        lastSeq = seq;
      } catch {
        if (alive) setOnline(false);
      }
      timer = window.setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [paired]);

  /* backup nudge: a snapshot exists but hasn't been copied off the server phone */
  useEffect(() => {
    if (!paired) return;
    api
      .backupStatus()
      .then((s) => setBackupPending(s.lastRun !== null && s.copiedOffAt === null))
      .catch(() => void 0);
  }, [paired, rev]);

  /* network status events */
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({ paired, setPaired, rev, bump, toast, toastMsg }),
    [paired, rev, toast, toastMsg]
  );

  if (!paired) {
    return (
      <Pair
        onPaired={() => {
          setPaired(true);
          setRev((r) => r + 1);
          toast("Paired. Welcome!");
        }}
      />
    );
  }

  return (
    <AppCtx.Provider value={ctx}>
      {!online && (
        <div className="offline-bar">Offline — edits sync once the server phone is reachable</div>
      )}
      {backupPending && <BackupBanner onDone={() => setBackupPending(false)} />}
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products/new" element={<EditProduct key="new" />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/products/:id/edit" element={<EditProduct />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>
      <BottomNav />
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </AppCtx.Provider>
  );
}

function BackupBanner({ onDone }: { onDone: () => void }) {
  return (
    <div className="backup-banner">
      <span>
        Today's backup is only on the server phone. <b>Copy</b> saves it to this phone.
      </span>
      <a
        className="btn small"
        href={`/api/backup/latest?t=${getToken() ?? ""}`}
        onClick={() => setTimeout(onDone, 800)}
      >
        Copy
      </a>
    </div>
  );
}

export type { ReactNode };
