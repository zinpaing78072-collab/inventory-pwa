/* End-to-end smoke test for the Record-sale + Sales book + Return flow.
 * Runs a sandboxed server (fresh SQLite in /tmp) on :7770, seeds one product
 * via the API, then drives a headless Chromium through the real UI.
 * Usage: node e2e/record.spec.mjs   (exit 1 on any failure)
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";

const PORT = 7770;
const BASE = `http://localhost:${PORT}`;
const DATA = "/tmp/inv-e2e/data";

const checks = [];
const check = (name, ok, extra = "") => {
  checks.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : `  (${extra})`}`);
  return ok;
};

/* ---------- sandbox server ---------- */
rmSync("/tmp/inv-e2e", { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
const server = spawn("node", ["apps/server/dist/server.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let healthy = false;
for (let i = 0; i < 40 && !healthy; i++) {
  await sleep(250);
  healthy = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!healthy) {
  console.error("server never became healthy:\n" + serverLog);
  process.exit(1);
}

const apiPost = (path, body, token) =>
  fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

try {
  /* ---------- seed via API (sandbox, fresh DB) ---------- */
  const h = (t) => ({ authorization: `Bearer ${t}` });
  const code1 = (await (await fetch(`${BASE}/api/pairing/regenerate`, { method: "POST" })).json()).code;
  const seedTok = (await apiPost("/pair", { code: code1, name: "e2e-seed" })).json.token;

  const prod = await apiPost(
    "/products",
    {
      name: "E2E Dress",
      sizes: [
        { label: "S", price: 10000 },
        { label: "M", price: 12000 },
      ],
      colors: [{ name: "Red" }, { name: "Blue" }],
    },
    seedTok
  );
  const full = await (await fetch(`${BASE}/api/products/${prod.json.id}`, { headers: h(seedTok) })).json();
  for (const key of Object.keys(full.variantIds)) {
    await apiPost("/movements/stock-in", { variantId: full.variantIds[key], qty: 10 }, seedTok);
  }

  /* fresh pairing code for the browser */
  const code2 = (await (await fetch(`${BASE}/api/pairing/regenerate`, { method: "POST" })).json()).code;

  /* ---------- browser ---------- */
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(6000);

  await page.goto(BASE);
  await check("pair screen shown", await page.getByPlaceholder("123456").isVisible());

  await page.getByPlaceholder("123456").fill(code2);
  await page.locator("button", { hasText: "Pair" }).first().click();

  await page.waitForURL(`${BASE}/`);
  await page.waitForSelector(".grid");
  await check("paired → products grid", (await page.locator(".grid").count()) === 1);

  await page.locator(".grid > div", { hasText: "E2E Dress" }).first().click();
  await page.waitForURL(/\/products\//);
  await page.waitForSelector('.btn:has-text("Record sale")');
  await check("product detail opened", true);

  await page.locator("button", { hasText: "Record sale" }).first().click();
  await page.waitForURL(/\/sell/);
  await page.waitForSelector(".rec-row");

  /* A: the reported bug — first color choice must not auto-quantity 1 */
  const sVal = await page.locator('.rec-row:has(.lab:text-is("S")) .stepper .n').first().textContent();
  check("preload: size row starts at 0 (no auto-1)", sVal === "0", `got ${sVal}`);
  const pay0 = await page.locator(".rec-pay span").last().textContent();
  check("initial payable 0 Ks", pay0 === "0 Ks", `got ${pay0}`);

  /* B: empty bill can't be confirmed */
  await page.locator("button", { hasText: "Confirm sale" }).first().click();
  const emptyErr = await page
    .locator(".err", { hasText: "Add at least one item" })
    .isVisible()
    .catch(() => false);
  check("zero-quantity bill rejected", emptyErr);

  /* C: deliberate quantity */
  await page.locator('.rec-row:has(.lab:text-is("S")) .step').last().click();
  const sVal2 = await page.locator('.rec-row:has(.lab:text-is("S")) .stepper .n').first().textContent();
  check("+ raises S to 1", sVal2 === "1", `got ${sVal2}`);
  const pay1 = await page.locator(".rec-pay span").last().textContent();
  check("payable 10,000 after S×1", pay1 === "10,000 Ks", `got ${pay1}`);

  /* D: add color — must open at 0 again */
  await page.locator('select[aria-label="Add color"]').first().selectOption({ label: "Blue" });
  await page.waitForSelector('.rec-row:has(.lab:text-is("S"))');
  const bsVal = await page.locator('.rec-row:has(.lab:text-is("S")) .stepper .n').first().textContent();
  check("add color: new color's row starts at 0", bsVal === "0", `got ${bsVal}`);
  const blueChip = await page.locator(".color-chip", { hasText: "Blue" }).last().textContent();
  check("blue chip has no ×count before any quantity", !blueChip.includes("×"), `got "${blueChip}"`);

  await page.locator('.rec-row:has(.lab:text-is("S")) .step').last().click();
  const blueChip2 = await page.locator(".color-chip", { hasText: "Blue" }).last().textContent();
  check("blue chip shows ×1 after +", blueChip2.includes("×1"), `got "${blueChip2}"`);

  /* E: add size — must open at 0 */
  await page.locator('select[aria-label="Add size"]').first().selectOption({ label: "M" });
  const mVal = await page.locator('.rec-row:has(.lab:text-is("M")) .stepper .n').first().textContent();
  check("add size: row starts at 0", mVal === "0", `got ${mVal}`);
  await page.locator('.rec-row:has(.lab:text-is("M")) .step').last().click();

  /* H: switch back to Red — quantity persisted */
  await page.locator(".color-chip", { hasText: "Red" }).first().click();
  const redS = await page.locator('.rec-row:has(.lab:text-is("S")) .stepper .n').first().textContent();
  check("switching chips preserves quantities", redS === "1", `got ${redS}`);

  /* I: whole-bill discount recomputes payable */
  await page.locator(".rec-chips .color-chip", { hasText: "Blue" }).last().click(); // back to blue for tidy state
  await page.locator(".discbox input").fill("2500");
  const payD = await page.locator(".rec-pay span").last().textContent();
  check("discount recomputes payable 29,500", payD === "29,500 Ks", `got ${payD}`);

  /* J: confirm the sale */
  await page.getByPlaceholder("For the sales book").fill("E2E Buyer");
  await page.locator("button", { hasText: "Confirm sale" }).first().click();
  await page.waitForURL(/\/products\//);
  await check("confirm navigates back to product", true);
  const variant = await (
    await fetch(`${BASE}/api/products/${prod.json.id}`, { headers: h(seedTok) })
  ).json();
  const blueM = variant.qty[`${variant.colors[1].id}|${variant.sizes[1].id}`];
  await check("server stock decremented (blue M → 9)", blueM === 9, `got ${blueM}`);

  /* K: sales book */
  await page.locator('a[href="#/sales"]').first().click();
  await page.waitForSelector(".sale-row");
  const row = await page.locator(".sale-row", { hasText: "E2E Buyer" }).first().textContent();
  check("sales list shows the buyer with payable", row.includes("29,500"), `got "${row}"`);

  await page.locator(".sale-row", { hasText: "E2E Buyer" }).first().click();
  await page.waitForSelector(".sheet");
  const disc = await page.locator(".sheet", { hasText: "Discount" }).first().textContent();
  check("detail slide shows discount row", disc.includes("− 2,500"), `got "${disc}"`);
  const payS = await page.locator(".total-line").first().textContent();
  check("detail slide payable 29,500 Ks", payS.includes("29,500"), `got "${payS}"`);

  /* L: return flow */
  await page.locator("button", { hasText: "Return items…" }).first().click();
  await page.waitForSelector(".rec-card");
  const rRow = await page.locator(".sheet .rec-row", { hasText: "returnable" }).first().textContent();
  check("return sheet: rows show returnable caps", rRow.includes("1 of 1"), `got "${rRow}"`);
  await page.locator(".sheet .rec-row .step").last().click(); // red S +1
  await page.locator(".sheet .color-chip", { hasText: "Blue" }).last().click();
  await page.locator(".sheet .rec-row .step").last().click(); // blue S +1
  const conf = await page.locator(".sheet button.btn.primary").textContent();
  check("confirm shows 2 pcs", conf.includes("2 pcs"), `got "${conf}"`);
  await page.locator(".sheet button.btn.primary").click();
  await page.waitForSelector(".sheet", { state: "detached" });

  /* M: detail reflects the return */
  await page.locator(".sale-row", { hasText: "E2E Buyer" }).first().click();
  await page.waitForSelector(".sheet");
  const after = await page.locator(".sheet").first().textContent();
  const returnedCount = (after.match(/1 returned/g) ?? []).length;
  check("detail shows returned markers on both lines", returnedCount === 2, `got ${returnedCount}`);

  await browser.close();
} catch (e) {
  console.log(`FAIL  unexpected error: ${String(e).slice(0, 800)}`);
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
