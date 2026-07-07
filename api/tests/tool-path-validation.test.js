/**
 * Focused regression tests for tool handlers that sign upstream request paths.
 *
 * Run: node tests/tool-path-validation.test.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "tools", "index.ts"), "utf-8");
const toolsDist = fs.readFileSync(path.join(__dirname, "..", "dist", "routes", "tools", "index.js"), "utf-8");

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

console.log("Tool path validation:");

test("base-nft-metadata validates tokenId as a decimal path segment", () => {
  const helperStart = toolsSrc.indexOf("function normalizeCdpTokenId(tokenId: unknown): string | null");
  assert.notStrictEqual(helperStart, -1, "normalizeCdpTokenId helper is missing");
  const helperBody = toolsSrc.slice(helperStart, toolsSrc.indexOf("// ─── BYOK discount", helperStart));
  assert.ok(helperBody.includes("/^[0-9]{1,78}$/"), "tokenId must be restricted to decimal digits only");
  assert.ok(helperBody.includes("return null"), "invalid tokenId values must be rejected before CDP signing");
});

test("tracked dist keeps the same tokenId validation", () => {
  const helperStart = toolsDist.indexOf("function normalizeCdpTokenId(tokenId)");
  assert.notStrictEqual(helperStart, -1, "dist normalizeCdpTokenId helper is missing");
  const helperBody = toolsDist.slice(helperStart, toolsDist.indexOf("// ─── BYOK discount", helperStart));
  assert.ok(helperBody.includes("/^[0-9]{1,78}$/"), "dist tokenId validation must stay decimal-only");
});

test("base-nft-metadata encodes the validated tokenId before signing CDP path", () => {
  assert.ok(
    /const requestPath = `\/platform\/v2\/evm\/nfts\/base\/\$\{contractAddress\}\/\$\{encodeURIComponent\(tokenIdClean\)\}`/.test(toolsSrc),
    "CDP requestPath must use encodeURIComponent(tokenIdClean)"
  );
  assert.ok(
    /const requestPath = `\/platform\/v2\/evm\/nfts\/base\/\$\{contractAddress\}\/\$\{encodeURIComponent\(tokenIdClean\)\}`/.test(toolsDist),
    "dist CDP requestPath must use encodeURIComponent(tokenIdClean)"
  );
});

test("base-nft-metadata returns the normalized tokenId in the response", () => {
  assert.ok(
    /tokenId: tokenIdClean/.test(toolsSrc),
    "response should not echo an unnormalized tokenId"
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tool path-validation tests passed.");
