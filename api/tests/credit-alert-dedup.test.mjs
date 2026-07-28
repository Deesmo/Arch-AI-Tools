/**
 * Pay-path at credit exhaustion — regression tests.
 *
 * Covers (growth/pay-path):
 *   A  isNewAlertCycle threshold-crossing semantics (once per depletion
 *      cycle; a cycle resets only when a grant raised the balance).
 *   B  insufficient_credits 402 body carries the machine-actionable `links`
 *      purchase path — and points packs at /v1/billing/checkout (the
 *      /v1/billing/subscribe endpoint rejects bare pack ids by design).
 *   C  X-Credits-Remaining is set on successful calls (depletion visibility).
 *   D  Alert dedup wiring: no per-call sendLowCreditAlert spam; the depleted
 *      email is wired at both exhaustion moments (refusal + landing at 0);
 *      the AuditLog row is recorded BEFORE the send; the dead
 *      cron/lowCredits.ts batch (no dedup) is gone.
 *   E  Webhook events (credits.low / credits.depleted) are unchanged.
 *
 * Pure-logic tests mirror isNewAlertCycle exactly; a source pin below locks
 * the real implementation so the two can never silently diverge (same
 * pattern as tools-credits-hardening.test.mjs).
 *
 * Run: node tests/credit-alert-dedup.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(__dirname, "..", "src", ...p);

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

// Mirror of isNewAlertCycle in src/utils/credits.ts — pinned to the real
// source below.
function isNewAlertCycle(preCallCredits, lastRecordedCredits) {
  if (lastRecordedCredits === null || !Number.isFinite(lastRecordedCredits)) return true;
  return preCallCredits > lastRecordedCredits;
}

async function main() {
  const creditsSrc = fs.readFileSync(src("utils", "credits.ts"), "utf-8");
  const emailSrc = fs.readFileSync(src("services", "email.ts"), "utf-8");
  const billingSrc = fs.readFileSync(src("routes", "billing.ts"), "utf-8");

  // ── A: cycle semantics ──────────────────────────────────────────────────
  console.log("A — isNewAlertCycle (once per depletion cycle):");
  await test("first-ever alert always sends (no prior row)", () =>
    assert.strictEqual(isNewAlertCycle(18, null), true));
  await test("unreadable prior meta fails open (sends)", () =>
    assert.strictEqual(isNewAlertCycle(18, NaN), true));
  await test("same balance as last alert = same cycle (skip)", () =>
    assert.strictEqual(isNewAlertCycle(18, 18), false));
  await test("draining further = same cycle (skip)", () =>
    assert.strictEqual(isNewAlertCycle(11, 18), false));
  await test("repeated refusals at an unchanged balance dedupe", () =>
    assert.strictEqual(isNewAlertCycle(3, 3), false));
  await test("balance above last alert (grant landed) = new cycle", () =>
    assert.strictEqual(isNewAlertCycle(22, 18), true));
  await test("first landing inside the window after any real grant sends", () => {
    // Recorded balance is always <= LOW_CREDIT_THRESHOLD (post-deduction,
    // inside (0,20]); the first call landing back inside the window comes
    // from above it, so preCall >= 21 > recorded.
    assert.strictEqual(isNewAlertCycle(21, 20), true);
  });
  await test("mirror matches the shipped implementation byte-for-byte", () => {
    assert.ok(
      creditsSrc.includes(
        "export function isNewAlertCycle(preCallCredits: number, lastRecordedCredits: number | null): boolean {\n" +
        "  if (lastRecordedCredits === null || !Number.isFinite(lastRecordedCredits)) return true;\n" +
        "  return preCallCredits > lastRecordedCredits;\n" +
        "}"
      ),
      "isNewAlertCycle source drifted from the mirrored contract"
    );
  });

  // ── B: 402 purchase links ───────────────────────────────────────────────
  console.log("B — insufficient_credits 402 purchase links:");
  const refusalBlock = creditsSrc.slice(
    creditsSrc.indexOf("if (deduction.count === 0)"),
    creditsSrc.indexOf("agent.credits -= cost;")
  );
  await test("402 body keeps error code + credits_remaining", () => {
    assert.ok(refusalBlock.includes('error: "insufficient_credits"'));
    assert.ok(refusalBlock.includes("credits_remaining: agent.credits"));
  });
  await test("402 body carries links.buy_credits → /pricing", () =>
    assert.ok(refusalBlock.includes('buy_credits: "https://archtools.dev/pricing"')));
  await test("402 links.checkout_api targets /v1/billing/checkout with a pack", () =>
    assert.ok(refusalBlock.includes("POST /v1/billing/checkout {\\\"pack\\\":") ||
              refusalBlock.includes("POST /v1/billing/checkout {\"pack\":")));
  await test("402 links.subscribe_api uses plan ids (never bare packs)", () =>
    assert.ok(refusalBlock.includes("starter-monthly|pro-monthly|growth-monthly|business-monthly")));
  await test("402 body carries links.docs", () =>
    assert.ok(refusalBlock.includes('docs: "https://archtools.dev/docs"')));
  await test("billing keeps the pack-on-subscribe rejection guard (keeps our link factual)", () =>
    assert.ok(billingSrc.includes("is a one-time credit pack, not a subscription")));

  // ── C: depletion visibility on successful calls ─────────────────────────
  console.log("C — X-Credits-Remaining on success:");
  await test("X-Credits-Remaining header set after every successful deduction", () =>
    assert.ok(creditsSrc.includes('res.setHeader("X-Credits-Remaining", agent.credits.toString());')));
  await test("X-Upgrade-URL still advertised when balance < 20", () => {
    assert.ok(creditsSrc.includes("if (agent.credits < 20)"));
    assert.ok(creditsSrc.includes('res.setHeader("X-Upgrade-URL", "https://archtools.dev/pricing")'));
  });

  // ── D: alert dedup wiring ───────────────────────────────────────────────
  console.log("D — alert dedup wiring:");
  await test("per-call low-credit email spam pattern is gone", () => {
    // The old code emailed straight from the threshold check on EVERY call.
    assert.ok(
      !/prisma\.agent\.findUnique\(\{ where: \{ id: agent\.id \}, select: \{ email: true \} \}\)\s*\n\s*\.then\(a => \{ if \(a\?\.email\) sendLowCreditAlert/.test(creditsSrc),
      "old per-call sendLowCreditAlert pattern still present"
    );
  });
  await test("low alert goes through maybeSendCreditAlert with LOW_ALERT_ACTION", () => {
    assert.ok(creditsSrc.includes("action: LOW_ALERT_ACTION"));
    assert.ok(/action: LOW_ALERT_ACTION[\s\S]{0,400}sendLowCreditAlert\(email, agent\.credits, agent\.id\)/.test(creditsSrc));
  });
  await test("depleted email wired at the 402 refusal moment", () => {
    assert.ok(/if \(deduction\.count === 0\) \{[\s\S]{0,900}DEPLETED_ALERT_ACTION[\s\S]{0,600}sendCreditsDepletedAlert/.test(creditsSrc));
  });
  await test("depleted email wired when a call lands the balance at 0", () => {
    assert.ok(/if \(agent\.credits <= 0\) \{[\s\S]{0,600}DEPLETED_ALERT_ACTION[\s\S]{0,600}sendCreditsDepletedAlert/.test(creditsSrc));
  });
  await test("dedup row is recorded BEFORE the email is sent", () => {
    const helper = creditsSrc.slice(
      creditsSrc.indexOf("async function maybeSendCreditAlert"),
      creditsSrc.indexOf("export async function deductCredits")
    );
    const createIdx = helper.indexOf("prisma.auditLog.create");
    const sendIdx = helper.indexOf("await opts.send(");
    assert.ok(createIdx > -1 && sendIdx > -1 && createIdx < sendIdx,
      "auditLog.create must precede opts.send");
  });
  await test("dedup rows use the pinned AuditLog action names", () => {
    assert.ok(creditsSrc.includes('export const LOW_ALERT_ACTION = "low_credit_alert"'));
    assert.ok(creditsSrc.includes('export const DEPLETED_ALERT_ACTION = "credits_depleted_alert"'));
  });
  await test("dead batch cron (cron/lowCredits.ts, no dedup) is removed", () =>
    assert.ok(!fs.existsSync(src("cron", "lowCredits.ts"))));
  await test("depleted email accepts creditsRemaining and states the 402 fact", () => {
    assert.ok(emailSrc.includes("sendCreditsDepletedAlert(to: string, agentId: string, creditsRemaining = 0)"));
    assert.ok(emailSrc.includes("402 Payment Required"));
  });

  // ── E: webhook events unchanged ─────────────────────────────────────────
  console.log("E — webhook events unchanged:");
  await test("credits.low webhook still fires with the same payload keys", () => {
    assert.ok(/fireWebhookEvent\("credits\.low", agent\.id, \{\s*credits_remaining: agent\.credits,\s*tool_name: toolName,\s*threshold: LOW_CREDIT_THRESHOLD,/.test(creditsSrc));
  });
  await test("credits.depleted webhook still fires with the same payload keys", () => {
    assert.ok(/fireWebhookEvent\("credits\.depleted", agent\.id, \{\s*credits_remaining: 0,\s*tool_name: toolName,/.test(creditsSrc));
  });

  console.log(failures === 0 ? "\nAll credit-alert dedup tests passed." : `\n${failures} test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
