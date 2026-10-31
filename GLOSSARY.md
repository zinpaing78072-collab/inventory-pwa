# Inventory PWA

The shared language of the shop's stock book: a mobile PWA for a small home clothing shop, with one Android phone (Termux + Node) hosting the server on the home Wi-Fi and other phones acting as clients.

## Language

### Offline editing

**Outbox**:
The phone's list of offline edits made while the server was unreachable, waiting to be sent when it is back.
_Avoid_: queue (as the user-facing name), sync folder, pending pile

**Offline sale**:
A sale recorded into the Outbox while the server was down — the bill happened in the physical shop, its bookkeeping is just waiting.

**Replay**:
Sending a queued Outbox edit to the server in the order it was made. The server applies each edit in turn; replay order is who-got-it-first order.

**Needs attention**:
The state of an Outbox edit that the server rejected during Replay and cannot settle by itself — most commonly a sale whose stock was already gone. It stays flagged until the shopkeeper resolves it.

**Operation ID**:
The unique identity an edit is born with when the shopkeeper confirms it — the server applies it exactly once and answers any resubmission with "already applied, here's the result". An ID is permanent; a retried edit never becomes a second edit.
_Avoid_: transaction id, request id, dedupe key

**Photo upload**:
The one write that is always online-only in phase 1: photos taken while offline stay local and are attached to the product when connectivity returns.
_Avoid_: queued photo, deferred upload

### Editing behaviours

**Deliberate quantity**:
Quantities are never assumed. Anything the shopkeeper adds to a bill or a sale opens at quantity 0; only an explicit + makes it real.
_Avoid_: auto-add, default 1
