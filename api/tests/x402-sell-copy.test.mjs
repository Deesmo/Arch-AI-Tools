/**
 * x402 per-tool sell copy — Play #6 regression suite.
 *
 * Asserts, for EVERY tool in X402_PRICES:
 *   1. No 402 description (resource.description, top-level bazaar description,
 *      any accepts[].description — v1 internal AND v2 wire) exceeds 200 chars.
 *   2. No 402 description contains "API_KEY" or any env-var-shaped token
 *      (internal implementation details never enter payment metadata).
 *   3. Every description is printable-ASCII-safe and non-empty.
 *   4. Sell copy is per-tool (curated tools don't share one generic string).
 *   5. The v2 wire layout is unchanged: descriptions live in resource +
 *      extensions.bazaar; accepts[] entries stay description-free (spec §5.1.2).
 *   6. The sanitizer strips the audited live-DB offenders (council mod:
 *      sanitize + length-cap anything DB-sourced before payment metadata).
 *
 * Requires a build first (imports the compiled module):
 *   cd api && npm run build && node tests/x402-sell-copy.test.mjs
 */
import assert from "assert";

process.env.WALLET_ADDRESS = process.env.WALLET_ADDRESS || "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e";
process.env.SOLANA_WALLET_ADDRESS = process.env.SOLANA_WALLET_ADDRESS || "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM";

const { buildPaymentRequired, buildPaymentRequiredV2, X402_PRICES } = await import("../dist/middleware/x402.js");
const { sanitizeSellCopy, registerToolSellCopy, getToolSellCopy, railDescription, SELL_COPY_MAX_CHARS } =
  await import("../dist/lib/toolSellCopy.js");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

const MAX = 200;
const ASCII_ONLY = /^[\x20-\x7E]+$/;
const ENV_VAR_SHAPED = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/;

function collectDescriptions(body) {
  const out = [];
  if (body?.resource && typeof body.resource === "object" && body.resource.description !== undefined) {
    out.push(["resource.description", body.resource.description]);
  }
  if (body?.description !== undefined) out.push(["description", body.description]);
  for (const [i, a] of (body?.accepts ?? []).entries()) {
    if (a?.description !== undefined) out.push([`accepts[${i}].description`, a.description]);
  }
  return out;
}

console.log("sell copy: full-catalog 402 description constraints");

test(`every 402 description across all ${Object.keys(X402_PRICES).length} tools is <=${MAX} chars, ASCII, no API_KEY/env-var tokens (v1 + v2)`, () => {
  assert.strictEqual(SELL_COPY_MAX_CHARS, MAX);
  let checked = 0;
  for (const [tool, price] of Object.entries(X402_PRICES)) {
    for (const body of [buildPaymentRequired(tool, price), buildPaymentRequiredV2(tool, price)]) {
      for (const [where, d] of collectDescriptions(body)) {
        checked++;
        assert.strictEqual(typeof d, "string", `${tool} ${where} not a string`);
        assert.ok(d.length > 0, `${tool} ${where} empty`);
        assert.ok(d.length <= MAX, `${tool} ${where} too long (${d.length} > ${MAX}): ${d}`);
        assert.ok(ASCII_ONLY.test(d), `${tool} ${where} not ASCII-safe: ${JSON.stringify(d)}`);
        assert.ok(!d.includes("API_KEY"), `${tool} ${where} leaks API_KEY: ${d}`);
        assert.ok(!ENV_VAR_SHAPED.test(d), `${tool} ${where} leaks env-var-shaped token: ${d}`);
      }
    }
  }
  assert.ok(checked > 500, `only ${checked} descriptions checked — sweep broke`);
  console.log(`    (${checked} descriptions checked)`);
});

test("sell copy is per-tool: curated tools carry distinct, non-generic copy", () => {
  const tools = ["qr-code", "crypto-price", "ai-generate", "web-scrape", "generate-hash"];
  const descs = tools.map((t) => buildPaymentRequired(t, "0.010").resource.description);
  assert.strictEqual(new Set(descs).size, tools.length, "descriptions are not distinct per tool");
  for (const [i, d] of descs.entries()) {
    assert.notStrictEqual(d, `Arch Tools — ${tools[i]}`, "still the old generic string");
    assert.ok(d.length > 40, `curated copy suspiciously short for ${tools[i]}: ${d}`);
  }
});

test("accepts[].description carries the sell copy + rail qualifier (v1 internal shape)", () => {
  const body = buildPaymentRequired("qr-code", "0.010");
  assert.ok(body.accepts.length > 0, "no accepts entries — wallet env missing?");
  const base = body.accepts.find((a) => a.network === "base" && a.extra?.name === "USD Coin");
  assert.ok(base, "no Base USDC entry");
  assert.ok(base.description.endsWith("(USDC on Base)"), base.description);
  assert.ok(base.description.includes("QR codes"), `not per-tool: ${base.description}`);
});

console.log("sell copy: v2 wire layout unchanged (spec §5.1.2)");

test("v2 challenge keeps descriptions in resource + extensions.bazaar; accepts stay clean", () => {
  const v2 = buildPaymentRequiredV2("generate-hash", "0.010");
  assert.strictEqual(v2.x402Version, 2);
  assert.strictEqual(typeof v2.resource.description, "string");
  assert.ok(v2.resource.description.includes("archtools.dev"), "bazaar suffix missing from wire description");
  assert.ok(v2.extensions?.bazaar, "extensions.bazaar missing");
  for (const a of v2.accepts) {
    assert.strictEqual(a.description, undefined, "v2 accepts must not carry description");
    assert.strictEqual(a.resource, undefined, "v2 accepts must not carry resource");
  }
});

console.log("sell copy: sanitizer (council mod — DB-sourced text)");

test("strips the audited live-DB offenders (ANTHROPIC_API_KEY / PDF_EXTRACTOR_URL / TAVILY_API_KEY)", () => {
  const cases = [
    ["AI-powered text generation using Claude (requires ANTHROPIC_API_KEY)", "AI-powered text generation using Claude"],
    ["Extract text and tables from a PDF (requires PDF_EXTRACTOR_URL)", "Extract text and tables from a PDF"],
    ["Real-time web search with AI-synthesized answer (requires TAVILY_API_KEY)", "Real-time web search with AI-synthesized answer"],
  ];
  for (const [raw, expected] of cases) {
    const clean = sanitizeSellCopy(raw);
    assert.strictEqual(clean, expected);
    assert.ok(!/API_KEY|_URL/.test(clean), clean);
  }
});

test("strips non-parenthesized 'requires FOO_BAR' clauses and bare env-var tokens", () => {
  assert.strictEqual(sanitizeSellCopy("Does a thing. Requires MY_SECRET_TOKEN to run."), "Does a thing.");
  const clean = sanitizeSellCopy("Uses SOME_API_KEY internally for magic");
  assert.ok(clean === null || !ENV_VAR_SHAPED.test(clean), String(clean));
});

test("transliterates Unicode to ASCII (em dash, x, curly quotes, ellipsis)", () => {
  assert.strictEqual(sanitizeSellCopy("Geo, ISP — VPN/proxy detection"), "Geo, ISP - VPN/proxy detection");
  assert.strictEqual(sanitizeSellCopy("1024×1024 images"), "1024x1024 images");
  assert.strictEqual(sanitizeSellCopy("It’s “fast”…"), `It's "fast"...`);
});

test(`caps at ${MAX} chars on a word boundary with ellipsis`, () => {
  const long = "word ".repeat(100).trim();
  const capped = sanitizeSellCopy(long);
  assert.ok(capped.length <= MAX, `${capped.length}`);
  assert.ok(capped.endsWith("..."), capped);
});

test("refuses unusable input (null/empty/whitespace/non-string)", () => {
  assert.strictEqual(sanitizeSellCopy(null), null);
  assert.strictEqual(sanitizeSellCopy(""), null);
  assert.strictEqual(sanitizeSellCopy("   "), null);
  assert.strictEqual(sanitizeSellCopy(42), null);
});

test("registerToolSellCopy sanitizes at the insert boundary; curated overrides always win", () => {
  assert.strictEqual(registerToolSellCopy("__test_tool__", "Does X (requires EVIL_API_KEY) — fast"), true);
  const copy = getToolSellCopy("__test_tool__");
  assert.strictEqual(copy, "Does X - fast");
  assert.strictEqual(registerToolSellCopy("__test_tool__", "  "), false); // nothing usable → refused
  // curated tool ignores a later DB registration
  registerToolSellCopy("qr-code", "GENERIC OVERWRITE ATTEMPT (requires HAX_API_KEY)");
  assert.ok(getToolSellCopy("qr-code").includes("QR codes"), "curated copy lost priority");
});

test("railDescription caps copy + rail jointly at the limit", () => {
  registerToolSellCopy("__test_long__", "z".repeat(400));
  const d = railDescription("__test_long__", "USDC on Base");
  assert.ok(d.length <= MAX, `${d.length}`);
  assert.ok(d.endsWith("(USDC on Base)"), d);
});

test("unknown tools get the neutral fallback (no crash, still safe)", () => {
  const d = getToolSellCopy("not-a-real-tool");
  assert.ok(d.includes("not-a-real-tool"), d);
  assert.ok(d.length <= MAX && ASCII_ONLY.test(d), d);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll x402 sell-copy tests passed");
