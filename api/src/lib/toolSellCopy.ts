/**
 * Per-tool x402 sell copy — the human-readable descriptions that enter x402
 * payment metadata (402 accepts[].description, resource.description, and the
 * Bazaar discovery description).
 *
 * Source order (Play #6, council-modified):
 *   1. CURATED_SELL_COPY — hand-written one-line sell copy for the top tools
 *      by usage (checked into the repo, reviewed).
 *   2. Catalog descriptions registered at runtime — DB Tool.description
 *      (preferred) or the served OpenAPI summary (fallback) — ALWAYS sanitized
 *      at the insert boundary.
 *   3. A neutral per-tool fallback line.
 *
 * COUNCIL MOD (binding): anything DB-sourced is sanitized + length-capped
 * BEFORE it can enter payment metadata. Every string leaving this module is:
 *   - ASCII-safe (printable ASCII only, common Unicode transliterated)
 *   - <= SELL_COPY_MAX_CHARS (200) characters
 *   - stripped of internal implementation details (env-var names,
 *     "requires FOO_API_KEY", etc.)
 *
 * Pure module — no I/O, no side effects beyond its own registries (unit-tested
 * from dist, same pattern as lib/x402V2.ts).
 */

export const SELL_COPY_MAX_CHARS = 200;

/**
 * Curated one-line sell copy for the top tools by usage.
 * RULES for entries: plain ASCII, factual, no internals, no superlatives that
 * can't be defended, and short enough that a rail suffix still fits (<=170).
 */
const CURATED_SELL_COPY: Record<string, string> = {
  "barcode-generate":
    "Generate Code128, EAN-13, UPC-A and Code39 barcodes as crisp SVGs in one POST. Ready for inventory, shipping and retail agents.",
  "generate-hash":
    "Compute SHA-256, SHA-512, SHA-1 or MD5 hashes for any text in milliseconds. Checksums, signatures and dedup for agent pipelines.",
  "crypto-price":
    "Real-time price, 24h change, market cap and volume for any cryptocurrency. One POST, sub-second answers for trading agents.",
  "generate-uuid":
    "Generate UUIDs (v1/v4), secure random tokens and API-key-format strings on demand. Unique IDs for agent workflows in one call.",
  "ai-generate":
    "AI text generation via Claude. Prompt in, polished text out - drafting, rewriting, extraction and reasoning for agents.",
  "qr-code":
    "Generate QR codes from any text or URL as PNG or SVG in one POST. Instant scannable output for links, tickets and payments.",
  "web-scrape":
    "Scrape any public URL into clean markdown, HTML or text, with optional CSS selector targeting. No headless browser to run.",
  "webhook-send":
    "POST any JSON payload to any webhook URL with custom headers and method. Let your agent trigger downstream systems in one call.",
  "ocr-extract":
    "Extract text from images and screenshots with AI vision. Send a URL or base64 image, get accurate text back in seconds.",
  "email-find":
    "Find a person's business email from their name and company domain. Verified address patterns for outreach and enrichment agents.",
  "search-web":
    "Web search with structured results - title, URL and snippet - ready for agent consumption. Fresh results in one POST.",
  "sentiment-analysis":
    "Classify text as positive, negative or neutral with scores and emotion detection. Instant NLP for reviews, support and social.",
  "transcribe-audio":
    "Transcribe audio to text in 100+ languages via Whisper. Send a file URL, get an accurate transcript back in one call.",
  "video-generate":
    "Generate short video clips from a text prompt. Describe the scene, get a rendered clip back - no video pipeline required.",
  "design-create":
    "Generate high-quality images and designs from a text prompt via DALL-E 3. Multiple sizes, standard or HD, in one call.",
};

// Common Unicode -> ASCII transliterations (applied before the ASCII filter so
// meaning survives: em dashes become hyphens instead of vanishing).
const TRANSLITERATIONS: Array<[RegExp, string]> = [
  [/[—–‒―]/g, " - "], // em/en/figure/horizontal-bar dashes
  [/[‘’‚′]/g, "'"], // curly single quotes / prime
  [/[“”„″]/g, '"'], // curly double quotes
  [/…/g, "..."], // ellipsis
  [/[×✕✖]/g, "x"], // multiplication signs
  [/→/g, "->"], // right arrow
  [/[·•]/g, "-"], // middle dot / bullet
];

// Env-var-shaped token: SCREAMING_SNAKE with at least one underscore
// (ANTHROPIC_API_KEY, PDF_EXTRACTOR_URL, TAVILY_API_KEY, ...).
const ENV_VAR_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Trim to `max` chars on a word boundary, appending "..." when truncated. */
function capLength(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, Math.max(1, max - 3)).trimEnd();
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.6) cut = cut.slice(0, lastSpace).trimEnd();
  // Don't end mid-punctuation
  cut = cut.replace(/[\s,;:\-(]+$/g, "");
  return cut + "...";
}

/**
 * Sanitize free text (DB/spec-sourced) for use in payment metadata:
 * strip internals, transliterate Unicode, force printable ASCII, tidy
 * whitespace/punctuation, cap at SELL_COPY_MAX_CHARS.
 * Returns null when nothing usable survives.
 */
export function sanitizeSellCopy(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw;

  // 1. Strip parenthesized internal notes: "(requires ANTHROPIC_API_KEY)",
  //    "(needs X)", "(uses Y)", "(set FOO)".
  s = s.replace(/\s*\((?:requires|needs|uses|set|configure)\b[^)]*\)/gi, "");
  // 2. Strip non-parenthesized "requires FOO_BAR ..." clauses up to the next
  //    sentence/clause boundary (case-insensitive: "Requires X" starts sentences).
  s = s.replace(/\s*[-,;:]?\s*\b(?:requires|needs)\s+(?:an?\s+|the\s+)?[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+[^.;,]*/gi, "");
  // 3. Strip any remaining env-var-shaped token outright.
  s = s.replace(ENV_VAR_TOKEN, "");

  // 4. Transliterate common Unicode, then hard-filter to printable ASCII.
  for (const [re, sub] of TRANSLITERATIONS) s = s.replace(re, sub);
  s = s.replace(/[^\x20-\x7E]/g, "");

  // 5. Tidy: drop empty parens, collapse whitespace, fix space-before-punct,
  //    trim stray leading/trailing separators.
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\s{2,}/g, " ");
  s = s.replace(/\s+([,.;:!?)])/g, "$1");
  s = s.replace(/([,;:]){2,}/g, "$1");
  // Period runs: ".." (leftover from clause-stripping) collapses to "."; a real
  // ellipsis "..." survives; 4+ periods normalize to "...".
  s = s.replace(/\.{4,}/g, "...");
  s = s.replace(/(?<!\.)\.\.(?!\.)/g, ".");
  s = s.trim().replace(/^[-,.;:\s]+/, "").replace(/[\s,;:-]+$/, "");

  if (s.length === 0) return null;
  return capLength(s, SELL_COPY_MAX_CHARS);
}

// ── Runtime registries ───────────────────────────────────────────────────────
// db: Tool.description rows (loaded fail-soft at server startup — see x402.ts)
// spec: openapi.json summaries (registered by bazaarDiscovery at import time)
const dbCopy = new Map<string, string>();
const specCopy = new Map<string, string>();

/**
 * Register a catalog description for a tool. `source` selects priority:
 * "db" (Tool.description, wins) or "spec" (openapi summary, fallback).
 * Sanitization happens HERE, at the insert boundary — unsanitizable or empty
 * input is refused, never stored.
 */
export function registerToolSellCopy(toolName: string, rawDescription: unknown, source: "db" | "spec" = "db"): boolean {
  if (typeof toolName !== "string" || toolName.length === 0) return false;
  const clean = sanitizeSellCopy(rawDescription);
  if (!clean) return false;
  (source === "db" ? dbCopy : specCopy).set(toolName, clean);
  return true;
}

/**
 * Registered sell copy only — curated -> DB (sanitized) -> spec (sanitized) —
 * with NO neutral fallback (used by bazaarDiscovery, which has its own).
 */
export function getRegisteredSellCopy(toolName: string): string | null {
  const copy = CURATED_SELL_COPY[toolName] ?? dbCopy.get(toolName) ?? specCopy.get(toolName);
  return copy !== undefined ? capLength(copy, SELL_COPY_MAX_CHARS) : null;
}

/**
 * The per-tool sell copy: curated -> DB (sanitized) -> spec (sanitized) ->
 * neutral fallback. Always ASCII, always <= SELL_COPY_MAX_CHARS.
 */
export function getToolSellCopy(toolName: string): string {
  const copy =
    getRegisteredSellCopy(toolName) ??
    `Arch Tools ${toolName} API. Pay per call with USDC (x402) or credits.`;
  return capLength(copy, SELL_COPY_MAX_CHARS);
}

/**
 * accepts[].description for one payment rail: per-tool sell copy plus the
 * rail qualifier, jointly capped at SELL_COPY_MAX_CHARS.
 */
export function railDescription(toolName: string, rail: string): string {
  const suffix = ` (${rail})`;
  const base = capLength(getToolSellCopy(toolName), SELL_COPY_MAX_CHARS - suffix.length);
  return base + suffix;
}
