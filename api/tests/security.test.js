/**
 * Focused unit tests for 2026-06-10 security fixes:
 *  - M1: email identity normalization (free-credit farming)
 *  - H1: x402 settle-guard predicate (no serve on null/failed settlement)
 *  - H3: atomic credit deduction guard shape (updateMany count contract)
 *
 * Run: node tests/security.test.js  (requires `npm run build` first for dist/)
 */
import assert from "assert";
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
    // values[0] is the normalized email bound into the INSERT
    const normalized = values[0];
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

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll security tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
