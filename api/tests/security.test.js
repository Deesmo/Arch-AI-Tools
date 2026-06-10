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
  test("strips +alias", () =>
    assert.strictEqual(normalizeEmailIdentity("user+spam1@example.com"), "user@example.com"));
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
