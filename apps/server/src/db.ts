import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* Database bootstrap. One SQLite file per server phone (never committed). */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "data");
export const PHOTOS_DIR = path.join(DATA_DIR, "photos");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const BACKUP_PHOTOS_DIR = path.join(BACKUPS_DIR, "photos-current");

mkdirSync(PHOTOS_DIR, { recursive: true });
mkdirSync(BACKUPS_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "inventory.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

const SCHEMA_VERSION = 1;

export function migrate(): void {
  const dbv = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (dbv >= SCHEMA_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      price INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      color_id INTEGER REFERENCES colors(id) ON DELETE CASCADE,  -- NULL until attached to a color
      filename TEXT NOT NULL UNIQUE,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      color_id INTEGER NOT NULL REFERENCES colors(id) ON DELETE CASCADE,
      size_id INTEGER NOT NULL REFERENCES sizes(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL DEFAULT 0,
      UNIQUE(product_id, color_id, size_id)
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,           -- stock-in | adjust | sale | return
      variant_id INTEGER NOT NULL REFERENCES variants(id),
      product_id TEXT NOT NULL,
      delta INTEGER NOT NULL,       -- signed; + stock-in/return, - sale
      note TEXT NOT NULL DEFAULT '',
      sale_id TEXT,
      device_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mov_product ON movements(product_id, at DESC);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone1 TEXT NOT NULL DEFAULT '',
      phone2 TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      customer_id TEXT REFERENCES customers(id),
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id, at DESC);

    CREATE TABLE IF NOT EXISTS sale_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      variant_id INTEGER NOT NULL REFERENCES variants(id),
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      color_name TEXT NOT NULL DEFAULT '',
      size_label TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL,
      price INTEGER NOT NULL,       -- unit price at sale time (Ks)
      returned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lines_sale ON sale_lines(sale_id);

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
  `);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/* meta helpers */
export function getMeta(key: string, fallback: string | null = null): string | null {
  const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(key) as { v: string } | undefined;
  return row ? row.v : fallback;
}
export function setMeta(key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
  ).run(key, value);
}

export function changeSeq(): number {
  return Number(getMeta("change_seq", "0"));
}
export function bumpChangeSeq(): void {
  db.prepare("UPDATE meta SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT) WHERE k = 'change_seq'").run();
}

export function ensureChangeSeq(): void {
  if (getMeta("change_seq") === null) setMeta("change_seq", "0");
}

export function newId(): string {
  return crypto.randomUUID();
}

/* run fn inside a transaction; throw rolls back */
export function txn<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    bumpChangeSeq();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

migrate();
ensureChangeSeq();
