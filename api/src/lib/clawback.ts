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

/**
 * Cumulative credit target for a refund amount on one Stripe purchase.
 *
 * Stripe's `charge.refunded` event reports cumulative refunded cents for the
 * charge. A partial refund should claw back only the proportional share of the
 * credits, while a full refund reaches the whole original grant.
 */
export function proratedClawbackTarget(
  grantedCredits: number,
  purchaseAmountCents: number,
  refundedAmountCents: number,
): number {
  const granted = Number.isFinite(grantedCredits) ? Math.trunc(grantedCredits) : 0;
  const purchaseAmount = Number.isFinite(purchaseAmountCents) ? Math.trunc(purchaseAmountCents) : 0;
  const refundedAmount = Number.isFinite(refundedAmountCents) ? Math.trunc(refundedAmountCents) : 0;
  if (granted <= 0 || purchaseAmount <= 0 || refundedAmount <= 0) return 0;
  const cappedRefund = Math.min(refundedAmount, purchaseAmount);
  return Math.max(0, Math.min(granted, Math.ceil((granted * cappedRefund) / purchaseAmount)));
}

/**
 * The actual decrement to apply now, given a cumulative clawback target.
 */
export function clawbackDelta(
  targetCredits: number,
  alreadyClawedCredits: number,
  currentBalance: number,
): number {
  const target = Number.isFinite(targetCredits) ? Math.trunc(targetCredits) : 0;
  const already = Number.isFinite(alreadyClawedCredits) ? Math.trunc(alreadyClawedCredits) : 0;
  const balance = Number.isFinite(currentBalance) ? Math.trunc(currentBalance) : 0;
  if (target <= 0 || balance <= 0) return 0;
  return Math.max(0, Math.min(target - Math.max(0, already), balance));
}
