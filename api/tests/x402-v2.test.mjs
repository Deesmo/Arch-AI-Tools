/**
 * x402 v2 seller-side helpers — unit fixtures.
 *
 * Golden tests for the v2 402 challenge shape (coinbase/x402
 * specs/x402-specification-v2.md §5.1), payload version detection, the native-v2
 * facilitator argument builder (§5.2/§7), and Bazaar-extension parity between the
 * v1→v2 translation path and the native v2 path.
 *
 * Requires a build first (imports the compiled module):
 *   cd api && npm run build && node tests/x402-v2.test.mjs
 */
import assert from "assert";
import {
  toCaip2,
  networksEqual,
  toV2Accept,
  toV2PaymentRequired,
  paymentPayloadVersion,
  toV2FacilitatorArgs,
  SOLANA_MAINNET_CAIP2,
} from "../dist/lib/x402V2.js";
import { toV2Payload, claimsV1 } from "../dist/lib/x402V1.js";

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

// Internal v1-shaped accepts entry exactly as buildPaymentRequired emits it.
const V1_ACCEPT_BASE = {
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

const V1_ACCEPT_SOLANA = {
  ...V1_ACCEPT_BASE,
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  extra: { name: "USD Coin", version: "spl", feePayer: "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM" },
};

const BAZAAR_EXTENSIONS = {
  bazaar: {
    info: { input: { type: "http", method: "POST", bodyType: "json", body: { text: "seed" } }, output: { type: "json", example: { ok: true } } },
    routeTemplate: "/v1/tools/generate-hash",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: { input: { properties: { body: { type: "object" } }, type: "object" } },
      type: "object",
    },
  },
};

// Internal v1-shaped 402 body exactly as buildPaymentRequired emits it
// (top-level resource object + bazaar description/extensions merged in).
const V1_BODY = {
  x402Version: 1,
  resource: {
    url: "https://archtools.dev/v1/tools/generate-hash",
    description: "Arch Tools — generate-hash",
    mimeType: "application/json",
  },
  accepts: [V1_ACCEPT_BASE, { ...V1_ACCEPT_BASE, network: "polygon", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" }, V1_ACCEPT_SOLANA],
  error: "PAYMENT-REQUIRED",
  description: "Generate cryptographic hashes. Pay per call with USDC (x402) or credits — archtools.dev",
  extensions: BAZAAR_EXTENSIONS,
};

console.log("x402 v2: CAIP-2 normalization");

test("toCaip2 maps the proven v1 named networks and passes CAIP-2 through", () => {
  assert.strictEqual(toCaip2("base"), "eip155:8453");
  assert.strictEqual(toCaip2("polygon"), "eip155:137");
  assert.strictEqual(toCaip2("base-sepolia"), "eip155:84532");
  assert.strictEqual(toCaip2("eip155:8453"), "eip155:8453");
  assert.strictEqual(toCaip2(SOLANA_MAINNET_CAIP2), SOLANA_MAINNET_CAIP2);
});

test("toCaip2 canonicalizes Solana aliases to the genesis-hash form (spec §11.1)", () => {
  assert.strictEqual(toCaip2("solana"), SOLANA_MAINNET_CAIP2);
  assert.strictEqual(toCaip2("solana:mainnet"), SOLANA_MAINNET_CAIP2);
});

test("toCaip2 refuses to guess unmapped networks", () => {
  assert.strictEqual(toCaip2("ethereum"), null);
  assert.strictEqual(toCaip2("bsc"), null);
  assert.strictEqual(toCaip2(undefined), null);
  assert.strictEqual(toCaip2(""), null);
});

test("networksEqual matches named vs CAIP-2 forms of the same chain only", () => {
  assert.strictEqual(networksEqual("base", "eip155:8453"), true);
  assert.strictEqual(networksEqual("eip155:8453", "eip155:8453"), true);
  assert.strictEqual(networksEqual("polygon", "eip155:137"), true);
  assert.strictEqual(networksEqual(SOLANA_MAINNET_CAIP2, "solana:mainnet"), true);
  assert.strictEqual(networksEqual("base", "eip155:137"), false);
  assert.strictEqual(networksEqual("ethereum", "ethereum"), true); // exact string still matches
});

console.log("x402 v2: PaymentRequired golden shape (spec §5.1)");

test("toV2Accept emits exactly the §5.1.2 fields — amount + CAIP-2, v1 extras stripped", () => {
  const out = toV2Accept(V1_ACCEPT_BASE);
  assert.deepStrictEqual(Object.keys(out).sort(), ["amount", "asset", "extra", "maxTimeoutSeconds", "network", "payTo", "scheme"]);
  assert.strictEqual(out.network, "eip155:8453");
  assert.strictEqual(out.amount, "10000");
  assert.strictEqual(out.maxAmountRequired, undefined);
  assert.strictEqual(out.outputSchema, undefined);
  assert.deepStrictEqual(out.extra, { name: "USD Coin", version: "2" });
});

test("toV2Accept drops entries whose network cannot be normalized", () => {
  assert.strictEqual(toV2Accept({ ...V1_ACCEPT_BASE, network: "ethereum" }), null);
});

test("toV2PaymentRequired is a spec-correct v2 challenge (golden)", () => {
  const v2 = toV2PaymentRequired(V1_BODY);
  assert.deepStrictEqual(Object.keys(v2).sort(), ["accepts", "error", "extensions", "resource", "x402Version"]);
  assert.strictEqual(v2.x402Version, 2);
  assert.strictEqual(v2.error, "PAYMENT-SIGNATURE header is required");
  // Required top-level resource object (§5.1.2) — richer bazaar description wins.
  assert.deepStrictEqual(Object.keys(v2.resource).sort(), ["description", "mimeType", "url"]);
  assert.strictEqual(v2.resource.url, "https://archtools.dev/v1/tools/generate-hash");
  assert.strictEqual(v2.resource.description, V1_BODY.description);
  assert.strictEqual(v2.resource.mimeType, "application/json");
  // All three rails survive with CAIP-2 networks.
  assert.strictEqual(v2.accepts.length, 3);
  assert.deepStrictEqual(v2.accepts.map((a) => a.network), ["eip155:8453", "eip155:137", SOLANA_MAINNET_CAIP2]);
  for (const a of v2.accepts) {
    assert.strictEqual(typeof a.amount, "string");
    assert.strictEqual(a.maxAmountRequired, undefined);
    assert.strictEqual(a.resource, undefined);
    assert.strictEqual(a.description, undefined);
    assert.strictEqual(a.mimeType, undefined);
    assert.strictEqual(a.outputSchema, undefined);
  }
  // Solana feePayer rides through extra (scheme_exact_svm.md).
  assert.strictEqual(v2.accepts[2].extra.feePayer, "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM");
  // Bazaar extension preserved for discovery (§5.1.2 Extensions / extensions/bazaar.md).
  assert.deepStrictEqual(v2.extensions, BAZAAR_EXTENSIONS);
});

test("toV2PaymentRequired falls back to the resource description when no bazaar block", () => {
  const { description: _omit, extensions: _omit2, ...noBazaar } = V1_BODY;
  const v2 = toV2PaymentRequired(noBazaar);
  assert.strictEqual(v2.resource.description, "Arch Tools — generate-hash");
  assert.strictEqual(v2.extensions, undefined);
});

console.log("x402 v2: payment payload version detection");

const V2_PAYLOAD = {
  x402Version: 2,
  resource: { url: "https://archtools.dev/v1/tools/generate-hash", mimeType: "application/json" },
  accepted: toV2Accept(V1_ACCEPT_BASE),
  payload: {
    signature: "0xabc",
    authorization: { from: "0x1", to: "0x2", value: "10000", validAfter: "0", validBefore: "9", nonce: "0x3" },
  },
  extensions: { bazaar: { info: { note: "client echo" }, schema: {} }, other: { info: {}, schema: {} } },
};

const V1_PAYLOAD = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: V2_PAYLOAD.payload,
};

test("paymentPayloadVersion discriminates 1 / 2 / neither", () => {
  assert.strictEqual(paymentPayloadVersion(V1_PAYLOAD), 1);
  assert.strictEqual(paymentPayloadVersion(V2_PAYLOAD), 2);
  assert.strictEqual(paymentPayloadVersion({ x402Version: "2" }), 2); // string version tolerated
  assert.strictEqual(paymentPayloadVersion({}), null);
  assert.strictEqual(paymentPayloadVersion(null), null);
});

test("claimsV1 stays the v1 gate — v2 payloads never enter the v1 path", () => {
  assert.strictEqual(claimsV1(V1_PAYLOAD), true);
  assert.strictEqual(claimsV1(V2_PAYLOAD), false);
});

console.log("x402 v2: native-v2 facilitator args (verify + settle)");

test("toV2FacilitatorArgs builds server-authoritative v2 requirements (CAIP-2 + amount)", () => {
  const args = toV2FacilitatorArgs(V2_PAYLOAD, V1_ACCEPT_BASE, BAZAAR_EXTENSIONS);
  assert.ok(args);
  assert.deepStrictEqual(args.paymentRequirements, toV2Accept(V1_ACCEPT_BASE));
  assert.deepStrictEqual(args.paymentPayload.accepted, args.paymentRequirements);
  assert.strictEqual(args.paymentPayload.x402Version, 2);
  assert.deepStrictEqual(args.paymentPayload.payload, V2_PAYLOAD.payload);
});

test("server bazaar extension overrides the client echo; other client extensions preserved", () => {
  const args = toV2FacilitatorArgs(V2_PAYLOAD, V1_ACCEPT_BASE, BAZAAR_EXTENSIONS);
  assert.deepStrictEqual(args.paymentPayload.extensions.bazaar, BAZAAR_EXTENSIONS.bazaar);
  assert.deepStrictEqual(args.paymentPayload.extensions.other, V2_PAYLOAD.extensions.other);
});

test("client-echoed resource is forwarded; derived from requirements when absent", () => {
  const withEcho = toV2FacilitatorArgs(V2_PAYLOAD, V1_ACCEPT_BASE, null);
  assert.deepStrictEqual(withEcho.paymentPayload.resource, V2_PAYLOAD.resource);
  const { resource: _omit, ...noResource } = V2_PAYLOAD;
  const derived = toV2FacilitatorArgs(noResource, V1_ACCEPT_BASE, null);
  assert.deepStrictEqual(derived.paymentPayload.resource, {
    url: V1_ACCEPT_BASE.resource,
    description: V1_ACCEPT_BASE.description,
    mimeType: V1_ACCEPT_BASE.mimeType,
  });
});

test("fails closed on a payload without an inner `payload` object", () => {
  assert.strictEqual(toV2FacilitatorArgs({ x402Version: 2 }, V1_ACCEPT_BASE, null), null);
  assert.strictEqual(toV2FacilitatorArgs({ x402Version: 2, payload: "nope" }, V1_ACCEPT_BASE, null), null);
});

test("fails closed when the matched requirements can't be expressed in v2", () => {
  assert.strictEqual(toV2FacilitatorArgs(V2_PAYLOAD, { ...V1_ACCEPT_BASE, network: "ethereum" }, null), null);
});

test("Solana payments wrap regardless of claimed version (CDP requires v2 for Solana)", () => {
  const v1Solana = { x402Version: 1, scheme: "exact", network: V1_ACCEPT_SOLANA.network, payload: { transaction: "b64tx" } };
  const args = toV2FacilitatorArgs(v1Solana, V1_ACCEPT_SOLANA, BAZAAR_EXTENSIONS);
  assert.ok(args);
  assert.strictEqual(args.paymentRequirements.network, SOLANA_MAINNET_CAIP2);
  assert.strictEqual(args.paymentPayload.x402Version, 2);
  assert.deepStrictEqual(args.paymentPayload.payload, { transaction: "b64tx" });
  assert.deepStrictEqual(args.paymentPayload.extensions.bazaar, BAZAAR_EXTENSIONS.bazaar);
});

console.log("x402 v2: Bazaar extension parity across payment paths");

test("native-v2 and v1→v2-translated settles carry the IDENTICAL server bazaar block", () => {
  // v1→v2 translation path (lib/x402V1.ts toV2Payload — PR #65, unchanged)
  const sanitizedV1 = { x402Version: 1, scheme: "exact", network: "base", payload: V1_PAYLOAD.payload };
  const translated = toV2Payload(sanitizedV1, V1_ACCEPT_BASE, BAZAAR_EXTENSIONS);
  assert.ok(translated);
  // native v2 path (lib/x402V2.ts toV2FacilitatorArgs — this PR)
  const native = toV2FacilitatorArgs(V2_PAYLOAD, V1_ACCEPT_BASE, BAZAAR_EXTENSIONS);
  assert.ok(native);
  assert.deepStrictEqual(native.paymentPayload.extensions.bazaar, translated.extensions.bazaar);
  // and both send the same v2 requirements semantics (CAIP-2 + amount)
  assert.strictEqual(native.paymentRequirements.network, "eip155:8453");
  assert.strictEqual(native.paymentRequirements.amount, "10000");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll x402 v2 tests passed");
