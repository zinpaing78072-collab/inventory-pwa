# Inventory PWA — TH Fashion

Stock + sales for a small home clothing shop. One Android phone is the server
(Termux + Node + SQLite); every other phone opens the PWA in its browser.
Full design decisions: `../inventory-pwa-handoff.md`.

## Monorepo layout

```
apps/server       Node + TypeScript + SQLite (node:sqlite, zero native deps)
apps/web          React + Vite PWA (served by the server)
packages/shared   types + money/stock formatting, shared by both sides
```

## Local development (this Mac)

```sh
pnpm install
pnpm seed            # dev-only: prototype's mock shop (12 products, 3 customers)
pnpm dev:server      # API on http://localhost:7300
pnpm dev:web         # Vite on http://localhost:5173 (proxies /api + /photos)
```

Open http://localhost:5173. If not paired: the code is printed by the server console
at boot, or fetch `curl localhost:7300/api/pair-info`. Enter it on the pair screen.

Lint/type safety: `pnpm typecheck`. Build both apps: `pnpm build`.

## Deploying to the server phone (Termux)

One-time:

```sh
pkg install nodejs-lts git
pipy? no → npm install -g pnpm pm2
termux-wake-lock        # keep Termux awake
# clone your private repo:
git clone https://github.com/<you>/inventory-pwa && cd inventory-pwa
pnpm install
pnpm --filter @inv/server build && pnpm --filter @inv/web build
pm2 start ecosystem.config.cjs && pm2 save
```

Every later deploy: `./update.sh` (git pull → install → build → pm2 restart).

Notes:
- `apps/server/data/` holds the DB + photos — never committed (gitignored).
- Server binds 0.0.0.0:7300; reach it on the home Wi-Fi via the phone's IP
  (the server prints its LAN URL at boot).
- Keep the server phone plugged in; pm2 + wake-lock cover reboots and screen lock.
- Backup: daily snapshot in `data/backups/` + one-tap copy from any phone
  (banner on Home / button in Settings). Restore = pair a new phone, copy the
  latest `.db`, and drop it into `data/` (docs to grow when restore UI lands).

## API sketch (v1)

`GET /api/health`, `GET /api/pair-info`, `POST /api/pair`, `GET /api/seq`
(poll), products CRUD + search, movements (stock-in/adjust), sales + returns,
customers, photos (multipart, client-compressed), devices, backup. All guarded
by device tokens except health/pair/pair-info.

## Known v1 boundaries

- No offline writes by design (hand-off §2): edits pause when the server is down.
- PWA installability over plain-LAN http is imperfect on some browsers
  (hand-off §5.6); it works best via Chrome "Add to Home screen".
- No service worker yet — the UI loads from the server each visit.
