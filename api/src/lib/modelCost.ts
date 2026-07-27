/**
 * Per-model credit multipliers for AI tools (ai-generate, ai-oracle).
 *
 * The credit base cost for these tools was tuned around Claude Sonnet (the "smart"
 * / "standard" default), but callers can select far more expensive models (Opus,
 * gpt-4-turbo) at the SAME credit cost — a guaranteed loss on those calls. Example:
 * Opus output is $25/MTok vs Haiku $5/MTok (5×) and Sonnet $15/MTok, yet ai-generate
 * charged all three identically.
 *
 * Multiplier is anchored to Sonnet = 1.0 and derived from each model's real output
 * price (with headroom for input price), rounded up for margin. Sonnet-tier models
 * stay at 1.0, so the common path is UNCHANGED and only the expensive tiers cost more.
 * Pricing verified 2026-07-27 via the claude-api reference (Opus $5/$25, Sonnet $3/$15,
 * Haiku $1/$5 per MTok) and public OpenAI/Google/xAI rate cards.
 *
 * Pure module — no imports, no side effects (unit-tested directly).
 */
const MODEL_COST_MULTIPLIER: Record<string, number> = {
  // Claude
  "claude-opus-4-6": 2.0,
  "claude-sonnet-4-6": 1.0,
  "claude-haiku-4-5-20251001": 0.4,
  // OpenAI
  "gpt-4o": 0.8,
  "gpt-4o-mini": 0.3,
  "gpt-4-turbo": 2.0,
  "gpt-3.5-turbo": 0.3,
  // Google
  "gemini-2.0-flash": 0.3,
  "gemini-1.5-pro": 0.8,
  "gemini-1.5-flash": 0.3,
  // xAI
  "grok-3": 1.0,
  "grok-3-fast": 1.3,
  "grok-2": 0.8,
};

const FLOOR = 0.3; // cheap models still cover request overhead
const DEFAULT = 1.0; // unknown model → never undercharge

/** Credit multiplier for a model id. Unknown → 1.0; known → its tier (floored at 0.3). */
export function modelCostMultiplier(model: string | undefined): number {
  if (!model) return DEFAULT;
  const m = MODEL_COST_MULTIPLIER[model];
  if (m === undefined) return DEFAULT;
  return Math.max(FLOOR, m);
}

/** Apply the multiplier to a base credit cost. Always ≥ 1 credit. */
export function applyModelCost(baseCredits: number, model: string | undefined): number {
  return Math.max(1, Math.ceil(baseCredits * modelCostMultiplier(model)));
}
