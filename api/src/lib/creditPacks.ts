/**
 * creditPacks — the one-time pack catalog for RECOMMENDATION surfaces only
 * (402 bodies, X-Upgrade-URL, alert emails, pricing-page preselect links).
 *
 * Deliberately NOT the checkout source of truth: routes/billing.ts keeps its
 * own CREDIT_PACKS (with Stripe price IDs) and stays untouched — no payment-
 * rail logic lives here. These ids/sizes/prices mirror that catalog and the
 * public pricing page; if a pack ever changes, update both (the intent-funnel
 * test pins the sizes so drift fails loud).
 */

export interface PackInfo {
  id: "starter" | "pro" | "business";
  credits: number;
  priceUsd: number;
}

export const RECOMMENDABLE_PACKS: readonly PackInfo[] = [
  { id: "starter", credits: 3000, priceUsd: 9 },
  { id: "pro", credits: 25000, priceUsd: 49 },
  { id: "business", credits: 125000, priceUsd: 199 },
];

/**
 * Smallest pack whose size covers `creditsNeeded`; the largest pack when the
 * need exceeds every pack. Non-finite/negative input degrades to the smallest
 * pack (never throws — this runs on the 402 hot path).
 */
export function recommendPack(creditsNeeded: number): PackInfo {
  const n = Number.isFinite(creditsNeeded) ? Math.max(0, creditsNeeded) : 0;
  return (
    RECOMMENDABLE_PACKS.find((p) => p.credits >= n) ??
    RECOMMENDABLE_PACKS[RECOMMENDABLE_PACKS.length - 1]
  );
}

/**
 * Pre-selected pricing-page URL for a pack. The pricing page reads ?pack= and
 * only highlights/scrolls — checkout NEVER auto-fires from a GET (explicit
 * click required; council-binding constraint).
 */
export function packUrl(id: PackInfo["id"]): string {
  return `https://archtools.dev/pricing?pack=${id}`;
}
