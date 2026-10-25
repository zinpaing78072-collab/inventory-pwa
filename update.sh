#!/bin/sh
# update.sh — run this on the server phone (Termux) to deploy the latest code.
# git pull -> install -> build -> restart. Data (SQLite + photos) is untouched.
set -e
cd "$(dirname "$0")"

echo "==> pulling latest code"
git pull --ff-only

echo "==> installing dependencies"
pnpm install --frozen-lockfile

echo "==> building (server bundle + PWA)"
# esbuild's JS API everywhere: CLI argv handling breaks on Termux/Android.
(cd apps/server && node build.mjs)
(cd apps/web && ./node_modules/.bin/vite build)

echo "==> restarting server (pm2)"
pm2 restart inventory-server 2>/dev/null || pm2 start ecosystem.config.cjs

echo ""
echo "==> done. Other phones: hard-refresh the PWA (pull-to-restart) to pick up the new UI."
