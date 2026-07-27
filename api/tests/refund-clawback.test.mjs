/**
 * Unit test — credit clawback math + idempotency (2026-07-26 billing hardening).
 *
 * Covers the security fix: a customer must not be able to buy a pack, spend the
 * credits, then refund/chargeback and keep the value. Verifies the pure
 * clawbackAmount helper (floor at 0, never over-decrement) and that a redelivered
 * refund/dispute event (same event id) results in a SINGLE decrement.
 *
 * Run: node api/tests/refund-clawback.test.mjs   (after npm run build)
 */
process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";

const { clawbackAmount } = await import("../dist/lib/clawback.js");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

console.log("clawbackAmount — pure math:");
// Normal case: full balance present, claw back exactly what was granted.
assert(clawbackAmount(3000, 3000) === 3000, "full balance → claw back the full grant");
// Spent-most case: agent granted 3000 but already spent down to 500 → floor at balance.
assert(clawbackAmount(3000, 500) === 500, "already spent → claw back only what's left (floor at balance)");
// Spent-all case: nothing left → claw back 0 (never negative).
assert(clawbackAmount(3000, 0) === 0, "zero balance → claw back 0 (never negative)");
// Extra balance (bought other packs): never remove more than THIS grant.
assert(clawbackAmount(3000, 10000) === 3000, "big balance → never remove more than the granted amount");
// Defensive: negative / NaN inputs floor to 0.
assert(clawbackAmount(-5, 100) === 0, "negative grant → 0");
assert(clawbackAmount(100, -5) === 0, "negative balance → 0");
assert(clawbackAmount(NaN, 100) === 0, "NaN grant → 0");
assert(clawbackAmount(100, NaN) === 0, "NaN balance → 0");
// Fractional inputs are truncated (credits are integers).
assert(clawbackAmount(100.9, 50.9) === 50, "fractional inputs truncated to integer credits");

console.log("\nIdempotency — redelivered event = single decrement:");
// Simulate the guard-table + $transaction logic the webhook runs. The DB UNIQUE
// on Clawback.event_id makes the second delivery lose the INSERT (0 rows) → the
// decrement is skipped. We model that here with an in-memory guard set.
function simulateReversal(state, eventId, grantedCredits) {
  // guard: INSERT ... ON CONFLICT DO NOTHING → 1 if new, 0 if duplicate
  const inserted = state.guard.has(eventId) ? 0 : 1;
  if (inserted === 0) return { clawed: 0, already: true };
  state.guard.add(eventId);
  const toClaw = clawbackAmount(grantedCredits, state.balance);
  state.balance -= toClaw;
  return { clawed: toClaw, already: false };
}

const state = { balance: 3000, guard: new Set() };
const first = simulateReversal(state, "re_ABC123", 3000);
assert(first.clawed === 3000 && !first.already, "first delivery claws back 3000");
assert(state.balance === 0, "balance is 0 after first clawback");

const second = simulateReversal(state, "re_ABC123", 3000); // redelivered, same id
assert(second.clawed === 0 && second.already, "redelivered event is a no-op (already processed)");
assert(state.balance === 0, "balance still 0 — NO double-decrement (never negative)");

// A DIFFERENT reversal id on a fresh purchase decrements independently.
const state2 = { balance: 25000, guard: new Set() };
simulateReversal(state2, "dp_first", 25000);
assert(state2.balance === 0, "distinct reversal id decrements its own grant");
const dupDispute = simulateReversal(state2, "dp_first", 25000);
assert(dupDispute.already && state2.balance === 0, "same dispute id redelivered = single decrement");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
