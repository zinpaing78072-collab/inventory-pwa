import express from "express";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { api } from "./api.js";
import { startBackupJob } from "./backup.js";
import { PHOTOS_DIR } from "./db.js";
import { getMeta } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 7300);
const SHOP_NAME = () => getMeta("shop_name", "Inventory");

const app = express();
app.disable("x-powered-by");

/* API under /api; auth (pairing) is enforced inside api.js per route.
 * Note: /photos is served without the token middleware — files have
 * unguessable random names and the audience is the home LAN only. */
app.use("/api", api);

/* serve photos (files are random-named, unguessable, and the audience is home-LAN only) */
app.use(
  "/photos",
  express.static(PHOTOS_DIR, {
    maxAge: "365d",
    immutable: true,
    fallthrough: false,
  })
);

/* built PWA (apps/web/dist) — exists in production; vite dev server serves it in development */
const webDist = path.join(__dirname, "..", "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|photos).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SHOP_NAME()} inventory server`);
  console.log(`  local:    http://localhost:${PORT}`);
  for (const [_, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        console.log(`  network:  http://${info.address}:${PORT}`);
      }
    }
  }
  startBackupJob();
});
