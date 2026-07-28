/**
 * Hardening caps for expensive tools (2026-07-27 profitability/legal audit
 * follow-ups, implemented 2026-07-28).
 *
 * Pure, dependency-free helpers (mirrors lib/modelCost.ts) so tests can import
 * the compiled module directly. All caps are env-tunable; enforcement lives in
 * routes/tools/index.ts.
 */

// ─── video-generate hourly cap ────────────────────────────────────────────────
// Runway bills real money per generation; this bounds the abuse blast radius
// per identity (agent id for credit callers, payer wallet for x402 callers).
// In-memory + per-instance (resets hourly / on restart) — the same deliberate
// first-control tradeoff as EMAIL_RECIPIENT_DAILY_CAP (PR #76); a shared
// Redis-backed counter can replace it later.
export const VIDEO_HOURLY_CAP = Number.isFinite(Number(process.env.VIDEO_HOURLY_CAP))
  && Number(process.env.VIDEO_HOURLY_CAP) > 0
  ? Number(process.env.VIDEO_HOURLY_CAP)
  : 5;

const _videoCounts = new Map<string, number>();
let _videoHour = "";

/**
 * Returns true (and counts the attempt) if `identity` is under the hourly cap,
 * false when the cap is exhausted for the current UTC hour window.
 */
export function videoHourlyGate(identity: string, now: Date = new Date()): boolean {
  const hour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH — UTC hour bucket
  if (hour !== _videoHour) { _videoCounts.clear(); _videoHour = hour; }
  const used = _videoCounts.get(identity) || 0;
  if (used >= VIDEO_HOURLY_CAP) return false;
  _videoCounts.set(identity, used + 1);
  return true;
}

/**
 * Returns a slot taken by videoHourlyGate for the current window. Called when
 * a gated request fails before any Runway spend can occur (daily limit, credit
 * shortfall), so rejected attempts don't burn the hourly quota.
 */
export function releaseVideoHourlySlot(identity: string, now: Date = new Date()): void {
  const hour = now.toISOString().slice(0, 13);
  if (hour !== _videoHour) return;
  const used = _videoCounts.get(identity) || 0;
  if (used > 0) _videoCounts.set(identity, used - 1);
}

/** Test hook — clears the in-memory hourly window. */
export function _resetVideoHourlyGate(): void {
  _videoCounts.clear();
  _videoHour = "";
}

// ─── web-scrape Firecrawl fallback gate ──────────────────────────────────────
// The lightweight local scrape (cheerio) stays available to everyone. The
// Firecrawl fallback hits a paid vendor API per call, while the 5-credit price
// was set for the local path — so the PLATFORM key only backs callers who paid
// the higher x402 per-request price ($0.015, covers vendor cost per PR #73
// pricing); everyone else must bring their own key (BYOK, x-firecrawl-key).
export function firecrawlFallbackKey(opts: {
  byokKey?: string;
  x402Paid: boolean;
  platformKey?: string;
}): { key: string; byok: boolean } | null {
  const byok = opts.byokKey?.trim();
  if (byok) return { key: byok, byok: true };
  if (opts.x402Paid && opts.platformKey) return { key: opts.platformKey, byok: false };
  return null;
}

// ─── extract-pdf size caps ────────────────────────────────────────────────────
// extract-pdf sends the whole document to Anthropic (claude-sonnet-4-6) at a
// flat credit price, and Anthropic bills every PDF page as input tokens
// (~1,500–3,000 tokens/page; hard API limits are 32MB / 600 pages — source:
// https://platform.claude.com/docs/en/build-with-claude/pdf-support). Without
// a cap, a 1,000-page upload costs dollars of inference against a sub-cent
// price. The byte cap matches the pre-existing 5MB URL-download cap and now
// applies to base64 input too (which previously had NO size check at all).
export const EXTRACT_PDF_MAX_BYTES = Number.isFinite(Number(process.env.EXTRACT_PDF_MAX_BYTES))
  && Number(process.env.EXTRACT_PDF_MAX_BYTES) > 0
  ? Number(process.env.EXTRACT_PDF_MAX_BYTES)
  : 5 * 1024 * 1024;
export const EXTRACT_PDF_MAX_PAGES = Number.isFinite(Number(process.env.EXTRACT_PDF_MAX_PAGES))
  && Number(process.env.EXTRACT_PDF_MAX_PAGES) > 0
  ? Number(process.env.EXTRACT_PDF_MAX_PAGES)
  : 50;

/**
 * Dependency-free PDF page-count estimate.
 *
 * Primary signal: count of page objects ("/Type /Page" not followed by a
 * letter, so "/Pages" tree nodes don't match). PDFs with compressed object
 * streams can hide page objects from a raw scan, so when zero page objects are
 * visible we fall back to the largest "/Count N" value (the page-tree root's
 * total). We prefer the object count when present so outline "/Count" entries
 * cannot inflate the estimate into a false reject; the byte cap backstops
 * anything a compressed PDF hides from both signals.
 */
export function estimatePdfPageCount(buf: Buffer): number {
  const text = buf.toString("latin1");
  const pageObjects = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (pageObjects > 0) return pageObjects;
  let maxCount = 0;
  const countRe = /\/Count\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = countRe.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > maxCount) maxCount = n;
  }
  return maxCount;
}
