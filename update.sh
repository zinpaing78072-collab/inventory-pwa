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
pnpm --filter @inv/server build
pnpm --filter @inv/web build

echo "==> restarting server (pm2)"
pm2 restart inventory-server 2>/dev/null || pm2 start ecosystem.config.cjs

echo ""
echo "==> done. Other phones: hard-refresh the PWA (pull-to-restart) to pick up the new UI."
