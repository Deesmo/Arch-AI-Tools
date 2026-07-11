export type AccountTier = "free" | "starter" | "pro" | "growth" | "business";
export type EnforcementTier = "free" | "pro" | "business";

const ACCOUNT_TIERS = new Set<AccountTier>(["free", "starter", "pro", "growth", "business"]);

export function tierFromSubscriptionPlanId(planId: string | null | undefined): AccountTier {
  const tier = String(planId ?? "")
    .toLowerCase()
    .trim()
    .replace(/-(?:monthly|annual)$/, "");

  return ACCOUNT_TIERS.has(tier as AccountTier) ? tier as AccountTier : "free";
}

export function enforcementTierForAccount(tier: string | null | undefined): EnforcementTier {
  switch (String(tier ?? "free").toLowerCase().trim()) {
    case "business":
      return "business";
    case "starter":
    case "pro":
    case "growth":
      return "pro";
    default:
      return "free";
  }
}
