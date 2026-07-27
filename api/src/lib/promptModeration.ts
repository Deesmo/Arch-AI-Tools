/**
 * Prompt moderation for generative tools (image / video / design).
 *
 * First-layer, deny-by-pattern guard for the clearly illegal / abusive categories a
 * responsible platform must block BEFORE sending a prompt to OpenAI / Runway: child
 * sexual content, and non-consensual likenesses / deepfakes of real people. This is
 * defense-in-depth — the upstream providers run their own classifiers too — but it
 * lets us refuse (and log) the worst requests at our edge instead of relaying them.
 *
 * Deliberately narrow: it targets unambiguous abuse, not general adult/edgy content
 * (which the providers already refuse), to avoid over-blocking legitimate prompts.
 * Pure module — no imports, no side effects (unit-tested directly).
 */

// Terms indicating a minor.
const MINOR = /\b(child|children|kid|kids|toddler|infant|baby|minor|underage|under[-\s]?age|pre[-\s]?teen|preteen|prepubescent|schoolgirl|schoolboy|(?:\d{1,2})[-\s]?(?:year|yr)[-\s]?old|loli|shota)\b/i;
// Sexual/explicit terms.
const SEXUAL = /\b(nude|naked|nsfw|porn|pornographic|sexual|sexualized|sexualised|explicit|erotic|lewd|xxx|genital|nipple|cleavage|topless|bottomless|in\s+lingerie|undress(?:ed|ing)?)\b/i;
// Non-consensual likeness / deepfake signals.
const DEEPFAKE = /\b(deepfake|deep[-\s]?fake|face[-\s]?swap|faceswap|face[-\s]?morph|nudify|undress\s+(?:her|him|them|a\s+(?:photo|picture))|revenge\s+porn|non[-\s]?consensual)\b/i;
// "Real specific person" signals that, combined with sexual content, are non-consensual.
const REAL_PERSON = /\b(celebrity|celebrities|real\s+person|specific\s+person|public\s+figure|politician|president|actor|actress|singer|influencer|this\s+person|her\s+face|his\s+face|photo\s+of\s+a\s+real)\b/i;

export type ModerationResult = { allowed: boolean; category?: string; reason?: string };

/**
 * Returns { allowed:false, category, reason } to REFUSE a generative prompt, or
 * { allowed:true } to permit. Empty/non-string prompts are permitted here (the
 * route's own required-field check handles them).
 */
export function moderateGenerationPrompt(prompt: unknown): ModerationResult {
  if (typeof prompt !== "string" || !prompt.trim()) return { allowed: true };
  const p = prompt.toLowerCase();

  // 1) CSAM — minor + sexual context in the same prompt. Highest-priority refusal.
  if (MINOR.test(p) && SEXUAL.test(p)) {
    return { allowed: false, category: "csam", reason: "This request appears to involve sexual content depicting a minor and is refused. Such requests are reported." };
  }

  // 2) Explicit deepfake / non-consensual imagery signals.
  if (DEEPFAKE.test(p)) {
    return { allowed: false, category: "non_consensual_likeness", reason: "Requests for deepfakes, face-swaps, or non-consensual imagery of real people are not allowed." };
  }

  // 3) Sexual content of a real / specific / famous person → non-consensual likeness.
  if (SEXUAL.test(p) && REAL_PERSON.test(p)) {
    return { allowed: false, category: "non_consensual_likeness", reason: "Sexual or explicit imagery of real, specific, or public people is not allowed." };
  }

  return { allowed: true };
}
