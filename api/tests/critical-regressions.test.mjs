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
const billingSrc = fs.readFileSync(path.join(srcRoot, "routes", "billing.ts"), "utf8");
const oauthSrc = fs.readFileSync(path.join(srcRoot, "routes", "oauth.ts"), "utf8");
const toolsSrc = fs.readFileSync(path.join(srcRoot, "routes", "tools", "index.ts"), "utf8");
const x402Src = fs.readFileSync(path.join(srcRoot, "middleware", "x402.ts"), "utf8");
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

function toolRoute(toolName) {
  const start = toolsSrc.indexOf(`router.post("/${toolName}"`);
  assert.ok(start >= 0, `missing ${toolName} route`);
  const end = toolsSrc.indexOf("router.post(", start + 1);
  return toolsSrc.slice(start, end > start ? end : undefined);
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
  const route = toolRoute("research-report");
  assert.ok(!/credits_used:\s*15\b/.test(route), "stale flat credits_used: 15 must be gone");
  assert.match(route, /deductCredits\(req, res, "research-report", researchReportCost\)/);
  assert.match(route, /researchReportCost = paid \? 0 : byokAdjustedCost\(req, 40,/);
  const payloads = [...route.matchAll(/credits_used:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(payloads.length >= 1, "research-report has a success payload");
  assert.ok(payloads.every((v) => v === "researchReportCost"), "every payload reports the deducted cost");
});

test("OAuth dynamic client registration rejects malformed metadata arrays before iterating or persisting", () => {
  assert.match(oauthSrc, /typeof client_name !== "string"/, "client_name must be type-checked");
  assert.match(oauthSrc, /redirect_uris\.every\(\(uri\) => typeof uri === "string"\)/, "redirect_uris entries must be strings");
  assert.match(oauthSrc, /grant_types !== undefined && \(!Array\.isArray\(grant_types\)/, "grant_types must be checked before iteration");
  assert.match(oauthSrc, /response_types !== undefined && \(!Array\.isArray\(response_types\)/, "response_types must be checked before response/persistence");
  assert.match(oauthSrc, /token_endpoint_auth_method !== undefined && typeof token_endpoint_auth_method !== "string"/, "auth method must be a string");
});

test("billing checkout and subscription normalize only string pack or plan values", () => {
  assert.match(billingSrc, /function normalizeBillingKey\(value: unknown\): string \{\s*return typeof value === "string" \? value\.toLowerCase\(\)\.trim\(\) : "";\s*\}/);
  assert.match(billingSrc, /const \{ pack, plan \} = req\.body as \{ pack\?: unknown; plan\?: unknown \};\s*const rawKey = normalizeBillingKey\(pack \?\? plan\);/);
  assert.match(billingSrc, /const \{ plan, pack \} = req\.body as \{ plan\?: unknown; pack\?: unknown \};\s*const planKey = normalizeBillingKey\(plan \?\? pack\);/);
});

test("research-report and fact-check fail closed when Anthropic cannot produce the paid artifact", () => {
  const researchRoute = toolRoute("research-report");
  const factRoute = toolRoute("fact-check");

  const researchProviderCheck = researchRoute.indexOf('error: "no_provider"');
  const researchDeduct = researchRoute.indexOf('deductCredits(req, res, "research-report", researchReportCost)');
  assert.ok(researchProviderCheck > 0, "research-report must reject missing Anthropic");
  assert.ok(researchProviderCheck < researchDeduct, "research-report must not deduct credits before rejecting missing Anthropic");
  assert.ok(!researchRoute.includes("report: null"), "research-report must not return ok:true with report:null");
  assert.match(researchRoute, /if \(!report\) \{\s*return void res\.status\(502\)\.json\(\{ ok: false, error: "synthesis_failed"/, "empty reports must fail");

  const factProviderCheck = factRoute.indexOf('error: "no_provider"');
  const factDeduct = factRoute.indexOf('deductCredits(req, res, "fact-check", 14)');
  assert.ok(factProviderCheck > 0, "fact-check must reject missing Anthropic");
  assert.ok(factProviderCheck < factDeduct, "fact-check must not deduct credits before rejecting missing Anthropic");
  assert.ok(!factRoute.includes("verdict: null"), "fact-check must not return ok:true with verdict:null");
  assert.match(factRoute, /if \(!raw\) \{\s*return void res\.status\(502\)\.json\(\{ ok: false, error: "analysis_failed"/, "empty analysis must fail");
});

test("anonymous x402 analysis tools reject missing Anthropic before returning a payment challenge or settling", () => {
  assert.match(x402Src, /const X402_ANTHROPIC_SYNTHESIS_TOOLS = new Set\(\["research-report", "fact-check"\]\);/);
  assert.match(
    x402Src,
    /if \(\(paymentHeader \|\| !hasApiCredential\) && X402_ANTHROPIC_SYNTHESIS_TOOLS\.has\(toolName\) && !hasAnthropicSynthesisCredential\(req\)\)/,
    "x402 middleware must fail provider-unavailable analysis calls before settlement",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
