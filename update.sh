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
if [ -n "${TERMUX_VERSION:-}" ]; then
  # Termux: pnpm's script layer mangles multi-flag build commands into phantom
  # arguments (esbuild reports "multiple input files"), so call the tools
  # directly instead of going through the package.json scripts.
  ( cd apps/server && ./node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js )
  ( cd apps/web && ./node_modules/.bin/vite build )
else
  pnpm --filter @inv/server build
  pnpm --filter @inv/web build
fi

echo "==> restarting server (pm2)"
pm2 restart inventory-server 2>/dev/null || pm2 start ecosystem.config.cjs

echo ""
echo "==> done. Other phones: hard-refresh the PWA (pull-to-restart) to pick up the new UI."
