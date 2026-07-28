/**
 * Regression coverage for high-severity bugs found by the critical-bug scan.
 *
 * Run: node api/tests/critical-regressions.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

const agentSrc = fs.readFileSync(path.join(srcRoot, "routes", "agent.ts"), "utf8");
const toolsSrc = fs.readFileSync(path.join(srcRoot, "routes", "tools", "index.ts"), "utf8");
const seedSrc = fs.readFileSync(path.join(srcRoot, "seed.ts"), "utf8");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.error(error);
  }
}

function seedCredits(toolName) {
  const match = seedSrc.match(new RegExp(`name: "${toolName}"[\\s\\S]*?credits: (\\d+)`));
  assert.ok(match, `missing seed entry for ${toolName}`);
  return Number(match[1]);
}

function responseCredits(toolName) {
  const route = toolsSrc.match(new RegExp(`router\\.post\\("/${toolName}"[\\s\\S]*?\\n\\}\\);`));
  assert.ok(route, `missing route for ${toolName}`);
  const matches = [...route[0].matchAll(/credits_used:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(matches.length > 0, `missing credits_used response for ${toolName}`);
  return new Set(matches);
}

test("account deletion erases SignupIdentity using the shared normalized email identity", () => {
  assert.ok(agentSrc.includes("normalizeEmailIdentity"), "agent route imports normalizeEmailIdentity");
  assert.match(
    agentSrc,
    /signupIdentity\.deleteMany\(\{\s*where:\s*\{\s*normalizedEmail:\s*normalizeEmailIdentity\(email\)\s*\}\s*\}\)/,
    "DELETE /v1/agent must delete the same normalized identity signup stored",
  );
});

test("account deletion cancels Stripe subscriptions before local anonymization", () => {
  assert.ok(agentSrc.includes("cancelStripeSubscriptionsForDeletedAgent"), "deletion route has a Stripe cancellation guard");
  const cancelIndex = agentSrc.indexOf("cancelStripeSubscriptionsForDeletedAgent(agent.id, email)");
  const transactionIndex = agentSrc.indexOf("prisma.$transaction(async (tx)");
  assert.ok(cancelIndex > 0, "DELETE /v1/agent invokes Stripe subscription cancellation");
  assert.ok(transactionIndex > 0, "DELETE /v1/agent still anonymizes in a transaction");
  assert.ok(cancelIndex < transactionIndex, "Stripe subscriptions are canceled before the local account is anonymized");
  assert.match(agentSrc, /BILLABLE_SUBSCRIPTION_STATUSES[\s\S]*active[\s\S]*trialing[\s\S]*past_due[\s\S]*unpaid/);
});

test("seed catalog advertises the audited default/base prices actually charged", () => {
  assert.strictEqual(seedCredits("web-search"), 14);
  assert.strictEqual(seedCredits("ocr-extract"), 12);
  assert.strictEqual(seedCredits("email-find"), 110);
  assert.strictEqual(seedCredits("design-create"), 50);
  assert.strictEqual(seedCredits("news-search"), 12);
  assert.strictEqual(seedCredits("fact-check"), 14);
  assert.strictEqual(seedCredits("video-generate"), 700);
  assert.strictEqual(seedCredits("image-remove-bg"), 350);
});

test("successful result bodies report the same fixed price the route deducts", () => {
  assert.deepStrictEqual(responseCredits("news-search"), new Set([12]));
  assert.deepStrictEqual(responseCredits("fact-check"), new Set([14]));
  assert.deepStrictEqual(responseCredits("email-find"), new Set([0, 110]));
  assert.deepStrictEqual(responseCredits("image-remove-bg"), new Set([350]));
});

test("research-report reports the deducted cost variable, not the stale flat 15", () => {
  const start = toolsSrc.indexOf('router.post("/research-report"');
  assert.ok(start >= 0, "missing research-report route");
  const end = toolsSrc.indexOf("router.post(", start + 1);
  const route = toolsSrc.slice(start, end > start ? end : undefined);
  assert.ok(!/credits_used:\s*15\b/.test(route), "stale flat credits_used: 15 must be gone");
  assert.match(route, /deductCredits\(req, res, "research-report", researchReportCost\)/);
  assert.match(route, /researchReportCost = paid \? 0 : byokAdjustedCost\(req, 40,/);
  const payloads = [...route.matchAll(/credits_used:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(payloads.length >= 2, "research-report has both success payloads");
  assert.ok(payloads.every((v) => v === "researchReportCost"), "every payload reports the deducted cost");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
