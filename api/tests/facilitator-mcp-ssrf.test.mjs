/**
 * Focused unit regressions for the combined security branch:
 *   #20 — facilitator /settle enforces the per-provider network allowlist
 *   #18 — facilitator releaseNonce clears the in-memory nonce fallback
 *
 * Both assertions run against the COMPILED dist/ output (build first).
 *
 * Run: npm run build && node tests/facilitator-mcp-ssrf.test.mjs
 *
 * NOTE: releaseNonce's in-memory path is only exercised when Redis is absent, so
 * this file must run WITHOUT REDIS_URL (the service falls back to the in-memory
 * map used by #39's local nonce fallback).
 */
import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

delete process.env.REDIS_URL; // force the in-memory nonce fallback path

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

async function main() {
  // ── #20: provider network allowlist enforced on the settle path ────────────
  const { validatePaymentDetailsForProvider } = await import(
    path.join(__dirname, "..", "dist", "routes", "facilitator.js")
  );

  const basePaymentDetails = {
    scheme: "exact",
    network: "eip155:8453", // Base
    maxAmountRequired: "1000000",
    resource: "https://provider.example/resource",
    payTo: "0x0000000000000000000000000000000000000001",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };

  console.log("FaaS settle — provider network allowlist (#20):");
  await test("Base-only provider may settle Base payments", () =>
    assert.strictEqual(
      validatePaymentDetailsForProvider(basePaymentDetails, ["eip155:8453"]),
      null,
    ));

  await test("one-step settle REJECTS a chain the provider never enabled", () => {
    const result = validatePaymentDetailsForProvider(
      { ...basePaymentDetails, network: "eip155:1" }, // Ethereum mainnet
      ["eip155:8453"],
    );
    assert.strictEqual(result?.error, "unsupported_network");
    assert.ok(result?.message.includes("eip155:1"));
  });

  await test("settle rejects incomplete paymentDetails before verify/settle", () => {
    const result = validatePaymentDetailsForProvider(
      { ...basePaymentDetails, asset: "" },
      ["eip155:8453"],
    );
    assert.strictEqual(result?.error, "invalid_payment_details");
  });

  // ── #18: releaseNonce clears the in-memory fallback, not just Redis ─────────
  const { reserveNonce, releaseNonce } = await import(
    path.join(__dirname, "..", "dist", "services", "facilitator.js")
  );

  console.log("FaaS nonce — releaseNonce clears in-memory fallback (#18):");
  await test("releaseNonce makes a reserved (Redis-less) nonce reusable again", async () => {
    const providerId = "prov_test_18";
    const nonce = `nonce_${Date.now()}`;

    // First reservation succeeds (new).
    const first = await reserveNonce(nonce, providerId, { allowLocalFallback: true });
    assert.strictEqual(first, "new", "first reservation should be new");

    // Same nonce again is a replay while still reserved.
    const replay = await reserveNonce(nonce, providerId, { allowLocalFallback: true });
    assert.strictEqual(replay, "replay", "unreleased nonce must replay");

    // Release should clear the IN-MEMORY key (the bug: it early-returned when
    // Redis was absent, leaving the nonce reserved forever).
    await releaseNonce(nonce, providerId);

    // After release, the same nonce reserves fresh again — legit retry unblocked.
    const afterRelease = await reserveNonce(nonce, providerId, { allowLocalFallback: true });
    assert.strictEqual(afterRelease, "new", "released nonce must be reusable");
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll facilitator/nonce regression tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
