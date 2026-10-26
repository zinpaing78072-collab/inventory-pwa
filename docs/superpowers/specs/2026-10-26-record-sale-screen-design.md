# Record-sale screen (cart) — design (2026-10-26)

**Interaction set by user:** replaces the old per-product "Record sale" bottom sheet. The
Record Sale button on a product detail opens a dedicated screen (`/sell?product=<id>`)
preloaded with that product. One customer, many product lines (product + color + per-size
quantity), one discount applied to the whole bill. Approaches were laid out (per-line
vs whole-bill discount); the user picked whole-bill. An interactive prototype was reviewed
and approved (`/Users/macbookpro/Documents/inventory-pwa-recordscreen-prototype/record.html`).

## Goals
- Sell several products in one bill on one screen, stock dropping per line at confirm, atomically.
- Discount (whole kyat, ≥ 0) stored on the sale; payable = items total − discount.
- Customer logic unchanged: picker/dedupe by phone suffix/name, notes captured at sale time.

## Non-goals
- Per-line discount, price editing at sale time (same PR may later add if asked).
- Orders/drafts: the sale commits instantly; online-only edits, no offline queue.

## Parts (built)
- **DB v3**: `sales.discount INTEGER NOT NULL DEFAULT 0` (migration-safe ALTER).
- **Server**: `POST /api/sales` accepts `discount`, validates ≤ items total (400 otherwise);
  `getSale` returns `total` (items), `discount`, `payable (total − discount)`.
- **Web**: `screens/Record.tsx` route `/sell`; customer section (same fields + matches),
  line list (thumb, tap-pill cycles color of that line, per-size steppers capped at stock,
  line ✕ and line amount), "＋ Add product" sheet (debounced product search → product →
  color-way chips → line; duplicate product+color blocked with a hint), discount input,
  summary card, note, sticky confirm bar showing payable. On server error the screen
  re-pulls every product in the bill to refresh stock. After success: toast with payable,
  navigates back to where the user came from.
- **Customers book**: lifetime total now sums `payable` (discounted bills).
- Old `RecordSaleSheet` + its customer fields moved into the new screen; `Stepper` is shared.

## Behaviors settled in conversation
- Steppers respect per-variant stock at load time; server re-checks atomically (409 with
  the failing name if anything shifted).
- Confirm disabled only by `busy`; empty bill / bad discount surface in-screen errors.
- A line's color can be cycled after adding (tap the thumb/pill).
