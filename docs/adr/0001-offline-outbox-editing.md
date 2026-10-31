# Offline-first editing via a client Outbox with server-side Operation-ID dedupe

Status: accepted

## Decision

All shop edits (sales, returns, stock movements, product/variant changes) are written client-side
into an **Outbox** in the phone's browser storage, each edit carrying a client-generated **Operation
ID** born at confirm time. Replay sends queued edits in the order they were made; the server applies
each exactly once — the Operation ID is recorded inside the same transaction that applies the edit,
and a duplicate submission is answered "already applied, here's the result", never re-executed.

## Why

The one-server-phone architecture has an availability floor tied to home Wi-Fi; "server down = app
down" was accepted only until it produced bookkeeping ambiguity at the counter. The Outbox keeps the
single-source-of-truth server model (no bidirectional sync, no merge machinery) while letting the
shop keep billing through Wi-Fi hiccups. Operation-ID dedupe is the piece that makes replay safe —
without it, a request that reached the server but whose response was lost bills a customer twice.
It also removes that same double-charge on plain retries today.

## The rules that came with it

- **First come, first serve**: replay applies the queue in order; when stock is gone, the losing
  sale is rejected, never forced. Replayed edits never drive a variant's quantity negative.
- **Needs attention**: a rejected edit stays flagged in the Outbox until the shopkeeper resolves it
  on the phone (typically reduce lines to available stock, or cancel) — no silent clamps, no
  negative stock, no conflicts solved by the server's initiative.
- **Field edits are last-write-wins in replay order** (the later edit wins). Stock is the exception:
  quantities never merge into existence.
- **Bills are stamped with the phone's clock** — when they were written, not when the server
  received them; the server keeps its received-at time internally for forensics.
- **Cached reads are never hidden**, however old; the offline UI escalates how loudly it marks the
  data's age instead of blanking.
- **The Outbox is visible**: offline-bar badge, per-screen row markers, and a Settings Outbox screen
  (list, resolve, delete, caveat: deleting an unsynced sale means it never entered the book). The
  deletion is deliberate and warned, never automatic.
- **Storage posture**: `navigator.storage.persist()` + installed-PWA target; the Outbox screen states
  the contract ("unsynced edits are kept in this phone only"). No hidden scratch copies.
- **Server restore is transparent** (dedupe ledger and re-application in bill-time order cover
  newer/older backups). A hard server reset with pending edits blocks re-pairing behind a resolution
  notice, with a plain-text export valve so queued money is never silently wiped.
- **Photos stay online-only** in this phase: queued uploads need the Apple P3 bypass pipeline
  re-validated through the queue before they can be trusted.

## Considered alternatives

- **Clamp/block overselling replays silently or byte the bill** — rejected: it rewrites what the
  customer was physically sold, and history-editing needs a human, not a heuristic.
- **Field-level 3-way merge for concurrent edits** — rejected: complexity with no story to justify
  it for a home shop; last-write-wins in replay order is explainable.
- **Time-limited/hidden stale cache** — rejected: hidden books are "app down" for the shop's memory;
  visible stale data plus Needs-attention rules keeps every consequence honest.
