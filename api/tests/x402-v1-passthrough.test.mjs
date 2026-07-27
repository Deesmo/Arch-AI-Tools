/**
 * x402 V1 facilitator pass-through — unit fixtures from the 2026-07-27 council
 * review (GPT-5.6 Sol / Gemini 2.5 Pro / Grok 4.5) of the payment_invalid fix.
 *
 * Requires a build first (imports the compiled module):
 *   cd api && npm run build && node tests/x402-v1-passthrough.test.mjs
 */
import assert from "assert";
import { toV1Requirements, asV1Payload, claimsV1, toV2Payload, toV2Requirements, V1_TO_CAIP2 } from "../dist/lib/x402V1.js";

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

const REQS = {
  scheme: "exact",
  network: "base",
  amount: "10000",
  maxAmountRequired: "10000",
  resource: "https://archtools.dev/v1/tools/generate-hash",
  description: "Arch Tools — generate-hash (USDC on Base)",
  mimeType: "application/json",
  payTo: "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e",
  maxTimeoutSeconds: 60,
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  extra: { name: "USD Coin", version: "2" },
  outputSchema: { input: { type: "http", method: "POST" } },
};

const V1_PAYLOAD = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: {
    signature: "0xabc",
    authorization: { from: "0x1", to: "0x2", value: "10000", validAfter: "0", validBefore: "9", nonce: "0x3" },
  },
};

console.log("x402 V1 pass-through helpers:");

test("toV1Requirements emits exactly the §7.1 fields — outputSchema and duplicate amount stripped", () => {
  const out = toV1Requirements(REQS);
  assert.deepStrictEqual(Object.keys(out).sort(), [
    "asset", "description", "extra", "maxAmountRequired", "maxTimeoutSeconds",
    "mimeType", "network", "payTo", "resource", "scheme",
  ]);
  assert.strictEqual(out.maxAmountRequired, "10000");
});

test("toV1Requirements falls back to amount when maxAmountRequired missing", () => {
  const { maxAmountRequired: _omit, ...noMax } = REQS;
  assert.strictEqual(toV1Requirements(noMax).maxAmountRequired, "10000");
});

test("toV1Requirements preserves maxTimeoutSeconds 0 (?? not ||) and omits absent extra", () => {
  const out = toV1Requirements({ ...REQS, maxTimeoutSeconds: 0, extra: undefined });
  assert.strictEqual(out.maxTimeoutSeconds, 0);
  assert.ok(!("extra" in out));
});

test("asV1Payload accepts a well-formed numeric-version V1 payload", () => {
  const out = asV1Payload(V1_PAYLOAD, REQS);
  assert.ok(out);
  assert.deepStrictEqual(Object.keys(out).sort(), ["network", "payload", "scheme", "x402Version"]);
});

test("asV1Payload accepts string version \"1\" (coerced)", () => {
  assert.ok(asV1Payload({ ...V1_PAYLOAD, x402Version: "1" }, REQS));
});

test("asV1Payload strips client-controlled extras (extensions injection)", () => {
  const out = asV1Payload({ ...V1_PAYLOAD, extensions: { evil: true }, resource: "x" }, REQS);
  assert.ok(out && !("extensions" in out) && !("resource" in out));
});

test("asV1Payload rejects missing scheme", () => {
  const { scheme: _omit, ...noScheme } = V1_PAYLOAD;
  assert.strictEqual(asV1Payload(noScheme, REQS), null);
});

test("asV1Payload rejects null / non-object inner payload", () => {
  assert.strictEqual(asV1Payload({ ...V1_PAYLOAD, payload: null }, REQS), null);
  assert.strictEqual(asV1Payload({ ...V1_PAYLOAD, payload: "raw" }, REQS), null);
});

test("asV1Payload fails closed on scheme/network desync with matched requirements", () => {
  assert.strictEqual(asV1Payload({ ...V1_PAYLOAD, network: "polygon" }, REQS), null);
  assert.strictEqual(asV1Payload(V1_PAYLOAD, { ...REQS, scheme: "upto" }), null);
});

test("asV1Payload rejects v2 payloads", () => {
  assert.strictEqual(asV1Payload({ x402Version: 2, payload: {}, accepted: REQS }, REQS), null);
});

test("claimsV1 matches numeric 1 and string \"1\", not 2 or garbage", () => {
  assert.strictEqual(claimsV1({ x402Version: 1 }), true);
  assert.strictEqual(claimsV1({ x402Version: "1" }), true);
  assert.strictEqual(claimsV1({ x402Version: 2 }), false);
  assert.strictEqual(claimsV1({ raw: "zzz" }), false);
  assert.strictEqual(claimsV1(undefined), false);
});

test("toV2Requirements maps V1 network to CAIP-2 and uses amount (v2 spec)", () => {
  const out = toV2Requirements(REQS);
  assert.strictEqual(out.network, "eip155:8453");
  assert.strictEqual(out.amount, "10000");
  assert.ok(!("maxAmountRequired" in out) && !("resource" in out));
});

test("toV2Requirements returns null for unmapped networks", () => {
  assert.strictEqual(toV2Requirements({ ...REQS, network: "iotex" }), null);
});

test("toV2Payload builds spec 5.2 shape with server extensions", () => {
  const ext = { bazaar: { info: { input: { type: "http", method: "POST", bodyType: "json", body: {} } } } };
  const out = toV2Payload(asV1Payload(V1_PAYLOAD, REQS), REQS, ext);
  assert.deepStrictEqual(Object.keys(out).sort(), ["accepted", "extensions", "payload", "resource", "x402Version"]);
  assert.strictEqual(out.x402Version, 2);
  assert.strictEqual(out.accepted.network, "eip155:8453");
  assert.strictEqual(out.resource.url, REQS.resource);
  assert.strictEqual(out.extensions.bazaar.info.input.type, "http");
});

test("toV2Payload omits extensions when absent and nulls on unmapped network", () => {
  const p = asV1Payload(V1_PAYLOAD, REQS);
  assert.ok(!("extensions" in toV2Payload(p, REQS)));
  assert.strictEqual(toV2Payload(p, { ...REQS, network: "iotex" }), null);
});

test("toV2Payload preserves economic terms exactly (amount/asset/payTo == challenge)", () => {
  const out = toV2Payload(asV1Payload(V1_PAYLOAD, REQS), REQS, null);
  assert.strictEqual(out.accepted.amount, REQS.maxAmountRequired);
  assert.strictEqual(out.accepted.asset, REQS.asset);
  assert.strictEqual(out.accepted.payTo, REQS.payTo);
  assert.strictEqual(out.accepted.maxTimeoutSeconds, REQS.maxTimeoutSeconds);
  assert.deepStrictEqual(out.payload, V1_PAYLOAD.payload);
});

test("toV2Payload declines (null) when resource url is missing — caller falls back to V1", () => {
  const { resource: _omit, ...noRes } = REQS;
  assert.strictEqual(toV2Payload(asV1Payload(V1_PAYLOAD, REQS), noRes, null), null);
});

test("V1_TO_CAIP2 covers the networks our 402s offer", () => {
  assert.strictEqual(V1_TO_CAIP2.base, "eip155:8453");
  assert.strictEqual(V1_TO_CAIP2.polygon, "eip155:137");
});

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll x402 V1 pass-through tests passed.");
