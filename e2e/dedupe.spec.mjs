/* Slice-1 smoke test: the server's Operation-ID ledger (ADR-0001).
 * Boasts a sandboxed server on :7772 and asserts:
 *   1. the same __op submitted twice creates exactly ONE sale
 *   2. the same return __op twice returns stock exactly once
 *   3. the same stock-in __op twice stocks exactly once
 *   4. a FAILED edit is not marked applied — fixing the cause and
 *      resubmitting the very same __op then succeeds
 * Usage: node e2e/dedupe.spec.mjs   (exit 1 on any failure)
 */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";

const PORT = 7772;
const BASE = `http://localhost:${PORT}`;
const DATA = "/tmp/inv-ops-test/data";

const checks = [];
const check = (name, ok, extra = "") => {
  checks.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : `  (${extra})`}`);
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync("/tmp/inv-ops-test", { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
const server = spawn("node", ["apps/server/dist/server.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stderr.on("data", (d) => (serverLog += d));

let healthy = false;
for (let i = 0; i < 40 && !healthy; i++) {
  await sleep(250);
  healthy = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!healthy) {
  console.error("server never became healthy:\n" + serverLog);
  process.exit(1);
}

/* auto-detect server port in use? no — health answered, proceed */

const post = (path, body, token) =>
  fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

try {
  /* pair + seed */
  const code1 = (await (await fetch(`${BASE}/api/pairing/regenerate`, { method: "POST" })).json()).code;
  const token = (await post("/pair", { code: code1, name: "op-smoke" })).json.token;
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const prod = (
    await fetch(`${BASE}/api/products`, {
      method: "POST", headers: h,
      body: JSON.stringify({ name: "Ledger Dress", sizes: [{ label: "S", price: 10000 }], colors: [{ name: "Red" }] }),
    }).then((r) => r.json())
  );
  const full = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json();
  for (const key of Object.keys(full.variantIds)) {
    await post("/movements/stock-in", { variantId: full.variantIds[key], qty: 10 }, token);
  }
  const vid = full.variantIds[`${full.colors[0].id}|${full.sizes[0].id}`];

  /* 1: sale op submitted twice → one sale, one stock decrement */
  const stock0 = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  const opA = "9a2f7e3c-smoke-sale-0001";
  const r1 = await post("/sales", { __op: opA, lines: [{ variantId: vid, qty: 1 }] }, token);
  check("sale op: first submission records", r1.status === 200 && r1.json.id, r1.json.error ?? "");
  const r2 = await post("/sales", { __op: opA, lines: [{ variantId: vid, qty: 1 }] }, token);
  check("sale op twice: same sale id both times", r1.json.id === r2.json.id, `${r1.json.id} vs ${r2.json.id}`);
  const after1 = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  check("sale op twice: stock decremented exactly once", stock0 - after1 === 1, `stock0=${stock0} after=${after1}`);
  const salesList = await (await fetch(`${BASE}/api/sales?limit=60`, { headers: h })).json();
  check("sale op twice: only one sale in the book", salesList.length === 1, `got ${salesList.length}`);
  const r2b = await post("/sales", { lines: [{ variantId: vid, qty: 1 }] }, token); // no __op → independent sale
  check("sale without __op still works (back-compat)", r2b.status === 200 && r2b.json.id, r2b.json.error ?? "");
  const salesList2 = await (await fetch(`${BASE}/api/sales?limit=60`, { headers: h })).json();
  check("op-less sale records separately", salesList2.length === 2, `got ${salesList2.length}`);

  /* 2: return op twice → stock returned once */
  const saleLine = (await (await fetch(`${BASE}/api/sales?limit=60`, { headers: h })).json())[0].lines[0];
  const beforeRet = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  const opR = "9a2f7e3c-smoke-return-0001";
  await post(`/sales/${saleLine.saleId}/return`, { __op: opR, lines: [{ saleLineId: saleLine.id, qty: 1 }] }, token);
  await post(`/sales/${saleLine.saleId}/return`, { __op: opR, lines: [{ saleLineId: saleLine.id, qty: 1 }] }, token);
  const afterRet = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  check("return op twice: stock returned exactly once", afterRet - beforeRet === 1, `before=${beforeRet} after=${afterRet}`);
  const saleAfter = (await (await fetch(`${BASE}/api/sales?limit=60`, { headers: h })).json()).find((s) => s.id === saleLine.saleId);
  check("return op twice: line marked returned once", saleAfter.lines[0].returned === 1, `got ${saleAfter.lines[0].returned}`);

  /* 3: stock-in op twice → stocked once */
  const stockBefore3 = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  const opS = "9a2f7e3c-smoke-stockin-0001";
  await post("/movements/stock-in", { __op: opS, variantId: vid, qty: 5 }, token);
  await post("/movements/stock-in", { __op: opS, variantId: vid, qty: 5 }, token);
  const stockAfter3 = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  check("stock-in op twice: stocked exactly once (+5)", stockAfter3 - stockBefore3 === 5, `+${stockAfter3 - stockBefore3}`);

  /* 4: failed edit not marked applied — same __op succeeds after the cause is fixed */
  const stockNow = await (await fetch(`${BASE}/api/products/${prod.id}`, { headers: h })).json()
    .then((p) => p.qty[`${full.colors[0].id}|${full.sizes[0].id}`]);
  const opF = "9a2f7e3c-smoke-oversell-0001";
  const fail1 = await post("/sales", { __op: opF, lines: [{ variantId: vid, qty: stockNow + 3 }] }, token);
  check("overselling replay rejected as today", fail1.status === 409, `status ${fail1.status} ${fail1.json.error ?? ""}`);
  await post("/movements/stock-in", { variantId: vid, qty: 5 }, token); // shopkeeper fixes the shelf
  const retry = await post("/sales", { __op: opF, lines: [{ variantId: vid, qty: stockNow + 3 }] }, token);
  check("same failed __op retries for real after the fix", retry.status === 200, `status ${retry.status} ${retry.json.error ?? ""}`);
} catch (e) {
  console.log(`FAIL  unexpected error: ${String(e).slice(0, 600)}`);
  checks.push({ name: "no unexpected error", ok: false, extra: String(e) });
} finally {
  server.kill();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed${failed.length ? `, ${failed.length} FAILED` : ""} ===`);
if (failed.length) {
  console.log("Failures:");
  for (const f of failed) console.log(`  ✗ ${f.name}  ${f.extra}`);
  process.exit(1);
}
