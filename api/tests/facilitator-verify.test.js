/**
 * Focused regression test for facilitator verification durability.
 *
 * Run: node tests/facilitator-verify.test.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "routes", "facilitator.ts"),
  "utf-8",
);

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

const verifyRoute = routeSrc.match(
  /router\.post\("\/verify"[\s\S]*?\n\}\);\n\n\/\/ ─── POST \/settle/,
)?.[0] ?? "";

console.log("Facilitator — verification durability:");

test("verification route was found", () => {
  assert.ok(verifyRoute, "could not isolate /verify route");
});

test("releaseNonce is available to undo a verified-but-unrecorded payment", () => {
  assert.ok(
    /releaseNonce/.test(routeSrc),
    "facilitator route must import and call releaseNonce",
  );
});

test("successful verification record creation is awaited and not swallowed", () => {
  assert.ok(
    /await prisma\.facilitatorPayment\.create\(/.test(verifyRoute),
    "verified payment must be persisted before returning success",
  );
  assert.ok(
    !/facilitatorPayment\.create\([\s\S]{0,700}\)\.catch\(/.test(verifyRoute),
    "verified payment persistence failure must not be swallowed",
  );
});

test("persistence failure releases nonce and returns retryable 503", () => {
  assert.ok(
    /catch \(err\) \{[\s\S]*await releaseNonce\(nonce, provider\.id\)[\s\S]*res\.status\(503\)\.json/.test(verifyRoute),
    "verified-but-unrecorded payment must release nonce and return 503",
  );
  assert.ok(
    /verification_persistence_error/.test(verifyRoute),
    "503 response should identify verification persistence failure",
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll facilitator verification durability tests passed.");
