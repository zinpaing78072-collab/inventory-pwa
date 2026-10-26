import { randomBytes } from "node:crypto";

import { HttpError } from "./errors.js";

import { db, setMeta, getMeta, txn } from "./db.js";
import type { DeviceInfo, PairInfo } from "@inv/shared";

/* ---------- device / pairing management. No logins: one-time code -> device token. ---------- */

const PAIRING_TTL_MS = 10 * 60 * 1000; // codes expire; regenerate any time from Settings

export function deviceCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM devices").get() as { n: number };
  return row.n;
}

export function currentPairingCode(): string {
  const code = getMeta("pairing_code");
  const created = Number(getMeta("pairing_created_at", "0"));
  if (code && Date.now() - created < PAIRING_TTL_MS) return code;
  const fresh = String(Math.floor(100000 + Math.random() * 900000));
  setMeta("pairing_code", fresh);
  setMeta("pairing_created_at", String(Date.now()));
  return fresh;
}

export function regeneratePairingCode(): string {
  setMeta("pairing_created_at", "0");
  return currentPairingCode();
}

export function pairingAlive(): boolean {
  const created = Number(getMeta("pairing_created_at", "0"));
  return Date.now() - created < PAIRING_TTL_MS;
}

export function pairInfo(): PairInfo {
  const paired = deviceCount() > 0;
  return {
    paired,
    code: paired && !pairingAlive() ? null : currentPairingCode(),
    shopName: getMeta("shop_name", "TH Fashion") ?? "TH Fashion",
  };
}

type AuthedRequest = { headers: Record<string, unknown>; query: Record<string, unknown> };
type AuthedResponse = { status(code: number): { json(body: unknown): void } };

/** Express middleware: valid device token (header or ?t=), OR the request
 * arriving from the server phone itself (loopback). Loopback access keeps
 * pairing recoverable when every paired phone loses its token at once (e.g.
 * the server address changed) — random devices on the LAN still can't mint
 * codes, but someone at the server phone always can. */
export function requireDeviceOrLocal(req: any, res: any, next: any): void {
  const ip: string = String(req.ip ?? req.socket?.remoteAddress ?? "");
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    next();
    return;
  }
  requireDevice(req, res, next);
}

/** Express middleware: requires a valid device token (header or ?t=). */
export function requireDevice(req: any, res: any, next: any): void {
  const header = req.headers["authorization"];
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : String(req.query.t ?? "");
  const device = findDeviceByToken(token);
  if (!device) {
    res.status(401).json({ error: "unpaired" });
    return;
  }
  touchDevice(device.id);
  req.device = device;
  next();
}

export function pairWithCode(code: string, name: string): string {
  if (!pairingAlive() || code !== getMeta("pairing_code")) {
    throw new HttpError("Wrong or expired pairing code", 403);
  }
  const token = randomBytes(24).toString("hex");
  txn(() => {
    db.prepare(
      "INSERT INTO devices (name, token, created_at, last_seen) VALUES (?, ?, ?, ?)"
    ).run(name || "Phone", token, Date.now(), Date.now());
    db.prepare("DELETE FROM meta WHERE k = 'pairing_code'").run();
    db.prepare("DELETE FROM meta WHERE k = 'pairing_created_at'").run();
  });
  return token;
}

export function findDeviceByToken(token: string): DeviceInfo | undefined {
  if (!token) return undefined;
  const row = db
    .prepare("SELECT id, name, created_at, last_seen FROM devices WHERE token = ?")
    .get(token) as { id: number; name: string; created_at: number; last_seen: number } | undefined;
  return row
    ? { id: row.id, name: row.name, createdAt: row.created_at, lastSeen: row.last_seen }
    : undefined;
}

export function listDevices(): (DeviceInfo & { tokenTail: string })[] {
  const rows = db
    .prepare("SELECT id, name, created_at, last_seen, token FROM devices ORDER BY created_at")
    .all() as { id: number; name: string; created_at: number; last_seen: number; token: string }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
    tokenTail: r.token.slice(-4),
  }));
}

export function touchDevice(id: number): void {
  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ? AND last_seen < ?").run(
    Date.now(),
    id,
    Date.now() - 60000
  );
}

export function revokeDevice(id: number): void {
  db.prepare("DELETE FROM devices WHERE id = ?").run(id);
}
