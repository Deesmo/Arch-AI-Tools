/**
 * Security hardening regression tests (tools + credits lane).
 *
 * Covers the confirmed-live fixes on this branch:
 *   A (#22)  NFT tokenId path-injection validator (decimal-only, bounded).
 *   B (#19)  platform side-effect tools require an account even when x402-paid.
 *   C.2 (#11) x402 in-memory nonce release on failed verify/settle.
 *   C.3 (#11) AI Oracle BYOK: bad user key never falls through to a free
 *             platform-key response.
 *   C.4 (#11) finalizeCharge only charges when the response was delivered.
 *   C.5 (#11) monthly refresh TOPS UP to the free floor — max(current, floor) —
 *             never lowers a purchased balance.
 *   #12.1    x402 GET discovery builds the 402 directly (never settles a probe).
 *   #12.2-4  BYOK discount scoping (provider-specific / platform-only full cost).
 *
 * Run: node tests/tools-credits-hardening.test.mjs   (after npm run build)
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (...p) => path.join(__dirname, "..", "dist", ...p);
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

// The validator lives inline (not exported); mirror its exact contract so a
// drift in the regex breaks this test. The source assertion below pins the
// real regex so the two can never silently diverge.
function normalizeCdpTokenId(tokenId) {
  if (tokenId === null || tokenId === undefined) return null;
  const cleaned = String(tokenId).trim();
  if (!/^[0-9]{1,78}$/.test(cleaned)) return null;
  return cleaned;
}

async function main() {
  const toolsSrc = fs.readFileSync(src("routes", "tools", "index.ts"), "utf-8");
  const x402Src = fs.readFileSync(src("middleware", "x402.ts"), "utf-8");

  // ── A (#22): NFT tokenId path-injection validator ──────────────────────────
  console.log("A — NFT tokenId path validator:");
  await test("accepts a plain decimal token ID", () =>
    assert.strictEqual(normalizeCdpTokenId("12345"), "12345"));
  await test("trims surrounding whitespace", () =>
    assert.strictEqual(normalizeCdpTokenId("  42  "), "42"));
  await test("accepts a full uint256 (78 digits)", () =>
    assert.strictEqual(normalizeCdpTokenId("9".repeat(78)), "9".repeat(78)));
  await test("rejects 79+ digits (over uint256 bound)", () =>
    assert.strictEqual(normalizeCdpTokenId("9".repeat(79)), null));
  await test("rejects path-traversal injection", () =>
    assert.strictEqual(normalizeCdpTokenId("1/../../admin"), null));
  await test("rejects hex / 0x forms (path stays strictly decimal)", () => {
    assert.strictEqual(normalizeCdpTokenId("0x1f"), null);
    assert.strictEqual(normalizeCdpTokenId("deadbeef"), null);
  });
  await test("rejects empty / null / undefined", () => {
    assert.strictEqual(normalizeCdpTokenId(""), null);
    assert.strictEqual(normalizeCdpTokenId("   "), null);
    assert.strictEqual(normalizeCdpTokenId(null), null);
    assert.strictEqual(normalizeCdpTokenId(undefined), null);
  });
  await test("source pins the decimal-only regex and encodes the segment", () => {
    assert.ok(toolsSrc.includes("function normalizeCdpTokenId(tokenId: unknown)"), "helper missing");
    assert.ok(/\/\^\[0-9\]\{1,78\}\$\//.test(toolsSrc), "regex must be ^[0-9]{1,78}$");
    assert.ok(
      /const requestPath = `\/platform\/v2\/evm\/nfts\/base\/\$\{contractAddress\}\/\$\{encodeURIComponent\(tokenIdClean\)\}`/.test(toolsSrc),
      "signed CDP path must use encodeURIComponent(tokenIdClean)");
  });

  // ── B (#19): platform side-effect tools require an account under x402 ───────
  console.log("B — platform side-effect tools require an account:");
  const x402 = await import(dist("middleware", "x402.js"));
  await test("email-send / send-email are NOT anonymous x402 resources", () => {
    assert.strictEqual(x402.isX402AnonymousTool("email-send"), false);
    assert.strictEqual(x402.isX402AnonymousTool("send-email"), false);
  });
  await test("ordinary utility tools remain anonymous x402 resources", () => {
    assert.strictEqual(x402.isX402AnonymousTool("generate-hash"), true);
    assert.strictEqual(x402.isX402AnonymousTool("qr-code"), true);
  });
  await test("removed social-post tool is NOT in the account-required set", () => {
    // social-post was deleted in #51; it must not linger in the guard set.
    assert.ok(!x402Src.includes('"social-post"'), "social-post reference must be gone");
  });
  await test("account-required guard runs BEFORE facilitator verify/settle", () => {
    const mwIdx = x402Src.indexOf("export function x402Middleware");
    const guardIdx = x402Src.indexOf("if (!isX402AnonymousTool(toolName))", mwIdx);
    const verifyIdx = x402Src.indexOf("const verifyResult = await verifyPayment", mwIdx);
    const settleIdx = x402Src.indexOf("const settleResult = await settlePayment", mwIdx);
    assert.ok(guardIdx > -1, "guard missing");
    assert.ok(guardIdx < verifyIdx, "guard must precede verify");
    assert.ok(guardIdx < settleIdx, "guard must precede settle");
  });

  // ── C.2 (#11): x402 in-memory nonce release on failure ─────────────────────
  console.log("C.2 — x402 in-memory nonce release:");
  const { checkAndStoreNonce, releaseStoredNonce } = x402;
  await test("in-memory nonce is replay-guarded, then freed for retry", async () => {
    const first = await checkAndStoreNonce("0xhardening-retry", 600, null);
    const replay = await checkAndStoreNonce("0xhardening-retry", 600, null);
    assert.strictEqual(first, "new");
    assert.strictEqual(replay, "replay");
    await releaseStoredNonce("0xhardening-retry"); // simulate failed verify/settle cleanup
    const retry = await checkAndStoreNonce("0xhardening-retry", 600, null);
    assert.strictEqual(retry, "new", "released nonce must be retryable");
    await releaseStoredNonce("0xhardening-retry");
  });
  await test("both failure branches release via releaseStoredNonce (not redis-only)", () => {
    assert.ok(x402Src.includes("export async function releaseStoredNonce"), "helper missing");
    assert.ok(x402Src.includes("memNonceCache.delete(nonce)"), "must clear in-memory store");
    assert.ok(!/if \(nonce && redis\) await redis\.del/.test(x402Src), "redis-only cleanup must be gone");
    const count = (x402Src.match(/if \(nonce\) await releaseStoredNonce\(nonce\)/g) || []).length;
    assert.strictEqual(count, 2, "both verify-fail and settle-fail must release the nonce");
  });

  // ── C.3 (#11): AI Oracle BYOK — no free platform fallback ──────────────────
  console.log("C.3 — AI Oracle BYOK no-free-fallback decision:");
  await test("platform Anthropic provider is gated off whenever any BYOK header is present", () =>
    assert.ok(/oraclByokAnthropicKey \|\| \(!oracleHasByok && getAnthropic\(\)\)/.test(toolsSrc),
      "platform anthropic must require !oracleHasByok"));
  await test("platform OpenAI provider is gated off whenever any BYOK header is present", () =>
    assert.ok(/oraclByokOpenaiKey \|\| \(!oracleHasByok \? process\.env\.OPENAI_API_KEY : undefined\)/.test(toolsSrc),
      "platform openai must require !oracleHasByok"));
  await test("response byok flag is per-provider, not the blanket oracleHasByok", () =>
    assert.ok(/\.\.\.\(provider\.byok \? \{ byok: true, byok_provider: providerName \} : \{\}\)/.test(toolsSrc)));

  // ── C.4 (#11): finalizeCharge only charges on a delivered response ─────────
  console.log("C.4 — refund/no-charge when response not delivered:");
  const creditsSrc = fs.readFileSync(src("utils", "credits.ts"), "utf-8");
  await test("finalizeCharge requires responseCompleted before treating as success", () => {
    assert.ok(/const succeeded = responseCompleted && res\.statusCode >= 200 && res\.statusCode < 400/.test(creditsSrc));
    assert.ok(/res\.once\("close", \(\) => \{ void finalizeCharge\(res\.writableEnded\); \}\)/.test(creditsSrc),
      "close handler must pass res.writableEnded");
    assert.ok(/res\.once\("finish", \(\) => \{ void finalizeCharge\(true\); \}\)/.test(creditsSrc),
      "finish handler must pass true");
  });

  // ── C.5 (#11): monthly refresh TOPS UP to the floor — max(current, floor) ──
  console.log("C.5 — monthly refresh top-up logic (never lower a paid balance):");
  process.env.FREE_MONTHLY_CREDITS = "250";
  const { prisma } = await import(dist("lib", "prisma.js"));
  const { refreshMonthlyCredits } = await import(dist("cron", "refreshCredits.js"));

  const lastMonth = new Date("2026-05-15T00:00:00.000Z");
  const thisMonth = new Date("2026-06-10T00:00:00.000Z");
  const updates = [];
  prisma.agent.findMany = async () => [
    { id: "low_old", email: null, credits: 10, updatedAt: lastMonth },     // below floor → top up
    { id: "high_old", email: null, credits: 1000, updatedAt: lastMonth },  // purchased pack → untouched
    { id: "low_new", email: null, credits: 10, updatedAt: thisMonth },     // already refreshed this month → skip
  ];
  prisma.agent.updateMany = async (args) => {
    updates.push(args);
    // Mirror the DB guard `credits: { lt: 250 }`: high_old at 1000 matches nothing.
    if (args.where.id === "high_old") return { count: 0 };
    return { count: 1 };
  };

  await test("tops up a stale low balance to exactly the monthly floor", async () => {
    updates.length = 0;
    const result = await refreshMonthlyCredits(new Date("2026-06-26T00:00:00.000Z"));
    assert.deepStrictEqual(result, { granted: 1, skipped: 2 },
      "one granted (low_old), two skipped (high_old guarded-out, low_new same-month)");
  });
  await test("update is gated by credits < floor so a paid balance is never lowered", () => {
    for (const u of updates) {
      assert.deepStrictEqual(u.where.credits, { lt: 250 }, "must only update when below the floor");
      assert.deepStrictEqual(u.data, { credits: 250 }, "top up to the floor, not a reset below it");
    }
    // high_old (1000 credits) is never actually lowered: the { lt: 250 } guard
    // returns count:0, so its balance stays at 1000 — the core C.5 invariant.
    const highOld = updates.find((u) => u.where.id === "high_old");
    assert.ok(highOld, "high_old still attempts a guarded update");
  });
  await test("source is TOP-UP (updateMany + lt guard), not an unconditional reset", () => {
    const refreshSrc = fs.readFileSync(src("cron", "refreshCredits.ts"), "utf-8");
    assert.ok(/updateMany\(\{\s*where: \{ id: agent\.id, credits: \{ lt: credits \} \}/.test(refreshSrc),
      "must guard on credits < floor");
    assert.ok(!/prisma\.agent\.update\(\{\s*where: \{ id: agent\.id \},\s*data: \{ credits: credits \}/.test(refreshSrc),
      "unconditional reset update must be gone");
  });

  // ── #12.1: x402 GET discovery must never settle a paid probe ───────────────
  console.log("#12.1 — x402 GET discovery builds 402 directly (no settle):");
  await test("GET handler calls buildPaymentRequired and never x402Middleware", () => {
    const getIdx = toolsSrc.indexOf('router.get("/:toolName"');
    assert.ok(getIdx > 0, "GET handler missing");
    const getHandler = toolsSrc.slice(getIdx);
    assert.ok(getHandler.includes("buildPaymentRequired(toolName, price)"), "must build 402 directly");
    assert.ok(!getHandler.includes("x402Middleware(toolName)"), "must not route probe through settlement middleware");
    assert.ok(getHandler.includes("!isX402AnonymousTool(toolName)"), "account-required tools stay out of discovery");
  });
  await test("buildPaymentRequired is exported from x402", () =>
    assert.strictEqual(typeof x402.buildPaymentRequired, "function"));

  // ── #12.2-4: BYOK discount scoping ─────────────────────────────────────────
  console.log("#12.2-4 — BYOK discount scoping:");
  await test("ai-generate resolves a provider-specific byokProvider", () => {
    assert.ok(toolsSrc.includes("const byokProvider ="), "provider-specific resolution missing");
    assert.ok(!/const hasByok = !!\(byokAnthropicKey/.test(toolsSrc), "blanket hasByok discount must be gone");
  });
  await test("platform-only provider tools charge full cost (no BYOK discount)", () => {
    assert.ok(toolsSrc.includes("const ttsCost = 25 + 8 * Math.ceil(text.length / 100)"));
    assert.ok(toolsSrc.includes('deductCredits(req, res, "transcribe-audio", 25)'));
    assert.ok(toolsSrc.includes("const videoCost = Math.max(500, duration * 125)"));
    assert.ok(toolsSrc.includes('deductCredits(req, res, "image-remove-bg", 350)'));
  });
  await test("research-report BYOK discount is scoped to its usable providers", () =>
    assert.ok(toolsSrc.includes('byokAdjustedCost(req, 40, ["x-brave-key", "x-tavily-key", "x-anthropic-key"])')));

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll tools/credits hardening tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
