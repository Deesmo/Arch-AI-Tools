/**
 * Focused regression tests for critical fail-closed gates.
 *
 * These checks prevent routes from acknowledging success or allowing side-effect
 * execution when the DB gate that enforces billing/auth/abuse state fails.
 *
 * Run: node tests/failclosed.test.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(__dirname, "..", "src", ...p);

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

console.log("Fail-closed critical persistence/limit gates:");

const billingRouteSrc = fs.readFileSync(src("routes", "billing.ts"), "utf-8");
test("Stripe cancellation persistence failure returns retryable 500", () => {
  assert.ok(billingRouteSrc.includes("subscription_cancellation_failed"),
    "billing route must fail closed when cancellation tier downgrade fails");
  assert.ok(!/tier:\s*["']free["'][\s\S]{0,220}\.catch\(\(\)\s*=>\s*\{\}\)/.test(billingRouteSrc),
    "billing route must not swallow tier downgrade failures");
});

const agentRouteSrc = fs.readFileSync(src("routes", "agent.ts"), "utf-8");
test("API-key revocation persistence failure does not report success", () => {
  assert.ok(agentRouteSrc.includes("key_revocation_failed"),
    "agent route must report key revocation persistence failures");
  assert.ok(!/apiKeyPrefix:\s*null[\s\S]{0,220}\.catch\(\(\)\s*=>\s*\{\}\)/.test(agentRouteSrc),
    "agent route must not swallow API-key revocation failures");
});

const toolsRouteSrc = fs.readFileSync(src("routes", "tools", "index.ts"), "utf-8");
test("side-effect daily cap lookup failure blocks tool execution", () => {
  assert.ok(toolsRouteSrc.includes("limit_check_unavailable"),
    "tools route must fail closed when daily limit lookup fails");
  assert.ok(!/apiRequest\.count\([\s\S]*?\.catch\(\(\)\s*=>\s*0\)/.test(toolsRouteSrc),
    "tools route must not default daily cap count to zero on DB failure");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll fail-closed regression tests passed.");
