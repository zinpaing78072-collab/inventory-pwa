import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";

import { api, getToken, ApiUnpairedError } from "./api";
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
  const [paired, setPaired] = useState<boolean>(false);
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [rev, setRev] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [backupPending, setBackupPending] = useState(false);

  const bump = useCallback(() => setRev((r) => r + 1), []);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2600);
  }, []);

  /* boot: verify the device token against a guarded route. A server that is
   * merely slow/asleep (Android Wi-Fi wake race when reopening the app) must
   * read as "reconnecting" + retry — never as "lost pairing", or phones that
   * are already registered get bounced to the pair screen every session. */
  useEffect(() => {
    if (!getToken()) {
      setPaired(false);
      setBooting(false);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const attempt = async () => {
      try {
        await api.settings();
        if (!alive) return;
        setOnline(true);
        setPaired(true);
        setBooting(false);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiUnpairedError) {
          /* token provably dead (server answered 401) — genuinely re-pair */
          setPaired(false);
          setBooting(false);
          return;
        }
        /* unreachable (offline/timeout/server hiccup): keep the token, retry */
        setOnline(false);
        timer = window.setTimeout(attempt, 2500);
      }
    };
    void attempt();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
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

  if (booting) {
    return <div className="boot-msg">Connecting to the TH Fashion server…</div>;
  }

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
