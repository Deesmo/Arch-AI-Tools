/**
 * x402 USDC → credits top-up — tier math + idempotent grant core (GROWTH_50 #8).
 *
 * Pure/dependency-free by design — unit-tested from dist without a DB (same
 * pattern as lib/x402V1.ts / lib/x402V2.ts). The route (routes/topupX402.ts)
 * injects the real Prisma calls through TopupGrantDeps.
 *
 * RATE AUTHORITY: the one-time CREDIT_PACKS catalog in routes/billing.ts —
 * the route passes it in; this module never declares its own pack economics.
 * Pack-equivalent fairness rule:
 *   - A top-up gets the CHEAPEST per-credit rate among packs priced at or
 *     under the top-up amount (the best deal the same money buys today).
 *   - A top-up below every pack price gets the WORST pack rate (starter:
 *     $9 / 3,000 credits = $0.003/credit) — never a better rate than the
 *     best pack, never a worse rate than the smallest pack.
 *   - Integer math with ceil ROUNDED IN THE BUYER'S FAVOR (≤1 extra credit,
 *     ≤$0.003) so the effective rate is never worse than the promised pack
 *     rate ("$0.003/credit or cheaper").
 */

export interface PackRateSource {
  /** Credits granted by the pack. */
  credits: number;
  /** Pack price in USD cents (routes/billing.ts CREDIT_PACKS `amount`). */
  amount: number;
}

export interface TopupTier {
  /** Path segment: POST /v1/billing/topup-x402/:tier */
  id: string;
  /** x402 USD price string (same decimal format as X402_PRICES values). */
  usd: string;
  /** Top-up price in USD cents. */
  amountCents: number;
  /** Credits granted when the x402 payment settles. */
  credits: number;
}

/** Fixed top-up price points in USD cents: $5 / $20 / $50. */
export const TOPUP_TIER_CENTS: readonly number[] = [500, 2000, 5000];

/** x402 "tool" name for a tier's payment gate + X402Payment/ApiRequest rows.
 *  Deliberately NOT in X402_PRICES (the price rides in as a middleware option),
 *  so the advertised-tool price map check-price-drift.mjs anchors on is untouched. */
export function topupToolName(tierId: string): string {
  return `credits-topup-${tierId}`;
}

/**
 * Credits for a top-up of `amountCents`, derived from the pack catalog.
 * ceil(amountCents * credits / amount) per pack — integer-exact, rounded in
 * the buyer's favor by at most one credit.
 */
export function creditsForTopupCents(amountCents: number, packs: readonly PackRateSource[]): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  const valid = packs.filter(
    (p) => Number.isFinite(p.amount) && p.amount > 0 && Number.isFinite(p.credits) && p.credits > 0,
  );
  if (valid.length === 0) return 0;
  const creditsAt = (p: PackRateSource): number => Math.ceil((amountCents * p.credits) / p.amount);
  const eligible = valid.filter((p) => p.amount <= amountCents);
  return eligible.length > 0
    ? Math.max(...eligible.map(creditsAt)) // best rate among packs the same money buys
    : Math.min(...valid.map(creditsAt)); // below every pack price → worst pack rate
}

/** Build the fixed tier catalog from the pack authority. */
export function buildTopupTiers(packs: readonly PackRateSource[]): TopupTier[] {
  return TOPUP_TIER_CENTS.map((cents) => ({
    id: String(cents / 100),
    usd: (cents / 100).toFixed(3),
    amountCents: cents,
    credits: creditsForTopupCents(cents, packs),
  }));
}

// ─── Idempotent grant core ───────────────────────────────────────────────────

export interface TopupGrantDeps {
  /** Look up a prior grant by its dedupe id (Purchase.stripeId). Null when none. */
  findPurchase(dedupeId: string): Promise<{ agentId: string; credits: number } | null>;
  /**
   * Create the payment record AND increment the agent's credits in ONE atomic
   * transaction. MUST fail (throw) on a duplicate dedupe id — Purchase.stripeId
   * is unique, which is what makes the grant idempotent under races.
   */
  createPurchaseAndCredit(args: {
    agentId: string;
    dedupeId: string;
    credits: number;
    amountCents: number;
  }): Promise<{ balance: number }>;
}

export type TopupGrantResult =
  | { status: "granted"; creditsAdded: number; balance: number }
  | { status: "already_credited"; creditsAdded: 0 }
  | { status: "conflict" } // same settlement id credited to a DIFFERENT agent — never expected
  | { status: "failed"; reason: string };

/**
 * Grant credits for ONE settled x402 payment — exactly once per settlement.
 * Dedupe key = the settlement id (tx hash / EIP-3009 nonce), mirroring how the
 * Stripe webhook dedupes on Purchase.stripeId. Safe under concurrent replays:
 * the unique-constraint loser re-reads and reports already_credited instead of
 * double-crediting.
 */
export async function grantTopupCredits(
  deps: TopupGrantDeps,
  agentId: string,
  tier: Pick<TopupTier, "credits" | "amountCents">,
  dedupeId: string,
): Promise<TopupGrantResult> {
  // Cheap idempotency answer for clean replays (same pattern as the webhook's
  // findUnique-first); the unique constraint below covers the race window.
  const existing = await deps.findPurchase(dedupeId).catch(() => null);
  if (existing) {
    return existing.agentId === agentId
      ? { status: "already_credited", creditsAdded: 0 }
      : { status: "conflict" };
  }
  try {
    const { balance } = await deps.createPurchaseAndCredit({
      agentId,
      dedupeId,
      credits: tier.credits,
      amountCents: tier.amountCents,
    });
    return { status: "granted", creditsAdded: tier.credits, balance };
  } catch (e) {
    // Lost a race on the unique dedupe id? Then the other insert credited it —
    // idempotent success, NOT an error. Anything else is a real failure.
    const raced = await deps.findPurchase(dedupeId).catch(() => null);
    if (raced) {
      return raced.agentId === agentId
        ? { status: "already_credited", creditsAdded: 0 }
        : { status: "conflict" };
    }
    return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}
