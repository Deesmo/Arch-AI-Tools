// ─── Credit clawback math (pure, server-derived) ─────────────────────────────
// Used by the Stripe webhook when a charge is refunded or disputed: reverse the
// credits originally granted for that purchase. Two invariants:
//   1. FLOOR AT 0 — a balance can never go negative. If the agent already spent
//      more than they bought (mixed balances, prior packs), we can only claw
//      back what is actually there.
//   2. Never remove more than was granted for THIS charge — we take the min of
//      the originally-granted amount and the current balance.
// The originally-granted amount is read from the stored Purchase row, never from
// the event's client-influenceable fields (amount_refunded, metadata, etc.).

/**
 * How many credits to actually decrement for a reversal.
 * @param grantedCredits credits originally granted for the refunded/disputed purchase (from the stored Purchase)
 * @param currentBalance the agent's current credit balance
 * @returns a non-negative amount, never exceeding either input
 */
export function clawbackAmount(grantedCredits: number, currentBalance: number): number {
  const granted = Number.isFinite(grantedCredits) ? Math.trunc(grantedCredits) : 0;
  const balance = Number.isFinite(currentBalance) ? Math.trunc(currentBalance) : 0;
  if (granted <= 0 || balance <= 0) return 0;
  return Math.max(0, Math.min(granted, balance));
}
