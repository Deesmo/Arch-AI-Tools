/**
 * Focused tests for account-tier normalization.
 *
 * Run: node tests/tier.test.js  (requires `npm run build` first for dist/)
 */
import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { enforcementTierForAccount, tierFromSubscriptionPlanId } = await import(
  path.join(__dirname, "..", "dist", "lib", "tiers.js")
);

const cases = [
  ["starter-monthly", "starter", "pro"],
  ["pro-monthly", "pro", "pro"],
  ["growth-monthly", "growth", "pro"],
  ["business-monthly", "business", "business"],
  ["unknown-monthly", "free", "free"],
];

for (const [planId, storedTier, enforcementTier] of cases) {
  assert.strictEqual(tierFromSubscriptionPlanId(planId), storedTier, `${planId} stored tier`);
  assert.strictEqual(enforcementTierForAccount(storedTier), enforcementTier, `${storedTier} enforcement tier`);
}

assert.strictEqual(enforcementTierForAccount("growth"), "pro", "growth must not fall through to free limits");
assert.strictEqual(enforcementTierForAccount("starter"), "pro", "starter remains a paid enforcement tier");
assert.strictEqual(enforcementTierForAccount(" BUSINESS "), "business", "tier matching is case/space tolerant");

console.log("All tier normalization tests passed.");
