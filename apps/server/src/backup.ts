import { readdirSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

/* ---------- daily backup: SQLite snapshot + incremental photo mirror ----------
 * Honest mechanical limit: nothing on a phone can save a file without the user
 * glancing at it, so "automatic" = the server builds snapshots daily and any
 * opened phone fetches with one tap (see /api/backup/latest + status).
 */

import { db, BACKUPS_DIR, BACKUP_PHOTOS_DIR, PHOTOS_DIR, getMeta, setMeta } from "./db.js";

const KEEP_SNAPSHOTS = 7;

function snapshotDb(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(BACKUPS_DIR, `inventory-${stamp}.db`);
  /* VACUUM INTO is safe on a live WAL database and yields a compact single-file snapshot */
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}

/** Incremental photo mirror: copy any photo file not yet present in the mirror dir. */
function mirrorPhotos(): number {
  mkdirSync(BACKUP_PHOTOS_DIR, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(PHOTOS_DIR)) {
    const src = path.join(PHOTOS_DIR, f);
    const dst = path.join(BACKUP_PHOTOS_DIR, f);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      copied++;
    }
  }
  return copied;
}

function rotate(): void {
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP_SNAPSHOTS)) {
    try {
      unlinkSync(path.join(BACKUPS_DIR, old));
    } catch {
      /* ignore */
    }
  }
}

export function runBackup(): void {
  snapshotDb();
  mirrorPhotos();
  rotate();
  setMeta("backup_last_run", String(Date.now()));
  // "copied off" resets on each new snapshot: every day needs one fresh copy on a second device
}

export interface BackupStatus {
  lastRun: number | null;
  copiedOffAt: number | null;
  count: number;
}

export function backupStatus(): BackupStatus {
  const lastRun = Number(getMeta("backup_last_run", "0")) || null;
  const copiedRaw = Number(getMeta("backup_copied_at", "0")) || null;
  const count = readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".db")).length;
  const valid = copiedRaw && lastRun && copiedRaw >= lastRun ? copiedRaw : null;
  return { lastRun, copiedOffAt: valid, count };
}

export function backupNeedsCopy(): boolean {
  const s = backupStatus();
  return s.lastRun !== null && s.copiedOffAt === null;
}

function latestSnapshot(): string | null {
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort()
    .reverse();
  return files[0] ? path.join(BACKUPS_DIR, files[0]) : null;
}

export function registerBackupRoutes(api: any, requireDevice: any): void {
  api.get("/backup/status", requireDevice, (_req: any, res: any) => {
    res.json(backupStatus());
  });

  api.post("/backup/run", requireDevice, (_req: any, res: any) => {
    runBackup();
    res.json(backupStatus());
  });

  /* one tap: current phone takes a copy of today's snapshot */
  api.get("/backup/latest", requireDevice, (_req: any, res: any) => {
    const file = latestSnapshot();
    if (!file) return res.status(404).json({ error: "no backup yet" });
    setMeta("backup_copied_at", String(Date.now()));
    res.download(file, path.basename(file));
  });
}

export function startBackupJob(): void {
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  const tick = () => {
    try {
      const last = Number(getMeta("backup_last_run", "0"));
      const dayStart = startOfTodayMs();
      if (last < dayStart) runBackup();
    } catch (err) {
      console.error("backup job failed:", err);
    }
  };
  tick(); // first check at boot
  setInterval(tick, CHECK_INTERVAL_MS);
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
