/* Operation ledger (ADR-0001): every client edit carries a client-generated
 * Operation ID; applyOnce runs the edit at most once per ID and remembers the
 * result, so replayed or retried requests get "already applied, here's the
 * result" instead of a second application. A failed edit (throw) is NOT
 * recorded — the retry will genuinely try again. */
import { db, txn } from "./db.js";

export function applyOnce<T>(opId: unknown, kind: string, fn: () => T): T {
  if (!opId || typeof opId !== "string" || opId.length > 64) {
    /* online clients that predate the outbox, or stray calls — behave as always */
    return fn();
  }
  return txn(() => {
    const prev = db.prepare("SELECT result FROM ops WHERE id = ?").get(opId) as
      | { result: string }
      | undefined;
    if (prev) {
      const out = JSON.parse(prev.result) as T;
      return out;
    }
    const result = fn();
    db.prepare("INSERT INTO ops (id, kind, result, at) VALUES (?,?,?,?)").run(
      opId,
      kind,
      JSON.stringify(result ?? null),
      Date.now()
    );
    return result;
  });
}
