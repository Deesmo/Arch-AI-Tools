#!/usr/bin/env node
/**
 * check-price-drift.mjs — advertised price = charged price, forever.
 *
 * This class of bug has been fixed by hand 4 separate times (stale llms.txt,
 * pre-#73 seed.ts prices, discovery.ts video 500-vs-700, credits_used payload
 * mismatches). This guard makes the 5th recurrence impossible to merge.
 *
 * TRUTH (built from SOURCE — the code that actually charges):
 *   - x402 USD prices:   X402_PRICES in api/src/middleware/x402.ts
 *   - credit charges:    literal deductCredits(req, res, "<tool>", N) calls in
 *                        api/src/routes/tools/index.ts, plus anchored extraction
 *                        of the base/minimum for the 6 variable-cost (metered)
 *                        tools. If a metered formula is refactored the anchor
 *                        stops matching and this script FAILS LOUD — update the
 *                        anchor together with the formula, never silently.
 *   - route aliases:     router.post("/<alias>", ...toolMiddleware("<canonical>"))
 *   - packs/subs:        CREDIT_PACKS + SUBSCRIPTION_PLANS in api/src/routes/billing.ts
 *   - free credits:      SIGNUP_FREE_CREDITS in api/src/lib/verification.ts
 *
 * ADVERTISED surfaces diffed against truth:
 *   - api/public/openapi.json        (x-payment-info amounts, billing credit copy)
 *   - api/public/tools.json          (per-tool credits, packs, freeCredits)
 *   - api/public/llms.txt            (per-tool credits, packs)
 *   - api/public/llms-full.txt       (per-tool credits + x402 USD, packs)
 *   - api/src/routes/discovery.ts    (LLMS_TXT block, FALLBACK_CREDITS map,
 *                                     metered notes, packs, freeCredits)
 *   - api/src/seed.ts + seed-new.ts  (DB seed credits)
 *   - api/src/mcp/server.ts          (static MCP tool list x402 prices)
 *
 * Exit 1 with a precise per-tool diff on any mismatch. Zero dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const failures = [];
const fail = (surface, tool, advertised, charged, note = "") =>
  failures.push({ surface, tool, advertised, charged, note });

/** Parser sanity gate: a regex that silently matches nothing must not pass CI. */
function assertMin(what, actual, min) {
  if (actual < min) {
    console.error(
      `PARSER FAILURE: expected >= ${min} entries from ${what}, got ${actual}. ` +
        `The source moved or the pattern rotted — fix scripts/check-price-drift.mjs in the same PR.`
    );
    process.exit(1);
  }
}

// ─── TRUTH 1: x402 USD prices ────────────────────────────────────────────────
const x402Src = read("api/src/middleware/x402.ts");
const x402Block = x402Src.match(/export const X402_PRICES[^{]*\{([\s\S]*?)\n\};/);
if (!x402Block) {
  console.error("PARSER FAILURE: X402_PRICES block not found in api/src/middleware/x402.ts");
  process.exit(1);
}
const x402Prices = {};
for (const m of x402Block[1].matchAll(/"([a-z0-9-]+)":\s*"([\d.]+)"/g)) {
  x402Prices[m[1]] = Number(m[2]);
}
assertMin("X402_PRICES (x402.ts)", Object.keys(x402Prices).length, 80);

// ─── TRUTH 2: credit charges ─────────────────────────────────────────────────
const routesSrc = read("api/src/routes/tools/index.ts");
const charged = {};
for (const m of routesSrc.matchAll(/deductCredits\(req,\s*res,\s*"([a-z0-9-]+)",\s*(\d+)\)/g)) {
  const [, tool, n] = m;
  if (charged[tool] !== undefined && charged[tool] !== Number(n)) {
    fail("routes/tools/index.ts", tool, `${charged[tool]} and ${n}`, "one value",
      "same tool charged two different literal amounts");
  }
  charged[tool] = Number(n);
}
assertMin("literal deductCredits calls (routes/tools/index.ts)", Object.keys(charged).length, 80);

// Variable-cost (metered) tools: extract the base/minimum from the exact charging
// expression. Anchors are deliberately strict — refactor the formula and this
// exits 1 until the anchor (and every advertised base) is updated with it.
function anchored(tool, re, pick = (m) => Number(m[1])) {
  const m = routesSrc.match(re);
  if (!m) {
    console.error(
      `PARSER FAILURE: metered-cost anchor for "${tool}" not found in routes/tools/index.ts.\n` +
        `  pattern: ${re}\n  The charging formula changed — update the anchor AND every advertised base together.`
    );
    process.exit(1);
  }
  return pick(m);
}
const metered = {
  // let aiGenCost = 20 + 20 * Math.ceil(...)
  "ai-generate": anchored("ai-generate", /let aiGenCost = (\d+) \+ \d+ \* Math\.ceil/),
  // const oracleCreditCost = applyModelCost(25, oracleModelForCost)
  "ai-oracle": anchored("ai-oracle", /applyModelCost\((\d+), oracleModelForCost\)/),
  // const ttsCost = 25 + 8 * Math.ceil(text.length / 100)
  "text-to-speech": anchored("text-to-speech", /const ttsCost = (\d+) \+ \d+ \* Math\.ceil\(text\.length/),
  // default quality "medium", default size 1024x1024 (sizeMult 1) → the third branch
  "design-create": anchored(
    "design-create",
    /safeQuality === "high" \? \d+ : safeQuality === "low" \? \d+ : (\d+)/
  ),
  // const researchReportCost = paid ? 0 : byokAdjustedCost(req, 40, ...) — BYOK only lowers
  "research-report": anchored("research-report", /const researchReportCost = paid \? 0 : byokAdjustedCost\(req, (\d+)/),
  // const videoCost = Math.max(700, duration * 140) → advertised base = the minimum
  "video-generate": anchored("video-generate", /const videoCost = Math\.max\((\d+), duration \* \d+\)/),
};
for (const [tool, base] of Object.entries(metered)) {
  if (charged[tool] !== undefined) {
    fail("routes/tools/index.ts", tool, charged[tool], base,
      "tool has BOTH a literal deductCredits and a metered formula — ambiguous truth");
  }
  charged[tool] = base;
}
// Metered formula constants used to validate the human-readable metered notes.
const ttsPer100 = anchored("text-to-speech per-100", /const ttsCost = \d+ \+ (\d+) \* Math\.ceil\(text\.length/);
const videoPerSec = anchored("video-generate per-sec", /const videoCost = Math\.max\(\d+, duration \* (\d+)\)/);

// ─── TRUTH 3: route aliases (alias route charges under its canonical name) ──
const aliases = {};
for (const m of routesSrc.matchAll(/router\.post\("\/([a-z0-9-]+)",\s*\.\.\.toolMiddleware\("([a-z0-9-]+)"\)/g)) {
  if (m[1] !== m[2]) aliases[m[1]] = m[2];
}
const resolve = (tool) => (charged[tool] !== undefined ? tool : aliases[tool]);
const resolveX402 = (tool) => (x402Prices[tool] !== undefined ? tool : aliases[tool]);

// ─── TRUTH 4: packs / subscriptions / free credits ──────────────────────────
const billingSrc = read("api/src/routes/billing.ts");
const packs = []; // { credits, usd }
for (const m of billingSrc.matchAll(/\{ id: "[a-z-]+",\s*credits: (\d+),\s*amount: (\d+),/g)) {
  packs.push({ credits: Number(m[1]), usd: Number(m[2]) / 100 });
}
assertMin("CREDIT_PACKS (billing.ts)", packs.length, 3);
const subs = [];
for (const m of billingSrc.matchAll(/credits_per_month: (\d+),\s*\n\s*amount: (\d+),/g)) {
  subs.push({ credits: Number(m[1]), usd: Number(m[2]) / 100 });
}
assertMin("SUBSCRIPTION_PLANS (billing.ts)", subs.length, 4);
const knownBundles = [...packs, ...subs];

const verificationSrc = read("api/src/lib/verification.ts");
const freeM = verificationSrc.match(/SIGNUP_FREE_CREDITS\s*=\s*(\d+)/);
const signupFreeCredits = freeM ? Number(freeM[1]) : null;

// Any "<credits> credits — $<usd>" / "(<credits> credits, $<usd>)" claim on a text
// surface must match a real pack or subscription (matched by credit count).
function checkBundleClaims(surface, text) {
  let found = 0;
  for (const m of text.matchAll(/([\d,]{3,}) credits(?:\/mo)?\s*(?:—|,)\s*\$([\d,]+)/g)) {
    found++;
    const credits = Number(m[1].replace(/,/g, ""));
    const usd = Number(m[2].replace(/,/g, ""));
    const bundle = knownBundles.find((p) => p.credits === credits);
    if (!bundle) fail(surface, `${credits}-credit bundle`, `$${usd}`, "no such pack/plan in billing.ts");
    else if (bundle.usd !== usd) fail(surface, `${credits}-credit bundle`, `$${usd}`, `$${bundle.usd}`);
  }
  return found;
}

// Per-tool credit claim checker used by every surface.
function checkCredits(surface, tool, advertised, note = "") {
  const canonical = resolve(tool);
  if (canonical === undefined) {
    fail(surface, tool, advertised, "(no charge found)", "advertises a tool that charges nothing / does not exist");
    return;
  }
  if (Number(advertised) !== charged[canonical]) {
    fail(surface, tool, advertised, charged[canonical], canonical !== tool ? `alias of ${canonical}${note}` : note);
  }
}
function checkX402(surface, tool, advertisedUsd) {
  const canonical = resolveX402(tool);
  if (canonical === undefined) {
    fail(surface, tool, `$${advertisedUsd}`, "(no X402_PRICES entry)");
    return;
  }
  if (Number(advertisedUsd) !== x402Prices[canonical]) {
    fail(surface, tool, `$${advertisedUsd}`, `$${x402Prices[canonical]}`, canonical !== tool ? `alias of ${canonical}` : "");
  }
}

// ─── SURFACE 1: api/public/openapi.json ─────────────────────────────────────
{
  const openapi = JSON.parse(read("api/public/openapi.json"));
  let count = 0;
  for (const [p, ops] of Object.entries(openapi.paths ?? {})) {
    const m = p.match(/^\/v1\/tools\/([a-z0-9-]+)$/);
    if (!m || typeof ops !== "object") continue;
    const info = ops.post?.["x-payment-info"];
    const amount = info?.price?.amount;
    if (amount === undefined) continue;
    count++;
    checkX402("openapi.json x-payment-info", m[1], amount);
  }
  assertMin("openapi.json x-payment-info entries", count, 55);
  const billingCopy = JSON.stringify(openapi.paths?.["/v1/billing/plans"] ?? "") +
    JSON.stringify(openapi.paths?.["/v1/billing/checkout"] ?? "") +
    JSON.stringify(openapi.paths?.["/v1/billing/subscribe"] ?? "");
  assertMin("openapi.json billing bundle claims", checkBundleClaims("openapi.json billing copy", billingCopy), 3);
}

// ─── SURFACE 2: api/public/tools.json ───────────────────────────────────────
{
  const toolsJson = JSON.parse(read("api/public/tools.json"));
  assertMin("tools.json tools[]", (toolsJson.tools ?? []).length, 60);
  for (const t of toolsJson.tools) {
    if (typeof t.credits === "number") checkCredits("tools.json", t.name, t.credits);
  }
  for (const p of toolsJson.pricing?.packs ?? []) {
    const bundle = knownBundles.find((b) => b.credits === p.credits);
    if (!bundle) fail("tools.json pricing.packs", `${p.credits}-credit pack`, `$${p.price}`, "no such pack in billing.ts");
    else if (bundle.usd !== Number(p.price)) fail("tools.json pricing.packs", `${p.credits}-credit pack`, `$${p.price}`, `$${bundle.usd}`);
  }
  if (signupFreeCredits !== null && toolsJson.pricing?.freeCredits !== undefined &&
      Number(toolsJson.pricing.freeCredits) !== signupFreeCredits) {
    fail("tools.json pricing.freeCredits", "signup free credits", toolsJson.pricing.freeCredits, signupFreeCredits);
  }
}

// ─── SURFACE 3: api/public/llms.txt ─────────────────────────────────────────
{
  const llms = read("api/public/llms.txt");
  let count = 0;
  for (const m of llms.matchAll(/\]\((?:https:\/\/archtools\.dev)?\/v1\/tools\/([a-z0-9-]+)\):.*\((\d+)\+? credits?\)\s*$/gm)) {
    count++;
    checkCredits("llms.txt", m[1], Number(m[2]));
  }
  assertMin("llms.txt per-tool credit lines", count, 55);
  assertMin("llms.txt pack claims", checkBundleClaims("llms.txt packs", llms), 3);
}

// ─── SURFACE 4: api/public/llms-full.txt ────────────────────────────────────
{
  const llmsFull = read("api/public/llms-full.txt");
  let count = 0;
  for (const m of llmsFull.matchAll(/^### POST \/v1\/tools\/([a-z0-9-]+) — (\d+)\+? credits?(?: · x402 \$([\d.]+) USDC)?/gm)) {
    count++;
    checkCredits("llms-full.txt", m[1], Number(m[2]));
    if (m[3] !== undefined) checkX402("llms-full.txt", m[1], m[3]);
  }
  assertMin("llms-full.txt per-tool lines", count, 55);
  assertMin("llms-full.txt pack claims", checkBundleClaims("llms-full.txt packs", llmsFull), 3);
}

// ─── SURFACE 5: api/src/routes/discovery.ts ─────────────────────────────────
{
  const discoverySrc = read("api/src/routes/discovery.ts");

  // 5a. LLMS_TXT template block: "POST /v1/tools/<t>   (N credits) — desc"
  let count = 0;
  for (const m of discoverySrc.matchAll(/^POST \/v1\/tools\/([a-z0-9-]+)\s+\((\d+)\+? credits?/gm)) {
    count++;
    checkCredits("discovery.ts LLMS_TXT", m[1], Number(m[2]));
  }
  assertMin("discovery.ts LLMS_TXT tool lines", count, 55);

  // 5b. FALLBACK_CREDITS map (served by /v1/tools + /v1/discover when the DB is down).
  const fbBlock = discoverySrc.match(/const FALLBACK_CREDITS[^{]*\{([\s\S]*?)\n\};/);
  if (!fbBlock) {
    console.error("PARSER FAILURE: FALLBACK_CREDITS block not found in discovery.ts");
    process.exit(1);
  }
  const fallbackCredits = {};
  for (const m of fbBlock[1].matchAll(/"([a-z0-9-]+)":\s*(\d+)/g)) fallbackCredits[m[1]] = Number(m[2]);
  assertMin("discovery.ts FALLBACK_CREDITS", Object.keys(fallbackCredits).length, 55);
  for (const [tool, n] of Object.entries(fallbackCredits)) checkCredits("discovery.ts FALLBACK_CREDITS", tool, n);
  // Every described fallback tool must have an explicit (checked) credit price —
  // the `?? 5` default must never actually serve.
  const tdBlock = discoverySrc.match(/const TOOL_DESCRIPTIONS[^{]*\{([\s\S]*?)\n\};/);
  if (tdBlock) {
    for (const m of tdBlock[1].matchAll(/"([a-z0-9-]+)":\s*"/g)) {
      if (fallbackCredits[m[1]] === undefined) {
        fail("discovery.ts FALLBACK_CREDITS", m[1], "(missing — would default to 5)", charged[resolve(m[1])] ?? "?");
      }
    }
  }

  // 5c. Metered honesty notes must quote the real formula constants.
  const ttsNote = discoverySrc.match(/"text-to-speech": "metered by length — (\d+) base \+ (\d+) credits per 100 characters"/);
  if (!ttsNote) fail("discovery.ts METERED", "text-to-speech", "(note missing/reworded)", `${metered["text-to-speech"]} base + ${ttsPer100}/100 chars`);
  else {
    if (Number(ttsNote[1]) !== metered["text-to-speech"]) fail("discovery.ts METERED", "text-to-speech base", ttsNote[1], metered["text-to-speech"]);
    if (Number(ttsNote[2]) !== ttsPer100) fail("discovery.ts METERED", "text-to-speech per-100-chars", ttsNote[2], ttsPer100);
  }
  const videoNote = discoverySrc.match(/"video-generate": "metered by duration — (\d+) credits\/second \(5s = (\d+), 10s = (\d+)\), (\d+) minimum"/);
  if (!videoNote) fail("discovery.ts METERED", "video-generate", "(note missing/reworded)", `${videoPerSec}/s, ${metered["video-generate"]} min`);
  else {
    if (Number(videoNote[1]) !== videoPerSec) fail("discovery.ts METERED", "video-generate per-second", videoNote[1], videoPerSec);
    if (Number(videoNote[2]) !== Math.max(metered["video-generate"], 5 * videoPerSec)) fail("discovery.ts METERED", "video-generate 5s example", videoNote[2], Math.max(metered["video-generate"], 5 * videoPerSec));
    if (Number(videoNote[3]) !== Math.max(metered["video-generate"], 10 * videoPerSec)) fail("discovery.ts METERED", "video-generate 10s example", videoNote[3], Math.max(metered["video-generate"], 10 * videoPerSec));
    if (Number(videoNote[4]) !== metered["video-generate"]) fail("discovery.ts METERED", "video-generate minimum", videoNote[4], metered["video-generate"]);
  }

  // 5d. Packs + free credits in /v1/discover payload and the LLMS_TXT header.
  for (const m of discoverySrc.matchAll(/\{ name: "[A-Za-z]+", credits: (\d+), price: "\$(\d+)" \}/g)) {
    const credits = Number(m[1]);
    const bundle = knownBundles.find((b) => b.credits === credits);
    if (!bundle) fail("discovery.ts packs", `${credits}-credit pack`, `$${m[2]}`, "no such pack in billing.ts");
    else if (bundle.usd !== Number(m[2])) fail("discovery.ts packs", `${credits}-credit pack`, `$${m[2]}`, `$${bundle.usd}`);
  }
  checkBundleClaims("discovery.ts LLMS_TXT packs", discoverySrc);
  if (signupFreeCredits !== null) {
    for (const m of discoverySrc.matchAll(/freeCredits: (\d+)/g)) {
      if (Number(m[1]) !== signupFreeCredits) fail("discovery.ts freeCredits", "signup free credits", m[1], signupFreeCredits);
    }
  }
}

// ─── SURFACE 6: api/src/seed.ts + api/src/seed-new.ts ───────────────────────
for (const seedFile of ["api/src/seed.ts", "api/src/seed-new.ts"]) {
  const seedSrc = read(seedFile);
  let count = 0;
  for (const m of seedSrc.matchAll(/name: "([a-z0-9-]+)",[^\n]*?credits: (\d+)/g)) {
    count++;
    checkCredits(seedFile, m[1], Number(m[2]));
  }
  assertMin(`${seedFile} tool entries`, count, seedFile.endsWith("seed-new.ts") ? 3 : 55);
}

// ─── SURFACE 7: api/src/mcp/server.ts (static MCP tool list, "$X/call") ─────
{
  const mcpSrc = read("api/src/mcp/server.ts");
  let count = 0;
  for (const m of mcpSrc.matchAll(/\{ name: "([a-z0-9-]+)", description: "[^"]*", price: "\$([\d.]+)"/g)) {
    count++;
    checkX402("mcp/server.ts", m[1], m[2]);
  }
  assertMin("mcp/server.ts static tool prices", count, 45);
}

// ─── VERDICT ─────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\nPRICE DRIFT: ${failures.length} advertised price(s) do not match what the API charges.\n`);
  let lastSurface = "";
  for (const f of failures) {
    if (f.surface !== lastSurface) {
      console.error(`  ${f.surface}`);
      lastSurface = f.surface;
    }
    console.error(`    - ${f.tool}: advertised ${f.advertised} != charged ${f.charged}${f.note ? `  (${f.note})` : ""}`);
  }
  console.error(
    "\nFix the ADVERTISED surface to match the charging code (or, if the charge itself changed on purpose, update every surface above). Truth lives in:\n" +
      "  api/src/middleware/x402.ts (X402_PRICES) and api/src/routes/tools/index.ts (deductCredits + metered formulas).\n"
  );
  process.exit(1);
}

console.log(
  `price drift guard: OK — ${Object.keys(charged).length} charged tools, ${Object.keys(x402Prices).length} x402 prices, ` +
    `${Object.keys(aliases).length} aliases, ${packs.length} packs + ${subs.length} subscriptions verified across 8 surfaces.`
);
