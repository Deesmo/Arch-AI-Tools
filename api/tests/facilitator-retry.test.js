/**
 * Focused regression tests for facilitator retry safety.
 *
 * Run: node tests/facilitator-retry.test.js
 */
import assert from "assert";
import fs from "fs";
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

const facilitatorSvcSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "facilitator.ts"),
  "utf-8"
);
const facilitatorRouteSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "routes", "facilitator.ts"),
  "utf-8"
);

console.log("Facilitator — retryable nonce release:");
test("releaseNonce clears in-memory fallback as well as Redis", () => {
  assert.ok(
    /memFacilitatorNonces\.delete\(key\)/.test(facilitatorSvcSrc),
    "facilitator releaseNonce must clear Redis-less fallback nonce"
  );
});
test("failed settlement releases retryable local nonce", () => {
  assert.ok(
    /result\.errorMessage !== "nonce_already_consumed"[\s\S]*await releaseNonce\(nonce, provider\.id\)/.test(facilitatorRouteSrc),
    "settlement failure must release local nonce unless it is already consumed on-chain"
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll facilitator retry tests passed.");
