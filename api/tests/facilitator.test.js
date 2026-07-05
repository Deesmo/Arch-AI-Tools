/**
 * Focused facilitator security regressions.
 *
 * Run: npm run build && node tests/facilitator.test.js
 */
import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function main() {
  const { validatePaymentDetailsForProvider } = await import(
    path.join(__dirname, "..", "dist", "routes", "facilitator.js")
  );

  const basePaymentDetails = {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "1000000",
    resource: "https://provider.example/resource",
    payTo: "0x0000000000000000000000000000000000000001",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };

  console.log("FaaS — provider network allowlist:");
  test("default Base-only provider may settle Base payments", () =>
    assert.strictEqual(validatePaymentDetailsForProvider(basePaymentDetails, ["eip155:8453"]), null));

  test("one-step settle rejects unenabled networks before verification/settlement", () => {
    const result = validatePaymentDetailsForProvider(
      { ...basePaymentDetails, network: "eip155:1" },
      ["eip155:8453"],
    );
    assert.strictEqual(result?.error, "unsupported_network");
    assert.ok(result?.message.includes("eip155:1"));
  });

  test("settle rejects incomplete paymentDetails before verification/settlement", () => {
    const result = validatePaymentDetailsForProvider(
      { ...basePaymentDetails, asset: "" },
      ["eip155:8453"],
    );
    assert.strictEqual(result?.error, "invalid_payment_details");
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll facilitator tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
