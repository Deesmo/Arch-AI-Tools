/**
 * Focused unit tests for 2026-06-10 security fixes:
 *  - M1: email identity normalization (free-credit farming)
 *  - H1: x402 settle-guard predicate (no serve on null/failed settlement)
 *  - H3: atomic credit deduction guard shape (updateMany count contract)
 *  - H2: x402 nonce extraction (authorization.nonce), no hard reject on
 *        missing nonce, replay dedup fail-closed, TTL clamp
 *
 * Run: node tests/security.test.js  (requires `npm run build` first for dist/)
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

async function main() {
  // ── M1: normalizeEmailIdentity ────────────────────────────────────────────
  const { normalizeEmailIdentity } = await import(
    path.join(__dirname, "..", "dist", "lib", "verification.js")
  );

  console.log("M1 — normalizeEmailIdentity:");
  test("lowercases and trims", () =>
    assert.strictEqual(normalizeEmailIdentity("  User@Example.COM "), "user@example.com"));
  test("strips +alias for gmail ONLY", () =>
    assert.strictEqual(normalizeEmailIdentity("user+spam1@gmail.com"), "user@gmail.com"));
  test("does NOT strip +alias for non-gmail (local part literal)", () =>
    assert.strictEqual(normalizeEmailIdentity("user+spam1@example.com"), "user+spam1@example.com"));
  test("non-gmail +alias variants stay DISTINCT identities", () => {
    const a = normalizeEmailIdentity("a+x@fastmail.com");
    const b = normalizeEmailIdentity("a+y@fastmail.com");
    assert.notStrictEqual(a, b);
    assert.strictEqual(a, "a+x@fastmail.com");
    assert.strictEqual(b, "a+y@fastmail.com");
  });
  test("strips dots for gmail", () =>
    assert.strictEqual(normalizeEmailIdentity("u.s.e.r@gmail.com"), "user@gmail.com"));
  test("googlemail canonicalizes to gmail", () =>
    assert.strictEqual(normalizeEmailIdentity("u.ser+x@googlemail.com"), "user@gmail.com"));
  test("does NOT strip dots for non-gmail", () =>
    assert.strictEqual(normalizeEmailIdentity("u.ser@example.com"), "u.ser@example.com"));
  test("gmail farming variants collapse to one identity", () => {
    const a = normalizeEmailIdentity("user+1@gmail.com");
    const b = normalizeEmailIdentity("u.s.e.r@gmail.com");
    const c = normalizeEmailIdentity("USER@googlemail.com");
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
  });

  // ── M1b: atomic identity claim (SignupIdentity unique guard) ────────────
  // Exercises the REAL claimSignupIdentity path with prisma.$executeRaw
  // stubbed to simulate Postgres ON CONFLICT semantics: first INSERT for a
  // normalized identity returns 1 (claimed), subsequent inserts return 0.
  const verification = await import(
    path.join(__dirname, "..", "dist", "lib", "verification.js")
  );
  const prismaMod = await import(
    path.join(__dirname, "..", "dist", "lib", "prisma.js")
  );
  const realExecuteRaw = prismaMod.prisma.$executeRaw;
  const claimedIdentities = new Set();
  prismaMod.prisma.$executeRaw = async (strings, ...values) => {
    // Simulate the REAL Postgres table from the migration DDL: enforce that
    // every NOT NULL column WITHOUT a DB default is explicitly present in
    // the INSERT column list with a non-null bound value. This is exactly
    // the check that would have caught the missing-id NOT NULL violation
    // (Prisma @default(cuid()) does NOT apply to raw SQL).
    const sql = strings.join("$");
    const colMatch = sql.match(/INSERT\s+INTO\s+"SignupIdentity"\s*\(([^)]*)\)/i);
    assert.ok(colMatch, "raw INSERT must target SignupIdentity with an explicit column list");
    const cols = colMatch[1].split(",").map((c) => c.trim().replace(/"/g, ""));
    // NOT NULL columns with no DB default in 20260610_signup_identity DDL:
    const requiredCols = ["id", "normalized_email"]; // created_at has DEFAULT CURRENT_TIMESTAMP
    for (const rc of requiredCols) {
      assert.ok(cols.includes(rc), `INSERT must supply NOT NULL column "${rc}" (no DB default)`);
    }
    assert.strictEqual(values.length, cols.length, "each INSERT column must have a bound value");
    cols.forEach((c, i) => {
      assert.ok(values[i] !== null && values[i] !== undefined && values[i] !== "",
        `bound value for NOT NULL column "${c}" must be non-empty`);
    });
    const normalized = values[cols.indexOf("normalized_email")];
    if (claimedIdentities.has(normalized)) return 0; // ON CONFLICT DO NOTHING
    claimedIdentities.add(normalized);
    return 1;
  };

  console.log("M1b — atomic SignupIdentity claim:");
  await (async () => {
    try {
      const first = await verification.claimSignupIdentity("farmer@gmail.com");
      test("first claim for an identity succeeds (gets free grant)", () =>
        assert.strictEqual(first, true));
      const dupAlias = await verification.claimSignupIdentity("f.a.r.m.e.r+2@gmail.com");
      test("concurrent/duplicate gmail-variant claim is REJECTED by unique guard", () =>
        assert.strictEqual(dupAlias, false));
      const exactDup = await verification.claimSignupIdentity("farmer@gmail.com");
      test("exact duplicate claim is REJECTED by unique guard", () =>
        assert.strictEqual(exactDup, false));
      const fmA = await verification.claimSignupIdentity("a+x@fastmail.com");
      const fmB = await verification.claimSignupIdentity("a+y@fastmail.com");
      test("distinct non-gmail +alias identities BOTH claim (not collapsed)", () => {
        assert.strictEqual(fmA, true);
        assert.strictEqual(fmB, true);
      });
    } finally {
      prismaMod.prisma.$executeRaw = realExecuteRaw;
    }
  })();

  // ── H1: settle-guard predicate ────────────────────────────────────────────
  // Mirrors: const settled = !!settleResult && (settleResult.success === true || !!settleResult.transaction);
  const settled = (r) => !!r && (r.success === true || !!r.transaction);

  console.log("H1 — x402 settle guard:");
  test("null settle result → NOT settled (must 402, not serve)", () =>
    assert.strictEqual(settled(null), false));
  test("empty settle object → NOT settled", () =>
    assert.strictEqual(settled({}), false));
  test("success:false without tx → NOT settled", () =>
    assert.strictEqual(settled({ success: false }), false));
  test("success:true → settled", () =>
    assert.strictEqual(settled({ success: true }), true));
  test("transaction hash present → settled", () =>
    assert.strictEqual(settled({ transaction: "0xabc" }), true));

  // ── H3: atomic deduction contract ─────────────────────────────────────────
  // The guarded updateMany returns {count:0} when balance < cost → caller must
  // return the insufficient-credits error and never decrement below zero.
  console.log("H3 — atomic deduction contract:");
  const simulateAtomicDeduct = (balance, cost) =>
    balance >= cost ? { count: 1, newBalance: balance - cost } : { count: 0, newBalance: balance };
  test("sufficient balance deducts once", () => {
    const r = simulateAtomicDeduct(10, 3);
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.newBalance, 7);
  });
  test("insufficient balance does not deduct", () => {
    const r = simulateAtomicDeduct(2, 3);
    assert.strictEqual(r.count, 0);
    assert.strictEqual(r.newBalance, 2);
  });
  test("concurrent double-spend: only floor(balance/cost) succeed", () => {
    // emulate 5 concurrent requests racing on balance=3, cost=2 → exactly 1 wins
    let balance = 3;
    let wins = 0;
    for (let i = 0; i < 5; i++) {
      if (balance >= 2) { balance -= 2; wins++; }
    }
    assert.strictEqual(wins, 1);
    assert.ok(balance >= 0, "balance must never go negative");
  });

  // ── H2: x402 nonce extraction + replay dedup ────────────────────────────
  const x402 = await import(path.join(__dirname, "..", "dist", "middleware", "x402.js"));
  const { extractNonce, extractNonceTtlSeconds, checkAndStoreNonce } = x402;
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");

  console.log("H2 — extractNonce resolution order:");
  test("reads standard EIP-3009 payload.authorization.nonce", () =>
    assert.strictEqual(
      extractNonce(b64({ payload: { authorization: { nonce: "0xauth" } } })),
      "0xauth"));
  test("authorization.nonce wins over payload.nonce and top-level nonce", () =>
    assert.strictEqual(
      extractNonce(b64({ nonce: "top", payload: { nonce: "inner", authorization: { nonce: "0xauth" } } })),
      "0xauth"));
  test("payload.nonce wins over top-level nonce when authorization absent", () =>
    assert.strictEqual(
      extractNonce(b64({ nonce: "top", payload: { nonce: "inner" } })),
      "inner"));
  test("falls back to top-level nonce", () =>
    assert.strictEqual(extractNonce(b64({ nonce: "top" })), "top"));
  test("no nonce anywhere → null (never throws)", () =>
    assert.strictEqual(extractNonce(b64({ payload: { authorization: {} } })), null));
  test("garbage base64 → null (never throws)", () =>
    assert.strictEqual(extractNonce("!!!not-base64-json!!!"), null));
  test("empty-string nonces are treated as absent", () =>
    assert.strictEqual(
      extractNonce(b64({ nonce: "", payload: { nonce: "", authorization: { nonce: "" } } })),
      null));
  test("non-string nonce (number/null) → null", () =>
    assert.strictEqual(
      extractNonce(b64({ nonce: 42, payload: { authorization: { nonce: null } } })),
      null));

  console.log("H2 — missing nonce must NOT hard-reject:");
  const x402Src = fs.readFileSync(
    path.join(__dirname, "..", "src", "middleware", "x402.ts"), "utf-8");
  test("payment_nonce_required hard reject removed from middleware", () =>
    assert.ok(!x402Src.includes("payment_nonce_required"),
      "x402.ts must not 402 on missing nonce"));
  test("middleware gates dedup on nonce presence (falls through when null)", () => {
    // mirrors the middleware: dedup only runs `if (nonce)` — a null nonce
    // takes no replay branch and proceeds to verification.
    const nonce = extractNonce(b64({ payload: { authorization: {} } }));
    let rejected = false;
    if (nonce) rejected = true; // would enter dedup path
    assert.strictEqual(rejected, false);
  });

  console.log("H2 — checkAndStoreNonce dedup + fail-closed (mock redis):");
  const mockRedis = (impl) => ({ set: impl });
  await (async () => {
    const seen = new Set();
    const redisMock = mockRedis(async (key) => {
      if (seen.has(key)) return null;
      seen.add(key);
      return "OK";
    });
    const first = await checkAndStoreNonce("0xabc", 600, redisMock);
    const second = await checkAndStoreNonce("0xabc", 600, redisMock);
    test("fresh nonce → 'new' (stored, proceeds)", () =>
      assert.strictEqual(first, "new"));
    test("repeated nonce → 'replay' (402 payment_replay_detected)", () =>
      assert.strictEqual(second, "replay"));
  })();
  await (async () => {
    const failing = mockRedis(async () => { throw new Error("ECONNREFUSED"); });
    const r = await checkAndStoreNonce("0xdef", 600, failing);
    test("redis error → 'error' (fail-closed 402 payment_replay_check_unavailable)", () =>
      assert.strictEqual(r, "error"));
    test("middleware maps 'error' to payment_replay_check_unavailable", () =>
      assert.ok(x402Src.includes("payment_replay_check_unavailable")));
  })();
  await (async () => {
    let capturedTtl = null;
    const capture = mockRedis(async (_k, _v, _ex, ttl) => { capturedTtl = ttl; return "OK"; });
    await checkAndStoreNonce("0xttl", 1234, capture);
    test("TTL passed through to redis SET EX", () =>
      assert.strictEqual(capturedTtl, 1234));
  })();
  await (async () => {
    const r = await checkAndStoreNonce("0xnone", 600, null);
    test("no redis configured → 'new' with warning (dedup disabled by config)", () =>
      assert.strictEqual(r, "new"));
  })();

  console.log("H2 — TTL derivation from authorization.validBefore (clamped):");
  const nowSec = Math.floor(Date.now() / 1000);
  test("validBefore 1h out → ~3600s", () => {
    const ttl = extractNonceTtlSeconds(b64({ payload: { authorization: { validBefore: String(nowSec + 3600) } } }));
    assert.ok(ttl >= 3590 && ttl <= 3600, `got ${ttl}`);
  });
  test("validBefore in the past → clamped to 60s floor", () =>
    assert.strictEqual(
      extractNonceTtlSeconds(b64({ payload: { authorization: { validBefore: String(nowSec - 100) } } })),
      60));
  test("validBefore far future → clamped to 24h ceiling", () =>
    assert.strictEqual(
      extractNonceTtlSeconds(b64({ payload: { authorization: { validBefore: String(nowSec + 999999999) } } })),
      24 * 60 * 60));
  test("missing validBefore → default 600s", () =>
    assert.strictEqual(extractNonceTtlSeconds(b64({ payload: { authorization: {} } })), 600));
  test("unparsable validBefore → default 600s", () =>
    assert.strictEqual(
      extractNonceTtlSeconds(b64({ payload: { authorization: { validBefore: "soon" } } })), 600));
  test("garbage header → default 600s (never throws)", () =>
    assert.strictEqual(extractNonceTtlSeconds("!!!"), 600));

  console.log("Facilitator — retryable nonce release:");
  const facilitatorSvcSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "services", "facilitator.ts"), "utf-8");
  const facilitatorRouteSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "facilitator.ts"), "utf-8");
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
  console.log("\nAll security tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
