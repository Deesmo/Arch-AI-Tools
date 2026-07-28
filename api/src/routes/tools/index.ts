import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, AuthedRequest } from "../../middleware/auth.js";
import { x402Middleware, X402_PRICES, isX402AnonymousTool, buildPaymentRequiredV2 } from "../../middleware/x402.js";
import { deductCredits, reqId, safeErr, waiveCharge } from "../../utils/credits.js";
import { getCached, setCached } from "../../lib/lru.js";
import { config } from "../../config.js";
import { validateUrl, safeAxiosGet, safeFetch, safeAxiosRequest } from "../../lib/ssrf.js";
import { prisma } from "../../lib/prisma.js";
import { applyModelCost, modelCostMultiplier } from "../../lib/modelCost.js";
import { moderateGenerationPrompt } from "../../lib/promptModeration.js";
import { readArrayBufferWithLimit, ResponseTooLargeError } from "../../utils/responseBody.js";
import { enforcementTierForAccount } from "../../lib/tiers.js";
import {
  VIDEO_HOURLY_CAP, videoHourlyGate, releaseVideoHourlySlot,
  firecrawlFallbackKey,
  EXTRACT_PDF_MAX_BYTES, EXTRACT_PDF_MAX_PAGES, estimatePdfPageCount,
} from "../../lib/toolLimits.js";
import crypto from "crypto";
import { v1 as uuidv1, v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";

const router = Router();

// Escape user-supplied text before embedding it in generated SVG/XML so it
// cannot break out of a text node and inject markup/script (XSS when the SVG
// is later rendered as HTML by a consumer).
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Strip active content from model-generated SVG before returning it. Removes
// <script>/<foreignObject>, inline event handlers, and javascript: URLs.
function sanitizeSvg(svg: string): string {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:xlink:href|href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "");
}

// Lazy Anthropic client: re-checks env at call time so a key set AFTER boot
// (e.g. Render env var update) becomes usable without redeploy.
let _anthropicInstance: Anthropic | null = null;
let _anthropicLastKey: string | undefined = undefined;
function getAnthropic(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith("ENTER")) {
    _anthropicInstance = null;
    _anthropicLastKey = key;
    return null;
  }
  if (_anthropicInstance && _anthropicLastKey === key) return _anthropicInstance;
  _anthropicInstance = new Anthropic({ apiKey: key });
  _anthropicLastKey = key;
  return _anthropicInstance;
}
// Runtime-only access via getAnthropic(); do not capture the client at module load.

// ─── Per-key rate limiter (runs AFTER auth so we know the tier) ───────────────
const requestCounts = new Map<string, { count: number; resetAt: number }>();

// Clean up expired rate limit entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetAt) requestCounts.delete(key);
  }
}, 5 * 60 * 1000);

function tierRateLimiter(req: AuthedRequest, res: Response, next: NextFunction): void {
  const agent = req.agent;
  const key = agent?.apiKey?.slice(0, 20) ?? req.ip ?? "anon";
  const tier = enforcementTierForAccount(agent?.tier);
  const limit = tier === "business" ? config.rateLimits.business
              : tier === "pro" ? config.rateLimits.pro
              : config.rateLimits.free;

  const now = Date.now();
  const record = requestCounts.get(key);

  if (!record || now > record.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }

  record.count++;
  if (record.count > limit) {
    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000).toString());
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      message: `Rate limit of ${limit} req/min exceeded for ${agent?.tier ?? "free"} tier. Upgrade at archtools.dev.`,
      request_id: reqId(),
    });
    return;
  }

  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", limit - record.count);
  next();
}

// ─── Helper: combined x402 + auth + rate limit middleware ────────────────────

// Enforce OAuth scope on tool execution. x402-paid requests carry no agent
// (allowed) and API-key auth carries no scope restriction (allowed). Only OAuth
// access tokens have a scope — executing a tool requires `tools:execute`.
function requireExecuteScope(req: AuthedRequest, res: Response, next: NextFunction): void {
  const scope = req.agent?.scope;
  if (scope !== undefined && !scope.split(/\s+/).includes("tools:execute")) {
    res.status(403).json({
      ok: false,
      error: "insufficient_scope",
      message: "This OAuth token is not authorized to execute tools (missing tools:execute scope).",
      request_id: reqId(),
    });
    return;
  }
  next();
}

function toolMiddleware(toolName: string) {
  return [x402Middleware(toolName), requireAuth, requireExecuteScope, tierRateLimiter];
}

function isX402Paid(req: Request): boolean {
  return !!(req as Request & { x402Paid?: boolean }).x402Paid;
}

// ─── email recipient anti-abuse (CAN-SPAM) ───────────────────────────────────
// Per-recipient daily send cap, independent of the per-agent limit, so one address
// can't be spammed via many accounts. In-memory + per-instance (resets daily / on
// restart) — a deliberate first control; a shared Redis-backed counter can replace it.
export const EMAIL_RECIPIENT_DAILY_CAP = Number(process.env.EMAIL_RECIPIENT_DAILY_CAP || 10);
const _emailRecipCounts = new Map<string, number>();
let _emailRecipDay = "";
function recipientHash(recipient: string): string {
  return crypto.createHash("sha256").update(recipient).digest("hex").slice(0, 16);
}
function emailRecipientGate(recipient: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _emailRecipDay) { _emailRecipCounts.clear(); _emailRecipDay = today; }
  const key = recipientHash(recipient);
  const used = _emailRecipCounts.get(key) || 0;
  if (used >= EMAIL_RECIPIENT_DAILY_CAP) return false;
  _emailRecipCounts.set(key, used + 1);
  return true;
}

function normalizeCdpTokenId(tokenId: unknown): string | null {
  if (tokenId === null || tokenId === undefined) return null;
  const cleaned = String(tokenId).trim();
  // ERC-721/1155 token IDs are uint256 values. Keep this path segment numeric
  // before signing the CDP request so callers cannot alter the upstream route.
  if (!/^[0-9]{1,78}$/.test(cleaned)) return null;
  return cleaned;
}

const MAX_TRANSCRIBE_AUDIO_BYTES = Number.isFinite(Number(process.env.TRANSCRIBE_MAX_AUDIO_BYTES))
  && Number(process.env.TRANSCRIBE_MAX_AUDIO_BYTES) > 0
  ? Number(process.env.TRANSCRIBE_MAX_AUDIO_BYTES)
  : 25 * 1024 * 1024;

// ─── BYOK discount: tools called with user-provided provider keys charge 20% ───
const BYOK_HEADER_NAMES = [
  "x-anthropic-key", "x-openai-key", "x-xai-key", "x-google-key",
  "x-firecrawl-key", "x-brave-key", "x-tavily-key", "x-exa-key",
  "x-elevenlabs-key", "x-removebg-key", "x-runway-key",
];
function hasByokKeys(req: Request, headerNames: readonly string[] = BYOK_HEADER_NAMES): boolean {
  return headerNames.some((h) => {
    const value = req.headers[h];
    return typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) && value.some((v) => v.trim().length > 0);
  });
}
function byokAdjustedCost(req: Request, cost: number, headerNames: readonly string[] = BYOK_HEADER_NAMES): number {
  return hasByokKeys(req, headerNames) ? Math.max(1, Math.ceil(cost * 0.2)) : cost;
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

const BLOCKED_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-admin-key",
  "x-auth-token",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

function sanitizeWebhookHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input ?? {})) {
    const name = rawName.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (BLOCKED_FORWARD_HEADERS.has(lower)) continue;
    if (!/^[a-z0-9-]{1,64}$/i.test(name)) continue;
    safe[name] = String(rawValue).slice(0, 500);
  }
  return safe;
}

function getDefaultSender(): string {
  return process.env.EMAIL_FROM?.trim() || "Arch Tools <no-reply@archtools.dev>";
}

function sanitizeOutboundEmailHtml(html: string | undefined, body: string | undefined): { htmlBody: string; textBody: string } {
  const rawHtml = (html ?? "").slice(0, 20_000);
  const rawBody = (body ?? "").slice(0, 10_000);
  const escapedBody = rawBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const htmlBody = rawHtml
    ? rawHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "")
    : `<p>${escapedBody}</p>`;
  const textBody = rawBody || rawHtml.replace(/<[^>]+>/g, "").slice(0, 10_000);
  return { htmlBody, textBody };
}

const SIDE_EFFECT_DAILY_LIMITS: Record<string, { free: number; pro: number; starter: number; business: number }> = {
  "webhook-send": { free: 10, pro: 50, starter: 50, business: 200 },
  "email-send": { free: 5, pro: 25, starter: 25, business: 100 },
  "send-email": { free: 5, pro: 25, starter: 25, business: 100 },
  "video-generate": { free: 3, pro: 20, starter: 20, business: 100 },
};

async function enforceDailyToolLimit(req: AuthedRequest, res: Response, toolName: string): Promise<boolean> {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
    return false;
  }

  const limitConfig = SIDE_EFFECT_DAILY_LIMITS[toolName];
  if (!limitConfig) return true;

  const tier = enforcementTierForAccount(agent.tier);
  const limit = tier === "business" ? limitConfig.business
    : tier === "pro" ? limitConfig.pro
    : limitConfig.free;
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  let count: number;
  try {
    count = await prisma.apiRequest.count({
      where: {
        agentId: agent.id,
        toolName,
        createdAt: { gte: since },
        status: "SUCCESS",
      },
    });
  } catch (err) {
    console.error(`[tools] Daily limit check failed for ${toolName}:`, err);
    res.status(503).json({
      ok: false,
      error: "limit_check_unavailable",
      message: `Unable to verify the daily limit for ${toolName}. Try again shortly.`,
      request_id: reqId(),
    });
    return false;
  }

  if (count >= limit) {
    res.status(429).json({
      ok: false,
      error: "daily_limit_reached",
      message: `Daily limit reached for ${toolName}. ${agent.tier} tier allows ${limit} successful calls per day.`,
      request_id: reqId(),
    });
    return false;
  }

  return true;
}

// ─── 1. VALIDATE-DATA ────────────────────────────────────────────────────────

router.post("/validate-data", ...toolMiddleware("validate-data"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "validate-data", 1);
    if (!ok) return;
  }
  const { data, schema } = req.body as { data?: unknown; schema?: Record<string, unknown> };
  if (data === undefined || !schema) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "data and schema are required", request_id: reqId() });
    return;
  }
  try {
    // Simple JSON Schema validation (type checking)
    const errors: string[] = [];
    function validate(val: unknown, sc: Record<string, unknown>, path: string): void {
      const t = sc["type"];
      if (t === "object" && (typeof val !== "object" || val === null || Array.isArray(val))) {
        errors.push(`${path}: expected object`);
        return;
      }
      if (t === "array" && !Array.isArray(val)) { errors.push(`${path}: expected array`); return; }
      if (t === "string" && typeof val !== "string") { errors.push(`${path}: expected string`); return; }
      if (t === "number" && typeof val !== "number") { errors.push(`${path}: expected number`); return; }
      if (t === "boolean" && typeof val !== "boolean") { errors.push(`${path}: expected boolean`); return; }
      const required = sc["required"] as string[] | undefined;
      const properties = sc["properties"] as Record<string, Record<string, unknown>> | undefined;
      if (required && typeof val === "object" && val !== null) {
        for (const r of required) {
          if (!(r in (val as Record<string, unknown>))) errors.push(`${path}.${r}: required field missing`);
        }
      }
      if (properties && typeof val === "object" && val !== null) {
        for (const [k, subSchema] of Object.entries(properties)) {
          if (k in (val as Record<string, unknown>)) {
            validate((val as Record<string, unknown>)[k], subSchema, `${path}.${k}`);
          }
        }
      }
    }
    validate(data, schema, "$");
    res.json({ ok: true, valid: errors.length === 0, errors, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "validation_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 2. GENERATE-HASH ────────────────────────────────────────────────────────

router.post("/generate-hash", ...toolMiddleware("generate-hash"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "generate-hash", 1);
    if (!ok) return;
  }
  const { text, algorithm = "sha256", encoding = "hex" } = req.body as { text?: string; algorithm?: string; encoding?: string };
  if (!text || typeof text !== "string") { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required and must be a string", request_id: reqId() }); return; }
  const algos = ["sha256", "sha512", "sha1", "md5", "sha384"];
  if (!algos.includes(algorithm)) { res.status(400).json({ ok: false, error: "invalid_request", message: `algorithm must be one of: ${algos.join(", ")}`, request_id: reqId() }); return; }
  const enc: "hex" | "base64" = (encoding === "base64" ? "base64" : "hex");
  const hash = crypto.createHash(algorithm).update(text, "utf8").digest(enc);
  res.json({ ok: true, hash, algorithm, encoding: enc, length: hash.length, input_length: text.length, request_id: reqId() });
});

// ─── 3. QR-CODE ──────────────────────────────────────────────────────────────

router.post("/qr-code", ...toolMiddleware("qr-code"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "qr-code", 2);
    if (!ok) return;
  }
  const { format = "png", size = 256, error_correction = "M" } = req.body as { format?: string; size?: number; error_correction?: string };
  const text = (req.body.text ?? req.body.content) as string | undefined; // accept documented alias `content`
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text (or content) is required", request_id: reqId() }); return; }
  try {
    const QRCode = await import("qrcode");
    const ecl = (["L","M","Q","H"].includes(error_correction ?? "M") ? error_correction : "M") as "L"|"M"|"Q"|"H";
    if (format === "svg") {
      const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: ecl });
      res.json({ ok: true, format: "svg", data: svg, request_id: reqId() });
    } else {
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: ecl, width: Math.min(Math.max(size, 64), 1024) });
      res.json({ ok: true, format: "png", data: dataUrl, request_id: reqId() });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: "qr_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 4. CONVERT-FORMAT ───────────────────────────────────────────────────────

router.post("/convert-format", ...toolMiddleware("convert-format"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "convert-format", 2);
    if (!ok) return;
  }
  const input = req.body.data ?? req.body.input ?? req.body.content;
  const { from, to } = req.body as { from?: string; to?: string };
  if (!input || !from || !to) { res.status(400).json({ ok: false, error: "invalid_request", message: "input (or data/content), from, and to are required", request_id: reqId() }); return; }
  try {
    const yaml = await import("js-yaml");
    let parsed: unknown;
    // text ↔ base64 shortcut (no structured parse needed)
    if (from === "text" || from === "string") {
      if (to === "base64") { res.json({ ok: true, output: Buffer.from(input, "utf8").toString("base64"), from, to, request_id: reqId() }); return; }
      if (to === "hex") { res.json({ ok: true, output: Buffer.from(input, "utf8").toString("hex"), from, to, request_id: reqId() }); return; }
      res.status(400).json({ ok: false, error: "invalid_request", message: `Cannot convert text to ${to}. Supported: base64, hex`, request_id: reqId() }); return;
    }
    if (from === "base64") {
      if (to === "text" || to === "string") { res.json({ ok: true, output: Buffer.from(input, "base64").toString("utf8"), from, to, request_id: reqId() }); return; }
      if (to === "hex") { res.json({ ok: true, output: Buffer.from(input, "base64").toString("hex"), from, to, request_id: reqId() }); return; }
      res.status(400).json({ ok: false, error: "invalid_request", message: `Cannot convert base64 to ${to}. Supported: text, hex`, request_id: reqId() }); return;
    }
    if (from === "json") parsed = JSON.parse(input);
    else if (from === "yaml") parsed = yaml.load(input);
    else if (from === "csv") {
      const { parse } = await import("csv-parse/sync");
      parsed = parse(input, { columns: true, skip_empty_lines: true });
    } else if (from === "xml") {
      const xml2js = await import("xml2js");
      parsed = await xml2js.parseStringPromise(input);
    } else { res.status(400).json({ ok: false, error: "invalid_request", message: `Unsupported from format: ${from}. Supported: json, yaml, csv, xml, text, base64`, request_id: reqId() }); return; }

    let output: string;
    if (to === "json") output = JSON.stringify(parsed, null, 2);
    else if (to === "yaml") output = yaml.dump(parsed);
    else if (to === "csv") {
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const { stringify } = await import("csv-stringify/sync");
      output = stringify(rows as object[], { header: true });
    } else if (to === "xml") {
      const { create } = await import("xmlbuilder2");
      output = create({ root: parsed as object }).end({ prettyPrint: true });
    } else { res.status(400).json({ ok: false, error: "invalid_request", message: `Unsupported to format: ${to}. Supported: json, yaml, csv, xml`, request_id: reqId() }); return; }

    res.json({ ok: true, output, from, to, request_id: reqId() });
  } catch (e) {
    res.status(422).json({ ok: false, error: "conversion_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 5. TRANSFORM-TEXT ───────────────────────────────────────────────────────

router.post("/transform-text", ...toolMiddleware("transform-text"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "transform-text", 3);
    if (!ok) return;
  }
  const { text } = req.body as { text?: string };
  let mode = (req.body.mode ?? req.body.operation) as string | undefined; // accept documented alias `operation`
  if (mode === "camelCase") mode = "camel"; else if (mode === "snakeCase") mode = "snake"; else if (mode === "kebabCase") mode = "kebab"; // accept documented casing variants
  if (!text || !mode) { res.status(400).json({ ok: false, error: "invalid_request", message: "text and mode (or operation) are required", request_id: reqId() }); return; }
  const modes = ["uppercase","lowercase","titlecase","slug","camel","snake","kebab","base64_encode","base64_decode","reverse","trim","word_count"];
  if (!modes.includes(mode)) { res.status(400).json({ ok: false, error: "invalid_request", message: `mode must be one of: ${modes.join(", ")}`, request_id: reqId() }); return; }
  let result: string | number;
  const words = text.trim().split(/\s+/);
  switch (mode) {
    case "uppercase": result = text.toUpperCase(); break;
    case "lowercase": result = text.toLowerCase(); break;
    case "titlecase": result = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "); break;
    case "slug": result = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); break;
    case "camel": result = words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""); break;
    case "snake": result = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); break;
    case "kebab": result = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); break;
    case "base64_encode": result = Buffer.from(text, "utf8").toString("base64"); break;
    case "base64_decode": result = Buffer.from(text, "base64").toString("utf8"); break;
    case "reverse": result = text.split("").reverse().join(""); break;
    case "trim": result = text.trim(); break;
    case "word_count": result = words.filter(w => w.length > 0).length; break;
    default: result = text;
  }
  res.json({ ok: true, result, mode, input_length: text.length, request_id: reqId() });
});

// ─── 6. EXTRACT-METADATA ─────────────────────────────────────────────────────

router.post("/extract-metadata", ...toolMiddleware("extract-metadata"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "extract-metadata", 3);
    if (!ok) return;
  }
  const { text, url } = req.body as { text?: string; url?: string };
  if (!text && !url) { res.status(400).json({ ok: false, error: "invalid_request", message: "text or url is required", request_id: reqId() }); return; }
  try {
    const cheerio = await import("cheerio");
    let html = text ?? "";
    let fetchedUrl = url ?? "";
    if (url && !text) {
      try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      const resp = await safeAxiosGet(url, { timeout: 10000, headers: { "User-Agent": "ArchTools/1.5 Metadata Extractor" } });
      html = resp.data as string;
    }
    const $ = cheerio.load(html);
    const og: Record<string, string> = {};
    $('meta[property^="og:"]').each((_, el) => { const k = $(el).attr("property") ?? ""; const v = $(el).attr("content") ?? ""; if (k && v) og[k.replace("og:", "")] = v; });
    const meta: Record<string, string> = {};
    $("meta[name]").each((_, el) => { const k = $(el).attr("name") ?? ""; const v = $(el).attr("content") ?? ""; if (k && v) meta[k] = v; });
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
    const links: string[] = [];
    $("a[href]").each((_, el) => { const h = $(el).attr("href"); if (h?.startsWith("http")) links.push(h); });
    res.json({ ok: true, url: fetchedUrl, title: $("title").text() || og["title"] || "", description: meta["description"] || og["description"] || "", og, meta, word_count: wordCount, link_count: links.length, links: links.slice(0, 20), request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "metadata_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 7. WEB-SCRAPE ───────────────────────────────────────────────────────────

router.post("/web-scrape", ...toolMiddleware("web-scrape"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "web-scrape", 5);
    if (!ok) return;
  }
  const { url, selector } = req.body as { url?: string; selector?: string };
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    const resp = await safeAxiosGet(url, { timeout: 15000, headers: { "User-Agent": "ArchTools/1.5 Web Scraper (https://archtools.dev)" } });
    const cheerio = await import("cheerio");
    const $ = cheerio.load(resp.data as string);
    $("script, style, noscript, nav, footer, header, iframe").remove();
    let content: string;
    if (selector) {
      content = $(selector).text().replace(/\s+/g, " ").trim();
    } else {
      content = $("body").text().replace(/\s+/g, " ").trim();
    }
    const links: Array<{ text: string; href: string }> = [];
    $("a[href]").each((_, el) => { const h = $(el).attr("href"); if (h?.startsWith("http")) links.push({ text: $(el).text().trim().slice(0, 100), href: h }); });
    res.json({ ok: true, url, title: $("title").text(), text: content.slice(0, 8000), content: content.slice(0, 8000), word_count: content.split(/\s+/).length, links: links.slice(0, 30), status_code: resp.status, request_id: reqId() });
  } catch (_axiosErr) {
    // Fallback: Firecrawl (handles JS-heavy / bot-protected sites).
    // GATED (audit 2026-07-27): the platform Firecrawl key costs real vendor
    // money per scrape, while the 5-credit price was set for the cheap local
    // path. The managed fallback therefore only fires for callers who either
    // bring their own key (BYOK, x-firecrawl-key) or paid the higher x402
    // per-request price ($0.015 — covers vendor cost per PR #73 pricing).
    // Credit-paid callers keep the local scrape and get a clear upgrade hint.
    const fallback = firecrawlFallbackKey({
      byokKey: req.headers["x-firecrawl-key"] as string | undefined,
      x402Paid: isX402Paid(req),
      platformKey: process.env.FIRECRAWL_API_KEY,
    });
    if (fallback) {
      const byokFc = fallback.byok;
      if (byokFc) console.log(`[BYOK] web-scrape using user-provided firecrawl key`);
      try {
        const fc = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${fallback.key}` },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (fc.ok) {
          const fd = await fc.json() as { data?: { markdown?: string; metadata?: { title?: string; description?: string } } };
          const text = fd.data?.markdown ?? "";
          res.json({ ok: true, url, title: fd.data?.metadata?.title ?? "", text: text.slice(0, 8000), word_count: text.split(/\s+/).length, links: [], status_code: 200, source: "firecrawl", ...(byokFc ? { byok: true, byok_provider: "firecrawl" } : {}), request_id: reqId() }); return;
        }
      } catch (_) { /* fall through to error */ }
    }
    const status = axios.isAxiosError(_axiosErr) ? (_axiosErr.response?.status ?? 502) : 500;
    res.status(status).json({ ok: false, error: "scrape_error", message: safeErr(_axiosErr), hint: "For JS-heavy or bot-protected sites, provide your own Firecrawl key via the x-firecrawl-key header (BYOK), or pay per-request via x402 — the x402 price includes the managed Firecrawl fallback.", request_id: reqId() });
  }
});

// ─── 8. EXTRACT-PAGE ─────────────────────────────────────────────────────────

router.post("/extract-page", ...toolMiddleware("extract-page"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "extract-page", 5);
    if (!ok) return;
  }
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    const resp = await safeAxiosGet(url, { timeout: 15000, headers: { "User-Agent": "ArchTools/1.5" } });
    const cheerio = await import("cheerio");
    const $ = cheerio.load(resp.data as string);
    $("script, style, noscript, nav, footer, header, aside").remove();
    const title = $("title").text();
    const description = $('meta[name="description"]').attr("content") ?? "";
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);
    const images: string[] = [];
    $("img[src]").each((_, el) => { const s = $(el).attr("src"); if (s?.startsWith("http")) images.push(s); });
    const links: string[] = [];
    $("a[href]").each((_, el) => { const h = $(el).attr("href"); if (h?.startsWith("http")) links.push(h); });
    res.json({ ok: true, url, title, description, text, images: images.slice(0, 20), links: links.slice(0, 30), word_count: text.split(/\s+/).length, request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "extract_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 9. SEARCH-WEB ───────────────────────────────────────────────────────────

router.post("/search-web", ...toolMiddleware("search-web"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "search-web", 5);
    if (!ok) return;
  }
  const { query, limit, num_results } = req.body as { query?: string; limit?: number; num_results?: number };
  const resultLimit = Math.min(Math.max(1, limit ?? num_results ?? 5), 10);
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return; }
  // BYOK: check for user-provided search keys
  const byokBraveKeySearch = req.headers["x-brave-key"] as string | undefined;
  const byokTavilyKeySearch = req.headers["x-tavily-key"] as string | undefined;
  try {
    // Primary: Brave Search (BYOK first, then platform key)
    const braveKey = byokBraveKeySearch || process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) {
      if (byokBraveKeySearch) console.log(`[BYOK] search-web using user-provided brave key`);
      try {
        const resp = await fetch("https://api.search.brave.com/res/v1/web/search?" + new URLSearchParams({ q: query, count: String(resultLimit) }), {
          headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": braveKey },
        });
        if (resp.ok) {
          const data = await resp.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
          const results = (data.web?.results ?? []).map(r => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "" }));
          if (results.length > 0) {
            res.json({ ok: true, query, results, count: results.length, source: "brave", ...(byokBraveKeySearch ? { byok: true, byok_provider: "brave" } : {}), request_id: reqId() }); return;
          }
        }
      } catch (_) { /* fall through to Tavily */ }
    }
    // Fallback: Tavily (BYOK first, then platform key)
    const tavilyKey = byokTavilyKeySearch || process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      if (byokTavilyKeySearch) console.log(`[BYOK] search-web using user-provided tavily key`);
      try {
        const resp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query, max_results: resultLimit }),
        });
        if (resp.ok) {
          const data = await resp.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
          const results = (data.results ?? []).map(r => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
          if (results.length > 0) {
            res.json({ ok: true, query, results, count: results.length, source: "tavily", ...(byokTavilyKeySearch ? { byok: true, byok_provider: "tavily" } : {}), request_id: reqId() }); return;
          }
        }
      } catch (_) { /* fall through */ }
    }
    // Third fallback: Serper
    if (process.env.SERPER_API_KEY) {
      try {
        const resp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: resultLimit }),
        });
        if (resp.ok) {
          const data = await resp.json() as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
          const results = (data.organic ?? []).map(r => ({ title: r.title ?? "", url: r.link ?? "", snippet: r.snippet ?? "" }));
          if (results.length > 0) {
            res.json({ ok: true, query, results, count: results.length, source: "serper", request_id: reqId() }); return;
          }
        }
      } catch (_) { /* fall through */ }
    }
    res.status(503).json({ ok: false, error: "search_unavailable", message: "Search is temporarily unavailable. Pass x-brave-key or x-tavily-key header for BYOK.", request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "search_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 10. WEB-SEARCH (AI-synthesized) ─────────────────────────────────────────

router.post("/web-search", ...toolMiddleware("web-search"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "web-search", 14);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { query } = req.body as { query?: string };
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return; }
  // BYOK: check for user-provided search keys
  const byokBraveKeyWS = req.headers["x-brave-key"] as string | undefined;
  const byokTavilyKeyWS = req.headers["x-tavily-key"] as string | undefined;
  try {
    // Get search context — Tavily primary, Brave fallback
    let context = "";
    let sources: Array<{ title: string; url: string }> = [];
    const tavilyKeyWS = byokTavilyKeyWS || process.env.TAVILY_API_KEY;
    if (tavilyKeyWS) {
      if (byokTavilyKeyWS) console.log(`[BYOK] web-search using user-provided tavily key`);
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKeyWS, query, max_results: 5, include_raw_content: false }),
        });
        if (r.ok) {
          const d = await r.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
          sources = (d.results ?? []).map(r => ({ title: r.title ?? "", url: r.url ?? "" }));
          context = (d.results ?? []).map(r => `${r.title}\n${r.content}`).join("\n\n").slice(0, 4000);
        }
      } catch (_) { /* fall through */ }
    }
    const braveKeyWS = byokBraveKeyWS || process.env.BRAVE_SEARCH_API_KEY;
    if (!context && braveKeyWS) {
      if (byokBraveKeyWS) console.log(`[BYOK] web-search using user-provided brave key`);
      try {
        const r = await fetch("https://api.search.brave.com/res/v1/web/search?" + new URLSearchParams({ q: query, count: "5" }), {
          headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": braveKeyWS },
        });
        if (r.ok) {
          const d = await r.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
          sources = (d.web?.results ?? []).map(r => ({ title: r.title ?? "", url: r.url ?? "" }));
          context = (d.web?.results ?? []).map(r => `${r.title}\n${r.description}`).join("\n\n").slice(0, 4000);
        }
      } catch (_) { /* fall through */ }
    }
    if (!context) { res.status(503).json({ ok: false, error: "search_unavailable", message: "Search context unavailable. Pass x-tavily-key or x-brave-key header for BYOK.", request_id: reqId() }); return; }
    // Synthesize with Claude
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: `Answer this query based on the following search context. Be concise and factual.\n\nQuery: ${query}\n\nContext:\n${context}\n\nAnswer:` }],
    });
    const answer = msg.content.find(b => b.type === "text")?.text ?? "";
    res.json({ ok: true, query, answer, sources, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "search_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 11. RSS-PARSE ───────────────────────────────────────────────────────────

router.post("/rss-parse", ...toolMiddleware("rss-parse"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "rss-parse", 4);
    if (!ok) return;
  }
  const { url, limit = 20 } = req.body as { url?: string; limit?: number };
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    const resp = await safeAxiosGet(url, { timeout: 10000, headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
    const xml2js = await import("xml2js");
    const parsed = await xml2js.parseStringPromise(resp.data as string, { explicitArray: false, mergeAttrs: true });
    const channel = parsed?.rss?.channel ?? parsed?.feed;
    if (!channel) { res.status(422).json({ ok: false, error: "parse_error", message: "Could not parse RSS/Atom feed", request_id: reqId() }); return; }
    const items = (channel.item ?? channel.entry ?? []);
    const entries = (Array.isArray(items) ? items : [items]).slice(0, limit).map((item: Record<string, unknown>) => ({
      title: typeof item.title === "string" ? item.title : (item.title as Record<string, unknown>)?._ ?? "",
      link: item.link ?? item.id ?? "",
      description: typeof item.description === "string" ? item.description?.slice(0, 500) : "",
      pubDate: item.pubDate ?? item.published ?? item.updated ?? "",
    }));
    res.json({ ok: true, url, feed_title: typeof channel.title === "string" ? channel.title : "", items: entries, count: entries.length, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "rss_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 12. IP-LOOKUP ───────────────────────────────────────────────────────────

router.post("/ip-lookup", ...toolMiddleware("ip-lookup"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "ip-lookup", 2);
    if (!ok) return;
  }
  const { ip } = req.body as { ip?: string };
  if (!ip) { res.status(400).json({ ok: false, error: "invalid_request", message: "ip is required", request_id: reqId() }); return; }
  const ipClean = String(ip).trim();
  // Restrict to IP charset (digits/hex/dot/colon) so it can't break out of the
  // upstream URL path, then encode defensively.
  if (!/^[0-9a-fA-F.:]{2,45}$/.test(ipClean)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "ip must be a valid IPv4 or IPv6 address", request_id: reqId() }); return;
  }
  try {
    const resp = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ipClean)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,proxy,hosting,query`, { timeout: 6000 });
    const data = resp.data as Record<string, unknown>;
    if (data.status === "fail") { res.status(422).json({ ok: false, error: "lookup_error", message: String(data.message ?? "Invalid IP"), request_id: reqId() }); return; }
    res.json({ ok: true, ip: data.query, country: data.country, country_code: data.countryCode, region: data.regionName, city: data.city, zip: data.zip, lat: data.lat, lon: data.lon, timezone: data.timezone, isp: data.isp, org: data.org, is_proxy: data.proxy, is_hosting: data.hosting, request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "lookup_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 13. WHOIS-LOOKUP ────────────────────────────────────────────────────────

router.post("/whois-lookup", ...toolMiddleware("whois-lookup"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "whois-lookup", 3);
    if (!ok) return;
  }
  const { domain } = req.body as { domain?: string };
  if (!domain) { res.status(400).json({ ok: false, error: "invalid_request", message: "domain is required", request_id: reqId() }); return; }
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

  // Helper: parse RDAP response into a normalized object
  const parseRdap = (data: Record<string, unknown>) => {
    const events = (data.events as Array<{ eventAction: string; eventDate: string }>) ?? [];
    const nameservers = ((data.nameservers as Array<{ ldhName: string }>) ?? []).map(ns => ns.ldhName);
    const created = events.find(e => e.eventAction === "registration")?.eventDate ?? null;
    const expires = events.find(e => e.eventAction === "expiration")?.eventDate ?? null;
    const updated = events.find(e => e.eventAction === "last changed")?.eventDate ?? null;
    return { ok: true, domain: clean, status: data.status, registered: created, expires, last_updated: updated, nameservers, registrar: (data.entities as Array<Record<string, unknown>>)?.[0]?.handle ?? null, request_id: reqId() };
  };

  // Exponential backoff retry against rdap.org (3 attempts: 500ms, 1s, 2s)
  const delays = [500, 1000, 2000];
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt - 1]));
      const resp = await axios.get(`https://rdap.org/domain/${clean}`, { timeout: 10000, headers: { "Accept": "application/json" } });
      res.json(parseRdap(resp.data as Record<string, unknown>)); return;
    } catch (e) {
      lastError = e;
    }
  }

  // Fallback: IANA RDAP
  try {
    const resp = await axios.get(`https://rdap.iana.org/domain/${clean}`, { timeout: 10000, headers: { "Accept": "application/json" } });
    res.json({ ...parseRdap(resp.data as Record<string, unknown>), source: "iana_fallback" }); return;
  } catch (e) {
    res.status(502).json({ ok: false, error: "whois_error", message: safeErr(lastError ?? e), request_id: reqId() });
  }
});

// ─── 14. EMAIL-VERIFY ────────────────────────────────────────────────────────

router.post("/email-verify", ...toolMiddleware("email-verify"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "email-verify", 3);
    if (!ok) return;
  }
  const { email } = req.body as { email?: string };
  if (!email) { res.status(400).json({ ok: false, error: "invalid_request", message: "email is required", request_id: reqId() }); return; }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valid_format = emailRe.test(email);
  const domain = email.split("@")[1] ?? "";
  const disposableDomains = ["mailinator.com","guerrillamail.com","temp-mail.org","throwaway.email","yopmail.com","trashmail.com","fakeinbox.com","maildrop.cc","sharklasers.com","guerrillamailblock.com"];
  const is_disposable = disposableDomains.includes(domain.toLowerCase());
  let mx_valid = false;
  if (valid_format && !is_disposable) {
    try {
      const resp = await axios.get(`https://dns.google/resolve?name=${domain}&type=MX`, { timeout: 5000 });
      const data = resp.data as { Status: number; Answer?: unknown[] };
      mx_valid = data.Status === 0 && (data.Answer?.length ?? 0) > 0;
    } catch { mx_valid = false; }
  }
  res.json({ ok: true, email, valid_format, is_disposable, mx_valid, deliverable: valid_format && !is_disposable && mx_valid, domain, request_id: reqId() });
});

// ─── 15. PHONE-VALIDATE ──────────────────────────────────────────────────────

router.post("/phone-validate", ...toolMiddleware("phone-validate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "phone-validate", 2);
    if (!ok) return;
  }
  const { phone, country = "US" } = req.body as { phone?: string; country?: string };
  if (!phone) { res.status(400).json({ ok: false, error: "invalid_request", message: "phone is required", request_id: reqId() }); return; }
  try {
    const { parsePhoneNumberFromString } = await import("libphonenumber-js");
    const parsed = parsePhoneNumberFromString(phone, country as "US");
    if (!parsed) { res.json({ ok: true, valid: false, phone, message: "Could not parse phone number", request_id: reqId() }); return; }
    res.json({ ok: true, valid: parsed.isValid(), phone, e164: parsed.format("E.164"), national: parsed.formatNational(), international: parsed.formatInternational(), country_code: parsed.country, country_calling_code: `+${parsed.countryCallingCode}`, type: parsed.getType() ?? "unknown", request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "phone_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 16. CURRENCY-CONVERT ────────────────────────────────────────────────────

router.post("/currency-convert", ...toolMiddleware("currency-convert"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "currency-convert", 2);
    if (!ok) return;
  }
  const { amount, from, to } = req.body as { amount?: number; from?: string; to?: string };
  if (!amount || !from || !to) { res.status(400).json({ ok: false, error: "invalid_request", message: "amount, from, and to are required", request_id: reqId() }); return; }
  try {
    const resp = await axios.get(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`, { timeout: 8000 });
    const data = resp.data as { result: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) { res.status(502).json({ ok: false, error: "rate_error", message: "Could not fetch exchange rates", request_id: reqId() }); return; }
    const rate = data.rates[to.toUpperCase()];
    if (!rate) { res.status(422).json({ ok: false, error: "invalid_currency", message: `Currency ${to} not found`, request_id: reqId() }); return; }
    const converted = Math.round(amount * rate * 100) / 100;
    res.json({ ok: true, from: from.toUpperCase(), to: to.toUpperCase(), amount, rate, converted, request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "convert_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 17. TIMEZONE-CONVERT ────────────────────────────────────────────────────

router.post("/timezone-convert", ...toolMiddleware("timezone-convert"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "timezone-convert", 1);
    if (!ok) return;
  }
  const { datetime, from_tz, to_tz } = req.body as { datetime?: string; from_tz?: string; to_tz?: string };
  if (!datetime || !from_tz || !to_tz) { res.status(400).json({ ok: false, error: "invalid_request", message: "datetime, from_tz, and to_tz are required", request_id: reqId() }); return; }
  try {
    const fromDate = new Date(datetime);
    if (isNaN(fromDate.getTime())) { res.status(422).json({ ok: false, error: "invalid_datetime", message: "Could not parse datetime", request_id: reqId() }); return; }
    const toFormatted = new Intl.DateTimeFormat("en-US", { timeZone: to_tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(fromDate);
    res.json({ ok: true, input: datetime, from_tz, to_tz, result: toFormatted, iso: fromDate.toISOString(), request_id: reqId() });
  } catch (e) {
    res.status(422).json({ ok: false, error: "tz_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 18. GENERATE-UUID ───────────────────────────────────────────────────────

router.post("/generate-uuid", ...toolMiddleware("generate-uuid"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "generate-uuid", 1);
    if (!ok) return;
  }
  const { version = "v4", count = 1, format = "uuid" } = req.body as { version?: string; count?: number; format?: string };
  const n = Math.min(Math.max(1, count), 100);
  const results: string[] = [];
  for (let i = 0; i < n; i++) {
    if (version === "v1") results.push(uuidv1());
    else if (format === "api_key") results.push(`arch_${uuidv4().replace(/-/g, "")}`);
    else if (format === "token") results.push(crypto.randomBytes(32).toString("hex"));
    else results.push(uuidv4());
  }
  res.json({ ok: true, version, format, values: results, count: n, request_id: reqId() });
});

// ─── 19. DIFF-TEXT ───────────────────────────────────────────────────────────

router.post("/diff-text", ...toolMiddleware("diff-text"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "diff-text", 2);
    if (!ok) return;
  }
  const text1 = req.body.original ?? req.body.text1;
  const text2 = req.body.modified ?? req.body.text2;
  const mode = req.body.mode ?? "words";
  if (!text1 || !text2) { res.status(400).json({ ok: false, error: "invalid_request", message: "text1/original and text2/modified are required", request_id: reqId() }); return; }
  try {
    const diff = await import("diff");
    let changes: unknown[];
    if (mode === "chars") changes = diff.diffChars(text1, text2);
    else if (mode === "lines" || mode === "unified") changes = diff.diffLines(text1, text2);
    else changes = diff.diffWords(text1, text2);
    const added = (changes as Array<{ added?: boolean; count?: number }>).filter(c => c.added).reduce((s, c) => s + (c.count ?? 0), 0);
    const removed = (changes as Array<{ removed?: boolean; count?: number }>).filter(c => c.removed).reduce((s, c) => s + (c.count ?? 0), 0);
    res.json({ ok: true, mode, changes, added, removed, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "diff_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 20. READABILITY-SCORE ───────────────────────────────────────────────────

router.post("/readability-score", ...toolMiddleware("readability-score"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "readability-score", 2);
    if (!ok) return;
  }
  const { text } = req.body as { text?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? []).length || 1;
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const syllableCount = words.reduce((s, w) => {
    const count = w.toLowerCase().replace(/[^aeiouy]/g, "").length || 1;
    return s + count;
  }, 0);
  const asl = words.length / sentences;
  const asw = syllableCount / words.length;
  const fk_ease = 206.835 - 1.015 * asl - 84.6 * asw;
  const fk_grade = 0.39 * asl + 11.8 * asw - 15.59;
  const gradeLabel = fk_grade <= 6 ? "Elementary" : fk_grade <= 9 ? "Middle School" : fk_grade <= 12 ? "High School" : "College+";
  res.json({ ok: true, flesch_kincaid_ease: Math.round(fk_ease * 10) / 10, flesch_kincaid_grade: Math.round(fk_grade * 10) / 10, grade_label: gradeLabel, word_count: words.length, sentence_count: sentences, avg_words_per_sentence: Math.round(asl * 10) / 10, avg_syllables_per_word: Math.round(asw * 10) / 10, request_id: reqId() });
});

// ─── 21. LANGUAGE-DETECT ─────────────────────────────────────────────────────

router.post("/language-detect", ...toolMiddleware("language-detect"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "language-detect", 3);
    if (!ok) return;
  }
  const { text } = req.body as { text?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    // Use Claude for accurate language detection
    if (getAnthropic()) {
      const msg = await getAnthropic()!.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{ role: "user", content: `Detect the language of this text. Reply ONLY with a JSON object: {"language": "English", "code": "en", "confidence": 0.99}\n\nText: ${text.slice(0, 500)}` }],
      });
      const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { language?: string; code?: string; confidence?: number };
      res.json({ ok: true, language: parsed.language ?? "Unknown", code: parsed.code ?? "und", confidence: parsed.confidence ?? 0, request_id: reqId() });
    } else {
      // Fallback: franc library
      const { franc } = await import("franc");
      const code = franc(text);
      res.json({ ok: true, language: code, code, confidence: 0.7, request_id: reqId() });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: "detect_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 22. SENTIMENT-ANALYSIS ──────────────────────────────────────────────────

router.post("/sentiment-analysis", ...toolMiddleware("sentiment-analysis"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "sentiment-analysis", 8);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text } = req.body as { text?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: `Analyze the sentiment of this text. Return ONLY a JSON object:\n{"sentiment": "positive|negative|neutral|mixed", "score": 0.85, "emotions": {"joy": 0.8, "anger": 0.1, "sadness": 0.0, "fear": 0.0, "surprise": 0.1, "disgust": 0.0}}\n\nText: ${text.slice(0, 2000)}` }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { sentiment?: string; score?: number; emotions?: Record<string, number> };
    res.json({ ok: true, sentiment: parsed.sentiment ?? "neutral", score: parsed.score ?? 0.5, emotions: parsed.emotions ?? {}, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "sentiment_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 23. SUMMARIZE ───────────────────────────────────────────────────────────

router.post("/summarize", ...toolMiddleware("summarize"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "summarize", 10);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text, style = "paragraph" } = req.body as { text?: string; style?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  const stylePrompts: Record<string, string> = {
    paragraph: "Write a concise 2-3 sentence paragraph summary.",
    bullets: "Write a bulleted list of 5 key points. Use • for bullets.",
    tldr: "Write a single sentence TL;DR starting with 'TL;DR:'",
    headline: "Write a single news headline (max 15 words).",
    executive: "Write a 3-paragraph executive summary with: Key Finding, Supporting Details, Recommendation.",
  };
  const prompt = stylePrompts[style] ?? stylePrompts["paragraph"];
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: `${prompt}\n\nText to summarize:\n${text.slice(0, 8000)}` }],
    });
    const summary = msg.content.find(b => b.type === "text")?.text ?? "";
    res.json({ ok: true, summary, style, original_word_count: text.split(/\s+/).length, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "summarize_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 24. EXTRACT-ENTITIES ────────────────────────────────────────────────────

router.post("/extract-entities", ...toolMiddleware("extract-entities"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "extract-entities", 8);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text } = req.body as { text?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: `Extract named entities from this text. Return ONLY JSON:\n{"people": [], "organizations": [], "locations": [], "dates": [], "money": [], "other": []}\n\nText: ${text.slice(0, 4000)}` }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const entities = JSON.parse(raw.replace(/```json|```/g, "").trim()) as Record<string, string[]>;
    const total = Object.values(entities).reduce((s, a) => s + a.length, 0);
    res.json({ ok: true, entities, total_found: total, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "entity_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 25. REGEX-GENERATE ──────────────────────────────────────────────────────

router.post("/regex-generate", ...toolMiddleware("regex-generate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "regex-generate", 8);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { description, examples } = req.body as { description?: string; examples?: string[] };
  if (!description) { res.status(400).json({ ok: false, error: "invalid_request", message: "description is required", request_id: reqId() }); return; }
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: `Generate a JavaScript regex for: "${description}"\n${examples?.length ? `Examples that should match: ${examples.join(", ")}` : ""}\n\nReturn ONLY valid JSON (no extra text): {"pattern": "^[a-z]+$", "flags": "i", "explanation": "brief explanation", "test_examples": ["match1", "match2"]}` }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    // Extract JSON object from response even if Claude adds surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned) as { pattern?: string; flags?: string; explanation?: string; test_examples?: string[] };
    res.json({ ok: true, pattern: parsed.pattern ?? "", flags: parsed.flags ?? "", regex: `/${parsed.pattern ?? ""}/${parsed.flags ?? ""}`, explanation: parsed.explanation ?? "", test_examples: parsed.test_examples ?? [], request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "regex_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 26. PII-DETECT ──────────────────────────────────────────────────────────

router.post("/pii-detect", ...toolMiddleware("pii-detect"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "pii-detect", 10);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text, redact = false } = req.body as { text?: string; redact?: boolean };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: `Detect PII in this text${redact ? " and provide redacted version" : ""}. Return ONLY JSON:\n{"found": [{"type": "email|phone|ssn|credit_card|name|address|dob|ip", "value": "...", "start": 0, "end": 5}], "has_pii": true${redact ? ', "redacted": "text with [EMAIL] placeholders"' : ""}}\n\nText: ${text.slice(0, 4000)}` }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { found?: unknown[]; has_pii?: boolean; redacted?: string };
    // Consent/retention transparency (legal audit 2026-07-27): pii-detect handles
    // SSN/CC/etc. Signal detection via a header and remind callers that inputs aren't
    // retained and real PII should be handled per their own consent obligations.
    if (parsed.has_pii) res.setHeader("X-PII-Detected", "true");
    res.setHeader("X-Data-Retention", "not-stored");
    res.json({ ok: true, has_pii: parsed.has_pii ?? false, found: parsed.found ?? [], count: (parsed.found ?? []).length, ...(redact ? { redacted: parsed.redacted ?? text } : {}), notice: "Inputs are processed transiently and not stored by Arch Tools. You are responsible for having a lawful basis/consent to process any real personal data you submit.", request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "pii_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 27. AI-GENERATE ─────────────────────────────────────────────────────────

// AI mode presets: maps a mode name to a default model
const AI_MODE_PRESETS: Record<string, string> = {
  fast:  "claude-haiku-4-5-20251001",  // cheapest/fastest
  smart: "claude-sonnet-4-6",           // balanced (default)
  deep:  "claude-opus-4-6",             // most capable
};

router.post("/ai-generate", ...toolMiddleware("ai-generate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  // ── BYOK: check for user-provided API keys ──
  const byokAnthropicKey = req.headers["x-anthropic-key"] as string | undefined;
  const byokOpenaiKey = req.headers["x-openai-key"] as string | undefined;
  const byokXaiKey = req.headers["x-xai-key"] as string | undefined;
  const byokGoogleKey = req.headers["x-google-key"] as string | undefined;

  const { prompt, system, model: explicitModel, mode, max_tokens = 1000 } = req.body as { prompt?: string; system?: string; model?: string; mode?: string; max_tokens?: number };
  const paid = isX402Paid(req);
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  const MAX_PROMPT = parseInt(process.env.AI_MAX_PROMPT_CHARS ?? "32000", 10);
  if (prompt.length > MAX_PROMPT) { res.status(400).json({ ok: false, error: "prompt_too_long", message: `Prompt exceeds ${MAX_PROMPT} character limit`, request_id: reqId() }); return; }

  // Resolve model: explicit model > mode preset > default "smart"
  const validModes = Object.keys(AI_MODE_PRESETS);
  if (mode && !validModes.includes(mode)) {
    res.status(400).json({ ok: false, error: "invalid_mode", message: `mode must be one of: ${validModes.join(", ")}. Or provide an explicit model instead.`, request_id: reqId() }); return;
  }
  // Friendly alias mapping — openapi.json advertises these short names
  const MODEL_ALIASES: Record<string, string> = {
    "claude": "claude-sonnet-4-6",
    "gpt": "gpt-4o",
    "gpt4": "gpt-4o",
    "gpt-4": "gpt-4o",
    "gemini": "gemini-2.0-flash",
    "grok": "grok-3",
  };
  const requestedModel = explicitModel ? (MODEL_ALIASES[explicitModel.toLowerCase()] ?? explicitModel) : undefined;
  let model = requestedModel ?? AI_MODE_PRESETS[mode ?? "smart"] ?? "claude-sonnet-4-6";
  let resolvedMode = explicitModel ? undefined : (mode ?? "smart");

  const CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];
  const GPT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
  const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
  const GROK_MODELS = ["grok-3", "grok-3-fast", "grok-2"];

  // x402 flat pricing gap (council finding 2026-07-27): the flat x402 price for
  // this tool ($0.040) covers the standard Sonnet-tier cost, but the 402 challenge
  // is generated before the model is known, so an x402 caller could otherwise get
  // a premium model (Opus ≈ 2× cost) at the flat price. Pin x402-paid calls to the
  // default model; premium models require the credits/subscription path (which
  // prices per-model via applyModelCost). NOT when the caller brought their own key
  // for the selected model's provider (BYOK pays its own inference, so the model
  // choice costs the platform nothing) — an unrelated BYOK header still runs on
  // platform keys and must not unlock premium models at the flat price.
  const byokMatchesModel =
    (CLAUDE_MODELS.includes(model) && !!byokAnthropicKey) ||
    (GPT_MODELS.includes(model) && !!byokOpenaiKey) ||
    (GEMINI_MODELS.includes(model) && !!byokGoogleKey) ||
    (GROK_MODELS.includes(model) && !!byokXaiKey);
  if (paid && !byokMatchesModel && modelCostMultiplier(model) > 1.0) {
    model = AI_MODE_PRESETS.smart; // claude-sonnet-4-6
    if (resolvedMode) resolvedMode = "smart"; // echo the served tier, not the requested one
  }

  const maxTok = Math.min(max_tokens, 4096);

  const allModels = [...CLAUDE_MODELS, ...GPT_MODELS, ...GEMINI_MODELS, ...GROK_MODELS];
  if (!allModels.includes(model)) {
    res.status(400).json({ ok: false, error: "invalid_model", message: `Unknown model '${model}'. Valid models: claude, gpt4, gemini, grok, ${allModels.join(", ")}`, request_id: reqId() });
    return;
  }

  // BYOK discount applies ONLY when the caller's key matches the selected
  // model's provider — an unrelated BYOK header must not discount platform-key
  // inference.
  const byokProvider =
    GPT_MODELS.includes(model) && byokOpenaiKey ? "openai" :
    GEMINI_MODELS.includes(model) && byokGoogleKey ? "google" :
    GROK_MODELS.includes(model) && byokXaiKey ? "xai" :
    CLAUDE_MODELS.includes(model) && byokAnthropicKey ? "anthropic" :
    null;

  if (!paid) {
    // Scale by max_tokens: base 20, +20 per 1000 tokens above 1000.
    const requestedTokens = Math.max(1, Number(max_tokens) || 1000);
    let aiGenCost = 20 + 20 * Math.ceil(Math.max(0, requestedTokens - 1000) / 1000);
    if (byokProvider) {
      // BYOK: the caller pays the model's inference cost themselves, so our credit
      // charge is flat platform overhead — do NOT scale it by the model (council
      // finding 2026-07-27: multiplying then discounting distorts the BYOK fee).
      aiGenCost = Math.max(1, Math.ceil(aiGenCost * 0.2));
    } else {
      // Scale by the selected model's real cost (Opus ≈ 2×, Haiku ≈ 0.4× vs the
      // Sonnet-tuned base) so an expensive model isn't served at a cheap price.
      aiGenCost = applyModelCost(aiGenCost, model);
    }
    const ok = await deductCredits(req, res, "ai-generate", aiGenCost);
    if (!ok) return;
  }

  try {
    // ── OpenAI (GPT-4o, GPT-4-turbo, GPT-3.5) — check before Claude to avoid default fallthrough ──
    if (GPT_MODELS.includes(model)) {
      const openaiKey = byokOpenaiKey || process.env.OPENAI_API_KEY;
      if (!openaiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "OPENAI_API_KEY not set. Pass x-openai-key header for BYOK.", request_id: reqId() }); return; }
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTok, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
      });
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? "";
      const _u = { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 };
      res.json({ ok: true, text, model, ...(resolvedMode ? { mode: resolvedMode } : {}), provider: "openai", usage: _u, word_count: text.split(/\s+/).filter(Boolean).length, char_count: text.length, sentence_count: text.split(/[.!?]+/).filter((s: string) => s.trim()).length, estimated_cost_usd: (_u.input_tokens * 0.000003 + _u.output_tokens * 0.000015).toFixed(6), response_format: "structured", arch_tools_version: "1.9.0", processed_at: new Date().toISOString(), ...(byokProvider === "openai" ? { byok: true, byok_provider: "openai" } : {}), request_id: reqId() });
      return;
    }

    // ── Google Gemini ──
    if (GEMINI_MODELS.includes(model)) {
      const googleKey = byokGoogleKey || process.env.GOOGLE_API_KEY;
      if (!googleKey || googleKey.startsWith("ENTER")) { res.status(503).json({ ok: false, error: "service_unavailable", message: "Google API key not configured. Pass x-google-key header for BYOK.", request_id: reqId() }); return; }
      const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { maxOutputTokens: maxTok } }),
      });
      const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const _ug = { input_tokens: data.usageMetadata?.promptTokenCount ?? 0, output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
      res.json({ ok: true, text, model, ...(resolvedMode ? { mode: resolvedMode } : {}), provider: "google", usage: _ug, word_count: text.split(/\s+/).filter(Boolean).length, char_count: text.length, sentence_count: text.split(/[.!?]+/).filter((s: string) => s.trim()).length, estimated_cost_usd: (_ug.input_tokens * 0.000001 + _ug.output_tokens * 0.000004).toFixed(6), response_format: "structured", arch_tools_version: "1.9.0", processed_at: new Date().toISOString(), ...(byokProvider === "google" ? { byok: true, byok_provider: "google" } : {}), request_id: reqId() });
      return;
    }

    // ── xAI Grok ──
    if (GROK_MODELS.includes(model)) {
      const xaiKey = byokXaiKey || process.env.XAI_API_KEY;
      if (!xaiKey || xaiKey.startsWith("ENTER")) { res.status(503).json({ ok: false, error: "service_unavailable", message: "xAI key not configured. Pass x-xai-key header for BYOK.", request_id: reqId() }); return; }
      const resp = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${xaiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTok, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
      });
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? "";
      const _ux = { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 };
      res.json({ ok: true, text, model, ...(resolvedMode ? { mode: resolvedMode } : {}), provider: "xai", usage: _ux, word_count: text.split(/\s+/).filter(Boolean).length, char_count: text.length, sentence_count: text.split(/[.!?]+/).filter((s: string) => s.trim()).length, estimated_cost_usd: (_ux.input_tokens * 0.000005 + _ux.output_tokens * 0.000015).toFixed(6), response_format: "structured", arch_tools_version: "1.9.0", processed_at: new Date().toISOString(), ...(byokProvider === "xai" ? { byok: true, byok_provider: "xai" } : {}), request_id: reqId() });
      return;
    }

    // ── Claude ──
    if (CLAUDE_MODELS.includes(model)) {
      const anthKey = byokAnthropicKey || process.env.ANTHROPIC_API_KEY;
      if (!anthKey && !getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "Anthropic key not configured. Pass x-anthropic-key header for BYOK.", request_id: reqId() }); return; }
      // BYOK: use fetch directly with user's key; otherwise use SDK client
      let msg: any;
      if (byokAnthropicKey) {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": byokAnthropicKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: maxTok, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] }) });
        msg = await r.json() as any;
        if (!r.ok) { res.status(r.status).json({ ok: false, error: "byok_api_error", message: msg?.error?.message || "BYOK Anthropic call failed", request_id: reqId() }); return; }
        msg = { content: msg.content, usage: msg.usage, model: msg.model };
      } else {
        msg = await getAnthropic()!.messages.create({ model, max_tokens: maxTok, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] });
      }
      const text = msg.content.find((b: any) => b.type === "text")?.text ?? "";
      const _ua = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
      res.json({ ok: true, text, model, ...(resolvedMode ? { mode: resolvedMode } : {}), provider: "anthropic", usage: _ua, word_count: text.split(/\s+/).filter(Boolean).length, char_count: text.length, sentence_count: text.split(/[.!?]+/).filter((s: string) => s.trim()).length, estimated_cost_usd: (_ua.input_tokens * 0.000003 + _ua.output_tokens * 0.000015).toFixed(6), response_format: "structured", arch_tools_version: "1.9.0", processed_at: new Date().toISOString(), ...(byokProvider === "anthropic" ? { byok: true, byok_provider: "anthropic" } : {}), request_id: reqId() });
      return;
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: "generation_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 28. OCR-EXTRACT ─────────────────────────────────────────────────────────

router.post("/ocr-extract", ...toolMiddleware("ocr-extract"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "ocr-extract", 12);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { image_base64, media_type = "image/jpeg" } = req.body as { image_base64?: string; media_type?: string };
  const image_url = (req.body.image_url ?? req.body.url ?? req.body.image) as string | undefined; // accept documented alias `url`
  if (!image_url && !image_base64) { res.status(400).json({ ok: false, error: "invalid_request", message: "image_url (or url) or image_base64 is required", request_id: reqId() }); return; }
  try {
    let imgBase64 = image_base64;
    let imgMediaType: string = media_type;
    if (image_url && !image_base64) {
      try { await validateUrl(image_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      let imgResp;
      try {
        imgResp = await safeAxiosGet(image_url, { responseType: "arraybuffer", timeout: 30000, maxContentLength: 20 * 1024 * 1024, headers: { "User-Agent": "ArchTools/1.0 (+https://archtools.dev)", "Accept": "image/*" } });
      } catch (dlErr) {
        const st = axios.isAxiosError(dlErr) ? dlErr.response?.status : undefined;
        console.error("[ocr-extract] image download failed:", st ?? dlErr);
        res.status(400).json({ ok: false, error: "image_download_failed", message: `Could not download image from image_url${st ? ` (HTTP ${st})` : ""}. Check the URL is public and reachable, or pass image_base64 instead.`, request_id: reqId() }); return;
      }
      imgBase64 = Buffer.from(imgResp.data as ArrayBuffer).toString("base64");
      imgMediaType = (imgResp.headers["content-type"] as string || "image/jpeg").split(";")[0].trim().toLowerCase();
      // A URL that redirects to an HTML page (e.g. a deleted-image placeholder)
      // downloads with a 200 but a non-image content-type. Reject it as bad
      // input instead of forwarding HTML to the vision model (which 500'd).
      if (!imgMediaType.startsWith("image/")) {
        res.status(400).json({ ok: false, error: "not_an_image", message: `image_url did not return an image (got content-type "${imgMediaType || "unknown"}"). The link may redirect to an HTML page; pass a direct image URL or image_base64.`, request_id: reqId() }); return;
      }
    }
    // Anthropic vision API only accepts these media types
    const VALID_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!VALID_MEDIA_TYPES.includes(imgMediaType)) {
      imgMediaType = "image/jpeg"; // safe default
    }
    const imageContent = { type: "image" as const, source: { type: "base64" as const, media_type: imgMediaType as "image/jpeg", data: imgBase64! } };
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: [imageContent, { type: "text", text: "Extract all text from this image. Return the text exactly as it appears, preserving formatting and structure." }] }],
    });
    const text = msg.content.find(b => b.type === "text")?.text ?? "";
    res.json({ ok: true, text, word_count: text.split(/\s+/).length, request_id: reqId() });
  } catch (e) {
    console.error("[ocr-extract] error:", e);
    // Bad/unsupported image data → the vision API returns a 4xx. Surface that
    // as a clean client error rather than a 500. (NOTE: never 502 from origin —
    // Cloudflare replaces origin 502 bodies and hides our JSON.)
    if (e instanceof Anthropic.APIError && typeof e.status === "number") {
      // 400/422 = the image itself is bad/unsupported -> clean client error.
      if (e.status === 400 || e.status === 422) {
        res.status(422).json({ ok: false, error: "image_unprocessable", message: "The image could not be processed for OCR. Ensure it is a valid, non-corrupted JPEG, PNG, GIF, or WebP under the size limit.", request_id: reqId() }); return;
      }
      // 429 = upstream rate limit -> surface as 429, not a fake 'bad image'.
      if (e.status === 429) {
        res.status(429).json({ ok: false, error: "ocr_rate_limited", message: "The OCR vision service is rate limited. Please retry shortly.", request_id: reqId() }); return;
      }
      // 401/403/404/5xx = upstream/auth/config problem -> 503 (never mask as bad image).
      res.status(503).json({ ok: false, error: "ocr_upstream_error", message: "The OCR vision service is temporarily unavailable. Please retry.", request_id: reqId() }); return;
    }
    res.status(500).json({ ok: false, error: "ocr_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 29. BROWSER-TASK ────────────────────────────────────────────────────────

router.post("/browser-task", ...toolMiddleware("browser-task"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "browser-task", 10);
    if (!ok) return;
  }
  const { url, selector, text: inputText } = req.body as { url?: string; selector?: string; text?: string };
  const action = String(req.body.action ?? req.body.task ?? "extract");
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  // Fallback: use axios + cheerio for extract (Playwright not available on Render free tier)
  try {
    const resp = await safeAxiosGet(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 ArchTools Browser Task" } });
    const cheerio = await import("cheerio");
    const $ = cheerio.load(resp.data as string);
    if (action === "extract" || action === "html") {
      const content = selector ? (action === "html" ? $(selector).html() : $(selector).text()) : $("body").text().replace(/\s+/g, " ").trim();
      res.json({ ok: true, url, action, result: (content ?? "").slice(0, 5000), request_id: reqId() });
    } else {
      res.json({ ok: true, url, action, result: `Simulated ${action} on ${selector ?? "page"}${inputText ? ` with text: ${inputText}` : ""}`, note: "Full Playwright automation requires dedicated infrastructure", request_id: reqId() });
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: "browser_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 30. EXTRACT-PDF ─────────────────────────────────────────────────────────

router.post("/extract-pdf", ...toolMiddleware("extract-pdf"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "extract-pdf", 6);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { pdf_base64 } = req.body as { pdf_base64?: string };
  const pdf_url = (req.body.pdf_url ?? req.body.url) as string | undefined; // accept documented alias `url`
  if (!pdf_url && !pdf_base64) { res.status(400).json({ ok: false, error: "invalid_request", message: "pdf_url (or url) or pdf_base64 is required", request_id: reqId() }); return; }
  try {
    // Size caps (audit 2026-07-27): the whole document goes to Anthropic as
    // billed input tokens (~1,500–3,000 per page), so bound BOTH input paths —
    // the base64 path previously had no size check at all, letting a 1,000-page
    // PDF consume unbounded inference at a flat 6-credit price. Env-tunable via
    // EXTRACT_PDF_MAX_BYTES / EXTRACT_PDF_MAX_PAGES; limits are advertised in
    // the tool description + openapi.json (advertised=charged includes limits).
    let buffer: Buffer;
    if (pdf_url && !pdf_base64) {
      try { await validateUrl(pdf_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      const resp = await safeAxiosGet(pdf_url, { responseType: "arraybuffer", timeout: 20000 });
      buffer = Buffer.from(resp.data as ArrayBuffer);
    } else {
      buffer = Buffer.from(pdf_base64!, "base64");
    }
    const maxMb = Math.round(EXTRACT_PDF_MAX_BYTES / (1024 * 1024));
    if (buffer.length > EXTRACT_PDF_MAX_BYTES) {
      res.status(400).json({ ok: false, error: "file_too_large", message: `PDF must be under ${maxMb}MB (applies to both pdf_url and pdf_base64 input)`, request_id: reqId() });
      return;
    }
    const estPages = estimatePdfPageCount(buffer);
    if (estPages > EXTRACT_PDF_MAX_PAGES) {
      res.status(400).json({ ok: false, error: "pdf_too_large", message: `This PDF appears to have ~${estPages} pages — extract-pdf accepts at most ${EXTRACT_PDF_MAX_PAGES} pages per call at its flat price. Split the document and extract it in parts.`, request_id: reqId() });
      return;
    }
    const base64Data = buffer.toString("base64");
    try {
      // Use messages.create with betas header for PDF document type support
      const msg = await getAnthropic()!.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data! } } as any, { type: "text", text: "Extract all text from this PDF. Preserve the structure and formatting as much as possible." }] }],
      } as any, { headers: { "anthropic-beta": "pdfs-2024-09-25" } });
      const text = (msg.content.find((b: any) => b.type === "text") as { text: string } | undefined)?.text ?? "";
      res.json({ ok: true, text, word_count: text.split(/\s+/).length, request_id: reqId() });
    } catch (anthropicErr) {
      console.error("[extract-pdf] Anthropic error:", anthropicErr);
      res.status(500).json({ ok: false, error: "pdf_error", message: safeErr(anthropicErr), request_id: reqId() });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: "pdf_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 31. SCREENSHOT-CAPTURE ──────────────────────────────────────────────────

router.post("/screenshot-capture", ...toolMiddleware("screenshot-capture"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "screenshot-capture", 10);
    if (!ok) return;
  }
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    const resp = await safeAxiosGet(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 ArchTools Screenshot" } });
    const cheerio = await import("cheerio");
    const $ = cheerio.load(resp.data as string);
    const title = $("title").text() || "";
    const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";
    const ogImage = $('meta[property="og:image"]').attr("content") || "";
    const h1 = $("h1").first().text() || "";
    const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 1000);
    res.json({
      ok: true,
      url,
      page_meta: { title, description, og_image: ogImage, h1 },
      page_text_preview: bodyText,
      note: "Full screenshot capture requires a dedicated screenshot service. This endpoint returns page metadata and OG image.",
      request_id: reqId(),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: "screenshot_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 32. HTML-TO-MARKDOWN ────────────────────────────────────────────────────

router.post("/html-to-markdown", ...toolMiddleware("html-to-markdown"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "html-to-markdown", 3);
    if (!ok) return;
  }
  const { html, url } = req.body as { html?: string; url?: string };
  if (!html && !url) { res.status(400).json({ ok: false, error: "invalid_request", message: "html or url is required", request_id: reqId() }); return; }
  try {
    let rawHtml = html ?? "";
    if (url && !html) {
      try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      const resp = await safeAxiosGet(url, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0 ArchTools" } });
      rawHtml = resp.data as string;
    }
    const cheerio = await import("cheerio");
    const $ = cheerio.load(rawHtml);
    // Remove nav, footer, script, style
    $("script, style, nav, footer, iframe, noscript").remove();
    const title = $("title").text().trim();
    // Convert headings, paragraphs, links, lists to markdown
    function toMd(el: ReturnType<typeof $>): string {
      let md = "";
      el.children().each((_i, node) => {
        const tag = (node as { tagName?: string }).tagName?.toLowerCase() ?? "";
        const child = $(node);
        if (["h1","h2","h3","h4","h5","h6"].includes(tag)) {
          const level = parseInt(tag[1], 10);
          md += `${"#".repeat(level)} ${child.text().trim()}\n\n`;
        } else if (tag === "p") {
          const text = child.text().trim();
          if (text) md += `${text}\n\n`;
        } else if (tag === "a") {
          const href = child.attr("href") ?? "";
          const text = child.text().trim();
          md += href ? `[${text}](${href})` : text;
        } else if (tag === "ul" || tag === "ol") {
          child.children("li").each((_j, li) => {
            md += `${tag === "ul" ? "- " : "1. "}${$(li).text().trim()}\n`;
          });
          md += "\n";
        } else if (tag === "code") {
          md += `\`${child.text()}\``;
        } else if (tag === "pre") {
          md += `\`\`\`\n${child.text()}\n\`\`\`\n\n`;
        } else if (tag === "blockquote") {
          md += `> ${child.text().trim()}\n\n`;
        } else if (tag === "strong" || tag === "b") {
          md += `**${child.text()}**`;
        } else if (tag === "em" || tag === "i") {
          md += `*${child.text()}*`;
        } else if (tag === "br") {
          md += "\n";
        } else if (tag === "hr") {
          md += "---\n\n";
        } else if (tag === "img") {
          const src = child.attr("src") ?? "";
          const alt = child.attr("alt") ?? "image";
          if (src) md += `![${alt}](${src})\n\n`;
        } else if (child.children().length > 0) {
          md += toMd(child);
        } else {
          const text = child.text().trim();
          if (text) md += `${text} `;
        }
      });
      return md;
    }
    const markdown = (title ? `# ${title}\n\n` : "") + toMd($("body")).replace(/\n{3,}/g, "\n\n").trim();
    res.json({ ok: true, markdown, word_count: markdown.split(/\s+/).length, char_count: markdown.length, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "markdown_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 33. URL-SHORTEN ─────────────────────────────────────────────────────────

router.post("/url-shorten", ...toolMiddleware("url-shorten"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "url-shorten", 1);
    if (!ok) return;
  }
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    const resp = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { timeout: 8000 });
    const short = resp.data as string;
    if (!short.startsWith("http")) throw new Error("TinyURL service unavailable");
    res.json({ ok: true, original_url: url, short_url: short, service: "tinyurl", request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "shorten_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 34. WEBHOOK-SEND ────────────────────────────────────────────────────────

router.post("/webhook-send", ...toolMiddleware("webhook-send"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const withinLimit = await enforceDailyToolLimit(req, res, "webhook-send");
    if (!withinLimit) return;
    const ok = await deductCredits(req, res, "webhook-send", 2);
    if (!ok) return;
  }
  const webhook_url = req.body.url ?? req.body.webhook_url;
  const { payload, headers: customHeaders = {}, method = "POST" } = req.body as {
    payload?: unknown;
    headers?: Record<string, string>;
    method?: string;
  };
  if (!webhook_url) { res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url (or url) is required", request_id: reqId() }); return; }
  if (!webhook_url.startsWith("http")) { res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url must be a valid http/https URL", request_id: reqId() }); return; }
  if (!webhook_url.startsWith("https://")) { res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url must use https", request_id: reqId() }); return; }
  try { await validateUrl(webhook_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  const allowedMethods = ["POST"];
  const httpMethod = allowedMethods.includes(method.toUpperCase()) ? method.toUpperCase() : "POST";
  const payloadString = JSON.stringify(payload ?? {});
  if (payloadString.length > 20_000) { res.status(400).json({ ok: false, error: "invalid_request", message: "payload must be 20KB or less", request_id: reqId() }); return; }
  const safeHeaders = sanitizeWebhookHeaders(customHeaders);
  try {
    const start = Date.now();
    const resp = await safeAxiosRequest(webhook_url, {
      method: httpMethod as "POST",
      data: payload ?? {},
      headers: { "Content-Type": "application/json", "User-Agent": "ArchTools-Webhook/1.0", ...safeHeaders },
      timeout: 10000,
      validateStatus: () => true,
      maxRedirects: 0,
    });
    res.json({
      ok: true,
      webhook_url,
      method: httpMethod,
      status_code: resp.status,
      response_ms: Date.now() - start,
      response_body: typeof resp.data === "string"
        ? resp.data.slice(0, 500)
        : JSON.stringify(resp.data).slice(0, 500),
      request_id: reqId(),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: "webhook_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 35. JSONPATH-QUERY ──────────────────────────────────────────────────────

router.post("/jsonpath-query", ...toolMiddleware("jsonpath-query"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "jsonpath-query", 1);
    if (!ok) return;
  }
  const data = req.body.json ?? req.body.data;
  const jsonPath = (req.body.path ?? req.body.query) as string | undefined; // accept documented alias `query`
  if (!data || !jsonPath) { res.status(400).json({ ok: false, error: "invalid_request", message: "data (or json) and path (or query) are required", request_id: reqId() }); return; }
  try {
    // Simple JSONPath evaluator: supports $, .key, ['key'], [index], [*], ..key
    function evalPath(obj: unknown, expr: string): unknown[] {
      const tokens = expr
        .replace(/\['([^']+)'\]/g, ".$1")
        .replace(/\[(\d+)\]/g, ".$1")
        .replace(/\[\*\]/g, ".*")
        .split(".")
        .filter(Boolean);
      function descend(current: unknown, toks: string[]): unknown[] {
        if (toks.length === 0) return [current];
        const [head, ...rest] = toks;
        if (head === "$") return descend(current, rest);
        if (head === "*") {
          if (Array.isArray(current)) return current.flatMap(item => descend(item, rest));
          if (typeof current === "object" && current !== null) return Object.values(current).flatMap(v => descend(v, rest));
          return [];
        }
        if (head === "..") {
          // Recursive descent
          const results: unknown[] = descend(current, rest);
          if (Array.isArray(current)) current.forEach(item => results.push(...descend(item, toks)));
          else if (typeof current === "object" && current !== null) Object.values(current).forEach(v => results.push(...descend(v, toks)));
          return results;
        }
        if (Array.isArray(current)) {
          const idx = parseInt(head, 10);
          if (!isNaN(idx)) return descend(current[idx], rest);
          return [];
        }
        if (typeof current === "object" && current !== null) {
          const val = (current as Record<string, unknown>)[head];
          if (val === undefined) return [];
          return descend(val, rest);
        }
        return [];
      }
      return descend(obj, tokens);
    }
    const results = evalPath(data, jsonPath);
    res.json({ ok: true, path: jsonPath, results, count: results.length, request_id: reqId() });
  } catch (e) {
    res.status(400).json({ ok: false, error: "jsonpath_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 36. IMAGE-GENERATE (SVG via Claude) ────────────────────────────────────

router.post("/image-generate", ...toolMiddleware("image-generate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "image-generate", 30);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { prompt, style = "svg", width = 400, height = 300 } = req.body as { prompt?: string; style?: string; width?: number; height?: number };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  { const _mod = moderateGenerationPrompt(prompt); if (!_mod.allowed) { console.warn(`[moderation] blocked category=${_mod.category} tool=image-generate`); res.status(400).json({ ok: false, error: "content_policy", category: _mod.category, message: _mod.reason, request_id: reqId() }); return; } }
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Generate a complete, self-contained SVG image (${width}x${height}) based on this prompt: "${prompt}"\n\nRequirements:\n- Valid SVG with viewBox="0 0 ${width} ${height}"\n- Use only SVG elements (rect, circle, path, text, etc.)\n- Make it visually appealing and creative\n- Return ONLY the SVG code, nothing else, no markdown fences`,
      }],
    });
    const svg = sanitizeSvg(msg.content.find(b => b.type === "text")?.text ?? "");
    const base64 = Buffer.from(svg).toString("base64");
    const dataUrl = `data:image/svg+xml;base64,${base64}`;
    res.json({ ok: true, prompt, style: "svg", width, height, data_url: dataUrl, svg, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "generation_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 37. BARCODE-GENERATE ────────────────────────────────────────────────────

router.post("/barcode-generate", ...toolMiddleware("barcode-generate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "barcode-generate", 2);
    if (!ok) return;
  }
  const barcodeData = (req.body.value ?? req.body.data ?? req.body.text ?? req.body.content) as string | undefined; // accept documented alias `content`
  const requestedType = String(req.body.type ?? req.body.format ?? "code128").toLowerCase();
  const type = requestedType === "code128" ? "code128" : requestedType;
  const { width = 250, height = 100 } = req.body as { width?: number; height?: number };
  if (!barcodeData) { res.status(400).json({ ok: false, error: "invalid_request", message: "data (or value) is required", request_id: reqId() }); return; }
  const validTypes = ["code128", "qr"];
  if (!validTypes.includes(type)) { res.status(400).json({ ok: false, error: "invalid_request", message: `type must be one of: ${validTypes.join(", ")}`, request_id: reqId() }); return; }
  try {
    // Generate Code128 SVG (simplified — bars based on char codes)
    const chars = barcodeData.slice(0, 80);
    const barWidth = Math.max(1, Math.floor((width - 20) / (chars.length * 11)));
    let bars = "";
    let x = 10;
    // Start quiet zone + start char pattern
    bars += `<rect x="${x}" y="10" width="${barWidth * 2}" height="${height - 20}" fill="#000"/>`;
    x += barWidth * 3;
    for (const ch of chars) {
      const code = ch.charCodeAt(0);
      // Simple encoding: alternate bars based on bit pattern of char code
      for (let bit = 6; bit >= 0; bit--) {
        const on = (code >> bit) & 1;
        if (on) bars += `<rect x="${x}" y="10" width="${barWidth}" height="${height - 20}" fill="#000"/>`;
        x += barWidth + 1;
      }
      x += 1;
    }
    // Stop bar
    bars += `<rect x="${x}" y="10" width="${barWidth * 2}" height="${height - 20}" fill="#000"/>`;
    const svgWidth = Math.max(x + 20, width);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${height}" viewBox="0 0 ${svgWidth} ${height}">
  <rect width="${svgWidth}" height="${height}" fill="#fff"/>
  ${bars}
  <text x="${svgWidth / 2}" y="${height - 2}" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">${escapeXml(chars)}</text>
</svg>`;
    const base64 = Buffer.from(svg).toString("base64");
    res.json({ ok: true, data: barcodeData, type, width: svgWidth, height, svg, data_url: `data:image/svg+xml;base64,${base64}`, note: "SVG barcode generated. For production use verify scanning with a barcode reader. Full Code128 encoding via bwip-js recommended for high-fidelity output.", request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "barcode_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 38. WORKFLOW-AGENT (multi-step pipeline) ─────────────────────────────────

router.post("/workflow-agent", ...toolMiddleware("workflow-agent"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "workflow-agent", 25);
    if (!ok) return;
  }
  if (!getAnthropic()) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const goal = req.body.goal ?? req.body.task ?? req.body.objective;
  const { context } = req.body as { context?: string };
  const requestedSteps = Number(req.body.steps ?? req.body.max_steps ?? 3);
  const stepCount = Number.isFinite(requestedSteps) ? Math.max(1, Math.min(10, Math.floor(requestedSteps))) : 3;
  if (!goal) { res.status(400).json({ ok: false, error: "invalid_request", message: "goal (or task/objective) is required", request_id: reqId() }); return; }
  try {
    const msg = await getAnthropic()!.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: `You are an autonomous agent. Complete this goal in ${stepCount} steps, then provide a final answer.\n\nGoal: ${goal}\n${context ? `Context: ${context}` : ""}\n\nReturn ONLY JSON:\n{"steps": [{"step": 1, "action": "...", "result": "..."}], "final_answer": "...", "success": true}`,
      }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const parsedText = extractJsonObject(raw);
    if (parsedText) {
      const parsed = JSON.parse(parsedText) as { steps?: unknown[]; final_answer?: string; success?: boolean };
      res.json({ ok: true, goal, steps: parsed.steps ?? [], final_answer: parsed.final_answer ?? "", success: parsed.success ?? true, request_id: reqId() });
      return;
    }
    res.json({
      ok: true,
      goal,
      steps: [{ step: 1, action: "model_response", result: raw.trim() }],
      final_answer: raw.trim(),
      success: true,
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "workflow_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 39. AI-ORACLE (premium reasoning endpoint) ──────────────────────────────

router.post("/ai-oracle", ...toolMiddleware("ai-oracle"), async (req: AuthedRequest, res: Response): Promise<void> => {
  // ── BYOK: check for user-provided API keys ──
  const oraclByokAnthropicKey = req.headers["x-anthropic-key"] as string | undefined;
  const oraclByokOpenaiKey = req.headers["x-openai-key"] as string | undefined;
  const oracleHasByok = !!(oraclByokAnthropicKey || oraclByokOpenaiKey);

  const paid = isX402Paid(req);
  // deep mode runs Opus (≈2× the Sonnet-tuned base); standard runs Sonnet (1×).
  const oracleModelForCost = (req.body as { reasoning_depth?: string })?.reasoning_depth === "deep"
    ? "claude-opus-4-6" : "claude-sonnet-4-6";
  const oracleCreditCost = applyModelCost(25, oracleModelForCost);
  if (!paid && !oracleHasByok) {
    const ok = await deductCredits(req, res, "ai-oracle", oracleCreditCost);
    if (!ok) return;
  }
  const { question, context: oracleContext, reasoning_depth = "standard" } = req.body as {
    question?: string;
    context?: string;
    reasoning_depth?: "standard" | "deep";
  };
  if (!question || typeof question !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "question is required", request_id: reqId() });
    return;
  }
  if (question.length > 10000) {
    res.status(400).json({ ok: false, error: "question_too_long", message: "question must be 10000 chars or less", request_id: reqId() });
    return;
  }
  const validDepths = ["standard", "deep"];
  if (!validDepths.includes(reasoning_depth)) {
    res.status(400).json({ ok: false, error: "invalid_reasoning_depth", message: `reasoning_depth must be one of: ${validDepths.join(", ")}`, request_id: reqId() });
    return;
  }

  const systemPrompt = "You are an expert analyst. Think step by step. Provide structured analysis with confidence levels. Always respond with valid JSON only, no markdown fences. Use this exact structure: {\"analysis\": \"<detailed analysis>\", \"confidence\": \"high\" | \"medium\" | \"low\"}";
  // x402 flat pricing gap (council finding 2026-07-27): the flat x402 price ($0.025)
  // covers the standard (Sonnet) depth; "deep" runs Opus (≈2× cost). Pin x402-paid
  // calls to standard so the flat price matches what's served; deep requires the
  // credits path (which charges applyModelCost(25, opus) = 50). Credits path unaffected.
  const effectiveDepth = paid && !oracleHasByok && reasoning_depth === "deep" ? "standard" : reasoning_depth;
  const maxTokens = effectiveDepth === "deep" ? 4096 : 2048;

  // Try Claude Opus first (most capable reasoning), then GPT-4o. When a caller
  // supplies BYOK headers, stay in BYOK mode; never fall through to platform
  // keys for a free response after a bad user key fails.
  const providers: Array<{ name: string; byok: boolean; fn: () => Promise<{ text: string; model: string; usage?: { input_tokens: number; output_tokens: number } }> }> = [];

  if (oraclByokAnthropicKey || (!oracleHasByok && getAnthropic())) {
    const oracleModel = effectiveDepth === "deep" ? "claude-opus-4-6" : "claude-sonnet-4-6";
    const anthKey = oraclByokAnthropicKey || process.env.ANTHROPIC_API_KEY!;
    providers.push({
      name: "anthropic",
      byok: !!oraclByokAnthropicKey,
      fn: async () => {
        const userContent = oracleContext
          ? `Context:\n${oracleContext.slice(0, 8000)}\n\nQuestion:\n${question}`
          : question;
        if (oraclByokAnthropicKey) {
          const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": anthKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: oracleModel, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userContent }] }) });
          const d = await r.json() as any;
          if (!r.ok) throw new Error(d?.error?.message || `Anthropic BYOK error ${r.status}`);
          const text = (d.content || []).find((b: any) => b.type === "text")?.text ?? "";
          return { text, model: oracleModel, usage: { input_tokens: d.usage?.input_tokens ?? 0, output_tokens: d.usage?.output_tokens ?? 0 } };
        }
        const msg = await getAnthropic()!.messages.create({ model: oracleModel, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userContent }] });
        const text = (msg.content as any[]).filter(b => b.type === "text").map(b => b.text).join("") ?? "";
        return { text, model: oracleModel, usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens } };
      },
    });
  }

  const openaiKey = oraclByokOpenaiKey || (!oracleHasByok ? process.env.OPENAI_API_KEY : undefined);
  if (openaiKey) {
    providers.push({
      name: "openai",
      byok: !!oraclByokOpenaiKey,
      fn: async () => {
        const userContent = oracleContext
          ? `Context:\n${oracleContext.slice(0, 8000)}\n\nQuestion:\n${question}`
          : question;
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
          }),
        });
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const text = data.choices?.[0]?.message?.content ?? "";
        return { text, model: "gpt-4o", usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 } };
      },
    });
  }

  if (providers.length === 0) {
    res.status(503).json({ ok: false, error: "service_unavailable", message: "AI Oracle requires ANTHROPIC_API_KEY or OPENAI_API_KEY to be configured.", request_id: reqId() });
    return;
  }

  let lastError: string = "";
  for (const provider of providers) {
    const providerName = provider.name;
    try {
      const result = await provider.fn();
      // Parse the JSON response from the model
      let analysis = result.text;
      let confidence: "high" | "medium" | "low" = "medium";
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { analysis?: string; confidence?: string };
          analysis = parsed.analysis ?? result.text;
          if (parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low") {
            confidence = parsed.confidence;
          }
        }
      } catch {
        // If JSON parsing fails, use the raw text as analysis
      }

      res.json({
        ok: true,
        analysis,
        confidence,
        model_used: result.model,
        reasoning_depth: effectiveDepth, // the depth actually served (x402 pin may downgrade deep → standard)
        reasoning_tokens: result.usage?.output_tokens ?? undefined,
        word_count: analysis.split(/\s+/).filter(Boolean).length,
        char_count: analysis.length,
        processed_at: new Date().toISOString(),
        arch_tools_version: "1.9.0",
        ...(provider.byok ? { byok: true, byok_provider: providerName } : {}),
        credits_used: oracleHasByok ? 0 : oracleCreditCost,
        request_id: reqId(),
      });
      return;
    } catch (e: any) {
      lastError = e.message ?? String(e);
      continue; // Try next provider
    }
  }

  res.status(502).json({ ok: false, error: "oracle_failed", message: `All providers failed. Last error: ${lastError}`, request_id: reqId() });
});

// ─── CRYPTO TOOLS ─────────────────────────────────────────────────────────────
// Helper: returns CoinGecko headers, including API key when configured
const cgHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { "Accept": "application/json", "User-Agent": "ArchTools/1.6" };
  const key = config.coingecko?.apiKey;
  if (key && key.length > 10 && !key.startsWith("REPLACE")) h["x-cg-pro-api-key"] = key;
  return h;
};
// Use pro endpoint when a CoinGecko API key is configured, otherwise fall back to free tier
const cgBase = (): string => {
  const key = config.coingecko?.apiKey;
  return (key && key.length > 10 && !key.startsWith("REPLACE"))
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";
};

// Ticker → CoinGecko slug map. Lets users pass BTC/ETH/etc and have it resolved
// to the canonical CoinGecko id. Slugs (e.g. "bitcoin") still pass through as-is.
const TICKER_TO_SLUG: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  xrp: "ripple",
  ada: "cardano",
  doge: "dogecoin",
  matic: "matic-network",
  avax: "avalanche-2",
  dot: "polkadot",
  link: "chainlink",
  uni: "uniswap",
  usdt: "tether",
  usdc: "usd-coin",
  bnb: "binancecoin",
  trx: "tron",
  shib: "shiba-inu",
  ltc: "litecoin",
  bch: "bitcoin-cash",
  atom: "cosmos",
  near: "near",
  fil: "filecoin",
  algo: "algorand",
  vet: "vechain",
  icp: "internet-computer",
  sand: "the-sandbox",
  mana: "decentraland",
  ftm: "fantom",
  hbar: "hedera-hashgraph",
  etc: "ethereum-classic",
  xlm: "stellar",
  aave: "aave",
  crv: "curve-dao-token",
  mkr: "maker",
  comp: "compound-governance-token",
  ldo: "lido-dao",
  arb: "arbitrum",
  op: "optimism",
};

// Normalize a user-provided token reference. If it looks like a ticker (all-caps
// original OR found in the ticker map), return the CoinGecko slug. Otherwise
// pass through as-is so existing slug inputs ("bitcoin") keep working.
const normalizeCoinId = (input: string): string => {
  if (!input) return input;
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const isAllCaps = raw === raw.toUpperCase() && /[A-Z]/.test(raw);
  if (isAllCaps && TICKER_TO_SLUG[lower]) return TICKER_TO_SLUG[lower];
  if (TICKER_TO_SLUG[lower]) return TICKER_TO_SLUG[lower];
  return lower;
};

// ─── crypto-price ────────────────────────────────────────────────────────────
router.post("/crypto-price", ...toolMiddleware("crypto-price"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-price", 1); if (!ok) return; }
  const body = req.body as { symbol?: string; coin?: string; currency?: string };
  const symbol = body.symbol ?? body.coin;
  const currency = body.currency ?? "usd";
  if (!symbol) { res.status(400).json({ ok: false, error: "invalid_request", message: "symbol (or coin) is required (e.g. bitcoin, ethereum)", request_id: reqId() }); return; }
  try {
    const id = normalizeCoinId(symbol);
    const r = await fetch(`${cgBase()}/simple/price?ids=${id}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`, { headers: cgHeaders() });
    if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `CoinGecko returned ${r.status}`, request_id: reqId() }); return; }
    const data = await r.json() as Record<string, Record<string, number>>;
    if (!data || !data[id]) {
      res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found or CoinGecko rate limit hit. Try again in a moment or use a Pro API key.`, request_id: reqId() });
      return;
    }
    const d = data[id];
    res.json({ ok: true, symbol: id, currency, price: d[currency], change_24h: d[`${currency}_24h_change`], market_cap: d[`${currency}_market_cap`], volume_24h: d[`${currency}_24h_vol`], data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-ohlcv ────────────────────────────────────────────────────────────
router.post("/crypto-ohlcv", ...toolMiddleware("crypto-ohlcv"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-ohlcv", 2); if (!ok) return; }
  const body = req.body as { symbol?: string; coin?: string; days?: number; currency?: string };
  const symbol = body.symbol ?? body.coin;
  const days = body.days ?? 7;
  const currency = body.currency ?? "usd";
  if (!symbol) { res.status(400).json({ ok: false, error: "invalid_request", message: "symbol (or coin) is required", request_id: reqId() }); return; }
  try {
    const id = normalizeCoinId(symbol);
    const r = await fetch(`${cgBase()}/coins/${id}/ohlc?vs_currency=${currency}&days=${days}`, { headers: cgHeaders() });
    if (!r.ok) { res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found`, request_id: reqId() }); return; }
    const raw = await r.json() as number[][];
    const candles = raw.map(([ts, o, h, l, c]) => ({ timestamp: ts, open: o, high: h, low: l, close: c }));
    res.json({ ok: true, symbol: id, currency, days, candles, count: candles.length, data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-market-cap ───────────────────────────────────────────────────────
router.post("/crypto-market-cap", ...toolMiddleware("crypto-market-cap"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-market-cap", 1); if (!ok) return; }
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const limit = parseInt(body.limit) || 10;
  const currency = (typeof body.currency === "string" && body.currency.trim()) ? body.currency.trim().toLowerCase() : "usd";
  try {
    const n = Math.min(Math.max(1, limit), 100);

    // Try CoinGecko with exponential backoff (Render IPs get rate-limited)
    const cgUrl = `${cgBase()}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${n}&page=1&sparkline=false`;
    const _cgHeaders = cgHeaders();
    type CgCoin = { id: string; symbol: string; name: string; current_price: number; market_cap: number; market_cap_rank: number; total_volume: number; price_change_percentage_24h: number };
    let cgData: CgCoin[] | null = null;

    for (const delay of [0, 1500, 3000]) {
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      try {
        const r = await fetch(cgUrl, { headers: _cgHeaders, signal: AbortSignal.timeout(8000) });
        if (r.ok) { cgData = (await r.json()) as CgCoin[]; break; }
        if (r.status === 429 || r.status === 503) continue; // rate limited — retry
        break; // other error — don't retry
      } catch { continue; }
    }

    if (cgData && Array.isArray(cgData) && cgData.length > 0) {
      const coins = cgData.map((c: CgCoin) => ({ rank: c.market_cap_rank, id: c.id, symbol: c.symbol, name: c.name, price: c.current_price, market_cap: c.market_cap, volume_24h: c.total_volume, change_24h: c.price_change_percentage_24h }));
      res.json({ ok: true, currency, coins, source: "coingecko", data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() }); return;
    }

    // Fallback: CoinCap API (no rate limit on cloud IPs)
    const ccUrl = `https://api.coincap.io/v2/assets?limit=${n}`;
    const ccResp = await fetch(ccUrl, { signal: AbortSignal.timeout(8000) });
    if (ccResp.ok) {
      const ccJson = await ccResp.json() as { data: { rank: string; id: string; symbol: string; name: string; priceUsd: string; marketCapUsd: string; volumeUsd24Hr: string; changePercent24Hr: string }[] };
      const coins = (ccJson.data || []).map(c => ({
        rank: parseInt(c.rank), id: c.id, symbol: c.symbol.toLowerCase(), name: c.name,
        price: parseFloat(c.priceUsd) || 0,
        market_cap: parseFloat(c.marketCapUsd) || 0,
        volume_24h: parseFloat(c.volumeUsd24Hr) || 0,
        change_24h: parseFloat(c.changePercent24Hr) || 0,
      }));
      res.json({ ok: true, currency: "usd", coins, source: "coincap_fallback", data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() }); return;
    }

    // Fallback 3: CryptoCompare (free, no key, different IP reputation)
    try {
      const ccmpUrl = `https://min-api.cryptocompare.com/data/top/mktcapfull?limit=${n}&tsym=USD`;
      const ccmpResp = await fetch(ccmpUrl, { signal: AbortSignal.timeout(8000) });
      if (ccmpResp.ok) {
        const ccmpJson = await ccmpResp.json() as { Data: any[] };
        const coins = (ccmpJson.Data || []).map((c: any, i: number) => ({
          rank: i + 1, id: (c.CoinInfo?.Name || "").toLowerCase(), symbol: (c.CoinInfo?.Name || "").toLowerCase(), name: c.CoinInfo?.FullName || "",
          price: c.RAW?.USD?.PRICE || 0,
          market_cap: c.RAW?.USD?.MKTCAP || 0,
          volume_24h: c.RAW?.USD?.TOTALVOLUME24HTO || 0,
          change_24h: c.RAW?.USD?.CHANGEPCT24HOUR || 0,
        }));
        res.json({ ok: true, currency: "usd", coins, source: "cryptocompare_fallback", data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() }); return;
      }
    } catch { /* fall through */ }

    res.status(502).json({ ok: false, error: "fetch_error", message: "All crypto data sources unavailable (CoinGecko, CoinCap, CryptoCompare). Try again shortly.", request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-fear-greed ───────────────────────────────────────────────────────
router.post("/crypto-fear-greed", ...toolMiddleware("crypto-fear-greed"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-fear-greed", 1); if (!ok) return; }
  const { limit = 7 } = req.body as { limit?: number };
  try {
    const n = Math.min(Math.max(1, limit), 30);
    const r = await fetch(`https://api.alternative.me/fng/?limit=${n}`);
    const data = await r.json() as { data: { value: string; value_classification: string; timestamp: string }[] };
    const history = data.data.map(d => ({ value: Number(d.value), classification: d.value_classification, date: new Date(Number(d.timestamp) * 1000).toISOString().split("T")[0] }));
    const latest = history[0];
    res.json({ ok: true, current: latest, history, interpretation: Number(latest.value) < 25 ? "Extreme Fear — potential buy signal for contrarians" : Number(latest.value) > 75 ? "Extreme Greed — potential sell signal" : "Neutral zone", data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-sentiment ────────────────────────────────────────────────────────
router.post("/crypto-sentiment", ...toolMiddleware("crypto-sentiment"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-sentiment", 2); if (!ok) return; }
  const { symbol } = req.body as { symbol?: string };
  if (!symbol) { res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required", request_id: reqId() }); return; }
  try {
    const id = symbol.toLowerCase().trim();
    const r = await fetch(`${cgBase()}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`, { headers: cgHeaders() });
    if (!r.ok) {
      console.warn(`[crypto-sentiment] CoinGecko returned ${r.status} for '${id}'`);
      if (r.status === 429) { res.status(429).json({ ok: false, error: "rate_limited", message: "CoinGecko rate limit hit. Try again in a moment.", request_id: reqId() }); return; }
      if (r.status === 403) { res.status(503).json({ ok: false, error: "tier_required", message: "This endpoint requires a paid CoinGecko plan.", request_id: reqId() }); return; }
      if (r.status === 404) { res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found on CoinGecko. Use full name (e.g. 'bitcoin', not 'BTC').`, request_id: reqId() }); return; }
      res.status(502).json({ ok: false, error: "upstream_error", message: `CoinGecko returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { sentiment_votes_up_percentage?: number; sentiment_votes_down_percentage?: number; community_data?: { twitter_followers?: number; reddit_subscribers?: number; reddit_active_accounts?: number }; market_data?: { price_change_percentage_24h?: number; price_change_percentage_7d?: number } };
    res.json({
      ok: true, symbol: id,
      sentiment: { votes_up_pct: data.sentiment_votes_up_percentage ?? null, votes_down_pct: data.sentiment_votes_down_percentage ?? null, overall: (data.sentiment_votes_up_percentage ?? 50) > 60 ? "bullish" : (data.sentiment_votes_up_percentage ?? 50) < 40 ? "bearish" : "neutral" },
      community: { twitter_followers: data.community_data?.twitter_followers ?? null, reddit_subscribers: data.community_data?.reddit_subscribers ?? null, reddit_active: data.community_data?.reddit_active_accounts ?? null },
      price_momentum: { change_24h: data.market_data?.price_change_percentage_24h ?? null, change_7d: data.market_data?.price_change_percentage_7d ?? null },
      data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms",
      request_id: reqId()
    });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-news ─────────────────────────────────────────────────────────────
router.post("/crypto-news", ...toolMiddleware("crypto-news"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-news", 2); if (!ok) return; }
  const body = req.body as { symbol?: string; coin?: string; limit?: number };
  const symbol = body.symbol ?? body.coin;
  const limit = body.limit ?? 10;
  const n = Math.min(Math.max(1, limit), 20);

  // Helper: parse RSS feed
  const parseRss = async (feedUrl: string, sourceName: string) => {
    const r = await fetch(feedUrl, { headers: { "User-Agent": "ArchTools/1.6" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items: { title: string; url: string; published_at: string; source: string }[] = [];
    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
    for (const item of itemMatches.slice(0, n)) {
      const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
      const link = item.match(/<link>(.*?)<\/link>|<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/)?.[1] ?? item.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/)?.[1] ?? "";
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
      if (title && link) items.push({ title: title.replace(/<[^>]+>/g, "").trim(), url: link.trim(), published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(), source: sourceName });
    }
    return items;
  };

  try {
    let articles: { title: string; url: string; published_at: string; source: string }[] = [];

    // Try CryptoPanic paid key first (if configured)
    const cpKey = process.env.CRYPTOPANIC_API_KEY;
    if (cpKey) {
      const cpUrl = symbol
        ? `https://cryptopanic.com/api/v1/posts/?auth_token=${cpKey}&currencies=${symbol.toUpperCase()}&limit=${n}&public=true`
        : `https://cryptopanic.com/api/v1/posts/?auth_token=${cpKey}&limit=${n}&public=true`;
      const r = await fetch(cpUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json() as { results?: { title: string; url: string; published_at: string; source?: { title?: string } }[] };
        articles = (data.results ?? []).map(a => ({ title: a.title, url: a.url, published_at: a.published_at, source: a.source?.title ?? "CryptoPanic" }));
      }
    }

    // RSS fallback: CoinDesk + CoinTelegraph + Bitcoin Magazine (always available, no key needed)
    if (articles.length === 0) {
      const feeds = [
        { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", name: "CoinDesk" },
        { url: "https://cointelegraph.com/rss", name: "CoinTelegraph" },
        { url: "https://bitcoinmagazine.com/.rss/full/", name: "Bitcoin Magazine" },
      ];
      const results = await Promise.allSettled(feeds.map(f => parseRss(f.url, f.name)));
      for (const r of results) {
        if (r.status === "fulfilled") articles.push(...r.value);
      }
      // Filter by symbol if provided. Match either the raw input or its CoinGecko slug
      // form, so users passing "BTC" still match articles mentioning "bitcoin".
      if (symbol && articles.length > 0) {
        const q = symbol.toLowerCase().trim();
        const slug = normalizeCoinId(symbol);
        const filtered = articles.filter(a => {
          const t = a.title.toLowerCase();
          return t.includes(q) || (slug && slug !== q && t.includes(slug));
        });
        if (filtered.length > 0) articles = filtered;
      }
      articles = articles.slice(0, n);
    }

    res.json({ ok: true, symbol: symbol ?? "all", articles, count: articles.length, data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── token-lookup ─────────────────────────────────────────────────────────────
router.post("/token-lookup", ...toolMiddleware("token-lookup"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "token-lookup", 1); if (!ok) return; }
  const query = (req.body.query ?? req.body.text ?? req.body.symbol) as string | undefined;
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query (or text/symbol) is required", request_id: reqId() }); return; }
  try {
    const r = await fetch(`${cgBase()}/search?query=${encodeURIComponent(query)}`, { headers: cgHeaders() });
    if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `CoinGecko returned ${r.status}`, request_id: reqId() }); return; }
    const data = await r.json() as { coins?: { id: string; name: string; symbol: string; market_cap_rank?: number; thumb?: string }[] };
    const coins = (data.coins ?? []).slice(0, 10).map(c => ({ id: c.id, name: c.name, symbol: c.symbol.toUpperCase(), market_cap_rank: c.market_cap_rank ?? null }));
    res.json({ ok: true, query, results: coins, count: coins.length, tip: "Use the 'id' field with other crypto tools (e.g. crypto-price)", data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com", data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms", request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── text-to-speech ───────────────────────────────────────────────────────────
router.post("/text-to-speech", ...toolMiddleware("text-to-speech"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const { text, voice_id = "EXAVITQu4vr4xnSDxMaL", model_id = "eleven_turbo_v2_5", stability = 0.5, similarity_boost = 0.75 } = req.body as { text?: string; voice_id?: string; model_id?: string; stability?: number; similarity_boost?: number };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  if (text.length > 5000) { res.status(400).json({ ok: false, error: "invalid_request", message: "text must be 5000 chars or less", request_id: reqId() }); return; }
  // voice_id is interpolated into the ElevenLabs URL path — restrict to a safe charset.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(voice_id))) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "voice_id must be alphanumeric (letters, digits, _ or -)", request_id: reqId() }); return;
  }
  const paid = isX402Paid(req);
  if (!paid) {
    // Metered by length: 25 base + 8 credits per 100 chars (covers ElevenLabs COGS)
    const ttsCost = 25 + 8 * Math.ceil(text.length / 100);
    const ok = await deductCredits(req, res, "text-to-speech", ttsCost);
    if (!ok) return;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Text-to-speech not configured", request_id: reqId() }); return; }
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({ text, model_id, voice_settings: { stability, similarity_boost } })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error("[text-to-speech] ElevenLabs error:", r.status, err);
      res.status(502).json({ ok: false, error: "tts_error", message: `ElevenLabs returned ${r.status}`, request_id: reqId() }); return;
    }
    const buf = await r.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    res.json({ ok: true, audio_base64: b64, mime_type: "audio/mpeg", voice_id, model_id, char_count: text.length, request_id: reqId() });
  } catch (e) { console.error("[text-to-speech]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── transcribe-audio ─────────────────────────────────────────────────────────
router.post("/transcribe-audio", ...toolMiddleware("transcribe-audio"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "transcribe-audio", 25); if (!ok) return; }
  const { audio_url, language, prompt: whisperPrompt } = req.body as { audio_url?: string; language?: string; prompt?: string };
  if (!audio_url) { res.status(400).json({ ok: false, error: "invalid_request", message: "audio_url is required", request_id: reqId() }); return; }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Transcription not configured", request_id: reqId() }); return; }
  try { await validateUrl(audio_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    // Fetch audio file (60s timeout for large files). safeFetch re-validates
    // every redirect hop to prevent SSRF via attacker-controlled redirects.
    const audioResp = await safeFetch(audio_url, { signal: AbortSignal.timeout(60000) });
    if (!audioResp.ok) { res.status(400).json({ ok: false, error: "fetch_error", message: `Could not fetch audio URL (${audioResp.status})`, request_id: reqId() }); return; }
    const audioBuffer = await readArrayBufferWithLimit(audioResp, MAX_TRANSCRIBE_AUDIO_BYTES);
    const contentType = audioResp.headers.get("content-type") ?? "audio/mpeg";
    const ext = contentType.includes("wav") ? "wav" : contentType.includes("ogg") ? "ogg" : contentType.includes("webm") ? "webm" : contentType.includes("mp4") ? "mp4" : "mp3";

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: contentType }), `audio.${ext}`);
    formData.append("model", "whisper-1");
    if (language) formData.append("language", language);
    if (whisperPrompt) formData.append("prompt", whisperPrompt);
    formData.append("response_format", "verbose_json");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}` },
      body: formData
    });
    if (!r.ok) {
      const err = await r.text();
      console.error("[transcribe-audio] OpenAI error:", r.status, err);
      res.status(502).json({ ok: false, error: "transcription_error", message: `OpenAI returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { text: string; language?: string; duration?: number; segments?: unknown[] };
    res.json({ ok: true, transcript: data.text, language: data.language ?? language ?? null, duration_seconds: data.duration ?? null, request_id: reqId() });
  } catch (e: any) {
    console.error("[transcribe-audio]", e);
    if (e instanceof ResponseTooLargeError) {
      res.status(413).json({ ok: false, error: "audio_too_large", message: `Audio file exceeds ${MAX_TRANSCRIBE_AUDIO_BYTES} byte limit. Try a smaller file.`, request_id: reqId() });
    } else if (e?.name === "TimeoutError" || e?.name === "AbortError" || String(e?.message).includes("timeout")) {
      res.status(504).json({ ok: false, error: "timeout", message: "Audio file fetch or transcription timed out. Try a smaller file or a faster URL.", request_id: reqId() });
    } else {
      res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() });
    }
  }
});

// ─── email-send ───────────────────────────────────────────────────────────────
router.post("/email-send", ...toolMiddleware("email-send"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const withinLimit = await enforceDailyToolLimit(req, res, "email-send");
    if (!withinLimit) return;
    const ok = await deductCredits(req, res, "email-send", 3);
    if (!ok) return;
  }
  const { to, subject, body, from, html } = req.body as { to?: string; subject?: string; body?: string; from?: string; html?: string };
  if (!to || !subject || (!body && !html)) { res.status(400).json({ ok: false, error: "invalid_request", message: "to, subject, and body (or html) are required", request_id: reqId() }); return; }
  if (!to.includes("@")) { res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid email address", request_id: reqId() }); return; }
  if (/[,\n\r]/.test(to)) { res.status(400).json({ ok: false, error: "invalid_request", message: "Only one recipient is allowed", request_id: reqId() }); return; }
  if (subject.length > 200) { res.status(400).json({ ok: false, error: "invalid_request", message: "subject must be 200 characters or less", request_id: reqId() }); return; }
  // CAN-SPAM / anti-abuse (legal audit 2026-07-27): the per-agent daily limit doesn't
  // stop one address being hammered across many agents. Cap sends per RECIPIENT and log
  // every send (hashed recipient + agent) for an abuse trail. In-memory + per-instance
  // is a reasonable first control; a shared store can back it later.
  {
    const recip = to.toLowerCase().trim();
    if (!emailRecipientGate(recip)) {
      res.status(429).json({ ok: false, error: "recipient_rate_limited", message: `This recipient has received the maximum ${EMAIL_RECIPIENT_DAILY_CAP} messages today via Arch Tools — a limit that protects against spam (CAN-SPAM).`, request_id: reqId() });
      return;
    }
    console.info(`[email-send] agent=${req.agent?.id ?? "?"} recipient_hash=${recipientHash(recip)} at=${new Date().toISOString()}`);
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Email sending not configured", request_id: reqId() }); return; }
  try {
    const fromAddr = process.env.ALLOW_CUSTOM_EMAIL_FROM === "true" && from ? from : getDefaultSender();
    const { htmlBody, textBody } = sanitizeOutboundEmailHtml(html, body);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddr, to: [to], subject, html: htmlBody, text: textBody })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { message?: string };
      console.error("[email-send] Resend error:", r.status, err);
      res.status(502).json({ ok: false, error: "send_error", message: err.message ?? `Resend returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { id?: string };
    res.json({ ok: true, message_id: data.id ?? null, to, subject, from: fromAddr, request_id: reqId() });
  } catch (e) { console.error("[email-send]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});



// ─── send-email (alias — same logic as email-send) ────────────────────────────
router.post("/send-email", ...toolMiddleware("send-email"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const withinLimit = await enforceDailyToolLimit(req, res, "send-email");
    if (!withinLimit) return;
    const ok = await deductCredits(req, res, "send-email", 3);
    if (!ok) return;
  }
  const { to, subject, body, from, html } = req.body as { to?: string; subject?: string; body?: string; from?: string; html?: string };
  if (!to || !subject || (!body && !html)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "to, subject, and body (or html) are required", request_id: reqId() }); return;
  }
  if (!to.includes("@")) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid email address", request_id: reqId() }); return;
  }
  if (/[,\n\r]/.test(to)) { res.status(400).json({ ok: false, error: "invalid_request", message: "Only one recipient is allowed", request_id: reqId() }); return; }
  if (subject.length > 200) { res.status(400).json({ ok: false, error: "invalid_request", message: "subject must be 200 characters or less", request_id: reqId() }); return; }
  // CAN-SPAM / anti-abuse (legal audit 2026-07-27): the per-agent daily limit doesn't
  // stop one address being hammered across many agents. Cap sends per RECIPIENT and log
  // every send (hashed recipient + agent) for an abuse trail. In-memory + per-instance
  // is a reasonable first control; a shared store can back it later.
  {
    const recip = to.toLowerCase().trim();
    if (!emailRecipientGate(recip)) {
      res.status(429).json({ ok: false, error: "recipient_rate_limited", message: `This recipient has received the maximum ${EMAIL_RECIPIENT_DAILY_CAP} messages today via Arch Tools — a limit that protects against spam (CAN-SPAM).`, request_id: reqId() });
      return;
    }
    console.info(`[email-send] agent=${req.agent?.id ?? "?"} recipient_hash=${recipientHash(recip)} at=${new Date().toISOString()}`);
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    res.status(503).json({ ok: false, error: "not_configured", message: "Email sending not configured", request_id: reqId() }); return;
  }
  try {
    const fromAddr = process.env.ALLOW_CUSTOM_EMAIL_FROM === "true" && from ? from : getDefaultSender();
    const { htmlBody, textBody } = sanitizeOutboundEmailHtml(html, body);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddr, to: [to], subject, html: htmlBody, text: textBody })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { message?: string };
      res.status(502).json({ ok: false, error: "send_error", message: err.message ?? `Resend returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { id?: string };
    res.json({ ok: true, message_id: data.id ?? null, to, subject, from: fromAddr, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── design-create ────────────────────────────────────────────────────────────
router.post("/design-create", ...toolMiddleware("design-create"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  const { prompt, size = "1024x1024", quality = "medium", n = 1 } = req.body as { prompt?: string; size?: string; quality?: string; n?: number };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  { const _mod = moderateGenerationPrompt(prompt); if (!_mod.allowed) { console.warn(`[moderation] blocked category=${_mod.category} tool=design-create`); res.status(400).json({ ok: false, error: "content_policy", category: _mod.category, message: _mod.reason, request_id: reqId() }); return; } }
  const validSizes = ["1024x1024", "1792x1024", "1024x1792"];
  let safeSize = validSizes.includes(size) ? size : "1024x1024";
  // gpt-image-1 quality → cost (profitability audit 2026-07-27): low ≈ $0.011,
  // medium ≈ $0.042, high ≈ $0.167 per 1024². Map anything unrecognized (incl. the
  // ambiguous "auto") to medium so the price is always known.
  const qualityMap: Record<string, string> = { standard: "medium", hd: "high", vivid: "medium", natural: "medium" };
  let safeQuality = ["low", "medium", "high"].includes(quality) ? quality : (qualityMap[quality] ?? "medium");
  // x402 is a FLAT price ($0.055 = medium quality @ 1024²). Pin x402-paid calls to
  // that base tier — high quality (≈$0.167) and non-square sizes (~1.5× cost) can't be
  // gotten at the medium/base flat price; they require the credits path, which charges
  // the higher tier below (council finding 2026-07-27: n is already hard-capped to 1).
  if (paid) { if (safeQuality === "high") safeQuality = "medium"; safeSize = "1024x1024"; }
  const sizeMult = safeSize === "1024x1024" ? 1 : 1.5;
  const designCredits = Math.ceil((safeQuality === "high" ? 180 : safeQuality === "low" ? 15 : 50) * sizeMult);
  if (!paid) { const ok = await deductCredits(req, res, "design-create", designCredits); if (!ok) return; }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Image generation not configured", request_id: reqId() }); return; }
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: safeSize, quality: safeQuality, n: Math.min(n, 1) })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { error?: { message?: string } };
      console.error("[design-create] OpenAI error:", r.status, err);
      // Fallback: Stability AI
      if (process.env.STABILITY_API_KEY) {
        try {
          const sr = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY}`, Accept: "application/json" },
            body: (() => { const fd = new FormData(); fd.append("prompt", prompt); fd.append("aspect_ratio", "1:1"); fd.append("output_format", "webp"); return fd; })(),
          });
          if (sr.ok) {
            const sd = await sr.json() as { image?: string };
            if (sd.image) {
              res.json({ ok: true, images: [{ url: `data:image/webp;base64,${sd.image}`, revised_prompt: null }], count: 1, size: "1024x1024", quality: safeQuality, source: "stability", request_id: reqId() }); return;
            }
          }
        } catch (_) { /* fall through */ }
      }
      res.status(502).json({ ok: false, error: "generation_error", message: err.error?.message ?? `OpenAI returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { data?: { url: string; revised_prompt?: string }[] };
    const images = (data.data ?? []).map(img => ({ url: img.url, revised_prompt: img.revised_prompt ?? null }));
    res.json({ ok: true, images, count: images.length, size: safeSize, quality: safeQuality, request_id: reqId() });
  } catch (e) { console.error("[design-create]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── domain-check ─────────────────────────────────────────────────────────────
router.post("/domain-check", ...toolMiddleware("domain-check"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "domain-check", 2); if (!ok) return; }
  const { domain } = req.body as { domain?: string };
  if (!domain) { res.status(400).json({ ok: false, error: "invalid_request", message: "domain is required", request_id: reqId() }); return; }
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  try {
    // RDAP lookup — if 404 the domain is available; if 200 it's registered
    const tld = clean.split(".").pop() ?? "";
    const rdapBase: Record<string, string> = {
      com: "https://rdap.verisign.com/com/v1/domain/",
      net: "https://rdap.verisign.com/net/v1/domain/",
      org: "https://rdap.publicinterestregistry.org/rdap/domain/",
      io: "https://rdap.nic.io/domain/",
      dev: "https://pubapi.registry.google/rdap/domain/",
      app: "https://pubapi.registry.google/rdap/domain/",
      ai: "https://rdap.nic.ai/v1/domain/",
    };
    const base = rdapBase[tld] ?? `https://rdap.org/domain/`;
    const r = await fetch(`${base}${clean}`, { signal: AbortSignal.timeout(8000), headers: { "Accept": "application/json" } });
    if (r.status === 404) {
      res.json({ ok: true, domain: clean, available: true, registered: false, request_id: reqId() }); return;
    }
    if (!r.ok) {
      // Try fallback RDAP
      const r2 = await fetch(`https://rdap.org/domain/${clean}`, { signal: AbortSignal.timeout(8000) });
      if (r2.status === 404) {
        res.json({ ok: true, domain: clean, available: true, registered: false, request_id: reqId() }); return;
      }
      if (!r2.ok) {
        res.json({ ok: true, domain: clean, available: null, registered: null, note: "RDAP lookup failed — domain may or may not be available", request_id: reqId() }); return;
      }
    }
    const data = await (r.ok ? r : (await fetch(`https://rdap.org/domain/${clean}`))).json() as {
      ldhName?: string; status?: string[]; events?: { eventAction: string; eventDate: string }[];
      entities?: { roles?: string[]; vcardArray?: unknown[] }[];
      nameservers?: { ldhName: string }[];
    };
    const registered = r.ok || true;
    const registrationDate = data.events?.find(e => e.eventAction === "registration")?.eventDate ?? null;
    const expirationDate = data.events?.find(e => e.eventAction === "expiration")?.eventDate ?? null;
    const updatedDate = data.events?.find(e => e.eventAction === "last changed")?.eventDate ?? null;
    const nameservers = (data.nameservers ?? []).map(ns => ns.ldhName?.toLowerCase());
    const status = data.status ?? [];
    const registrantEntity = data.entities?.find(e => e.roles?.includes("registrant"));
    res.json({
      ok: true, domain: clean, available: false, registered: true,
      status, registration_date: registrationDate, expiration_date: expirationDate, updated_date: updatedDate,
      nameservers, has_registrant: !!registrantEntity,
      request_id: reqId()
    });
  } catch (e) { console.error("[domain-check]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── Route aliases (DB name → actual route) ──────────────────────────────────
// DB has "generate-image" but route is /design-create
router.post("/generate-image", ...toolMiddleware("design-create"), async (req: AuthedRequest, res: Response): Promise<void> => {
  req.url = "/design-create";
  const paid = isX402Paid(req);
  const { prompt, size = "1024x1024", quality = "medium" } = req.body as { prompt?: string; size?: string; quality?: string };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  { const _mod = moderateGenerationPrompt(prompt); if (!_mod.allowed) { console.warn(`[moderation] blocked category=${_mod.category} tool=generate-image`); res.status(400).json({ ok: false, error: "content_policy", category: _mod.category, message: _mod.reason, request_id: reqId() }); return; } }
  const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
  if (!OPENAI_KEY) { res.status(503).json({ ok: false, error: "service_unavailable", message: "Image generation not configured.", request_id: reqId() }); return; }
  const validSizes = ["1024x1024", "1792x1024", "1024x1792"];
  let safeSize = validSizes.includes(size) ? size : "1024x1024";
  const qualityMap: Record<string, string> = { standard: "medium", hd: "high", vivid: "medium", natural: "medium" };
  let safeQuality = ["low", "medium", "high"].includes(quality) ? quality : (qualityMap[quality] ?? "medium");
  // Quality+size-aware pricing + x402 base-tier pin — same as /design-create (its alias).
  if (paid) { if (safeQuality === "high") safeQuality = "medium"; safeSize = "1024x1024"; }
  const sizeMult = safeSize === "1024x1024" ? 1 : 1.5;
  const designCredits = Math.ceil((safeQuality === "high" ? 180 : safeQuality === "low" ? 15 : 50) * sizeMult);
  if (!paid) { const ok = await deductCredits(req, res, "design-create", designCredits); if (!ok) return; }
  try {
    const r = await axios.post("https://api.openai.com/v1/images/generations",
      { model: "gpt-image-1", prompt, n: 1, size: safeSize, quality: safeQuality },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" }, timeout: 60000 }
    );
    const img = (r.data as { data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }).data[0];
    const image_url = img.url ?? (img.b64_json ? `data:image/png;base64,${img.b64_json}` : null);
    res.json({ ok: true, image_url, revised_prompt: img.revised_prompt ?? null, size: safeSize, quality: safeQuality, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "generation_failed", message: safeErr(e), request_id: reqId() }); }
});

// DB has "check-domain" but route is /domain-check
router.post("/check-domain", ...toolMiddleware("domain-check"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "domain-check", 2); if (!ok) return; }
  const { domain } = req.body as { domain?: string };
  if (!domain) { res.status(400).json({ ok: false, error: "invalid_request", message: "domain is required", request_id: reqId() }); return; }
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  try {
    const r = await axios.get(`https://rdap.org/domain/${clean}`, { timeout: 10000, headers: { Accept: "application/json" } });
    const d = r.data as Record<string, unknown>;
    const events = (d.events as Array<{ eventAction: string; eventDate: string }>) ?? [];
    const registrar = ((d.entities as Array<Record<string, unknown>>) ?? []).find(e => ((e.roles as string[]) ?? []).includes("registrar"));
    res.json({
      ok: true, domain: clean, available: false,
      registrar: (() => { const vcard = (registrar?.vcardArray as Array<unknown[]>)?.[1]; const fn = vcard?.find((v: unknown) => Array.isArray(v) && (v as unknown[])[0] === "fn"); return fn ? (fn as unknown[])[3] ?? null : null; })(),
      expiry_date: events.find(e => e.eventAction === "expiration")?.eventDate ?? null,
      status: d.status ?? [], credits_used: 2, request_id: reqId()
    });
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      res.json({ ok: true, domain: clean, available: true, registrar: null, expiry_date: null, status: ["available"], credits_used: 2, request_id: reqId() });
    } else {
      res.status(502).json({ ok: false, error: "lookup_failed", message: safeErr(e), request_id: reqId() });
    }
  }
});

// ─── 51. NEWS-SEARCH ──────────────────────────────────────────────────────────
router.post("/news-search", ...toolMiddleware("news-search"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "news-search", 12); if (!ok) return; }
  const query = String(req.body.query ?? req.query.query ?? "").trim();
  const limit = Math.min(Number(req.body.limit ?? req.query.limit ?? 5), 10);
  if (!query) return void res.status(400).json({ ok: false, error: "missing_param", message: "query is required" });

  // BYOK: check for user-provided search keys
  const byokBraveKeyNews = req.headers["x-brave-key"] as string | undefined;
  const byokTavilyKeyNews = req.headers["x-tavily-key"] as string | undefined;

  // Try Brave News first (BYOK first, then platform key)
  const braveKey = byokBraveKeyNews || process.env.BRAVE_SEARCH_API_KEY;
  const tavilyKey = byokTavilyKeyNews || process.env.TAVILY_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (braveKey) {
    if (byokBraveKeyNews) console.log(`[BYOK] news-search using user-provided brave key`);
    try {
      const r = await axios.get("https://api.search.brave.com/res/v1/news/search", {
        params: { q: query, count: limit, safesearch: "off" },
        headers: { "Accept": "application/json", "X-Subscription-Token": braveKey },
        timeout: 10000
      });
      const results = ((r.data as { results?: Array<{ title: string; url: string; description?: string; age?: string; source?: { name?: string } }> }).results ?? []).slice(0, limit).map(a => ({
        title: a.title, url: a.url, description: a.description ?? "", published: a.age ?? null, source: a.source?.name ?? null
      }));
      return void res.json({ ok: true, query, results, source: "brave", credits_used: 12, ...(byokBraveKeyNews ? { byok: true, byok_provider: "brave" } : {}), request_id: reqId() });
    } catch (_) { /* fall through to Tavily */ }
  }

  if (tavilyKey) {
    if (byokTavilyKeyNews) console.log(`[BYOK] news-search using user-provided tavily key`);
    try {
      const r = await axios.post("https://api.tavily.com/search", {
        api_key: tavilyKey, query, topic: "news", max_results: limit, include_answer: false
      }, { timeout: 10000 });
      const results = ((r.data as { results?: Array<{ title: string; url: string; content?: string; published_date?: string; source?: string }> }).results ?? []).slice(0, limit).map(a => ({
        title: a.title, url: a.url, description: a.content ?? "", published: a.published_date ?? null, source: a.source ?? null
      }));
      return void res.json({ ok: true, query, results, source: "tavily", credits_used: 12, ...(byokTavilyKeyNews ? { byok: true, byok_provider: "tavily" } : {}), request_id: reqId() });
    } catch (_) { /* fall through to Serper */ }
  }

  if (serperKey) {
    try {
      const r = await axios.post("https://google.serper.dev/news", { q: query, num: limit }, {
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" }, timeout: 10000
      });
      const results = ((r.data as { news?: Array<{ title: string; link: string; snippet?: string; date?: string; source?: string }> }).news ?? []).slice(0, limit).map(a => ({
        title: a.title, url: a.link, description: a.snippet ?? "", published: a.date ?? null, source: a.source ?? null
      }));
      return void res.json({ ok: true, query, results, source: "serper", credits_used: 12, request_id: reqId() });
    } catch (e) {
      return void res.status(502).json({ ok: false, error: "search_failed", message: safeErr(e), request_id: reqId() });
    }
  }

  return void res.status(503).json({ ok: false, error: "no_provider", message: "No news search provider configured", request_id: reqId() });
});

// ─── 52. RESEARCH-REPORT ─────────────────────────────────────────────────────
router.post("/research-report", ...toolMiddleware("research-report"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  // Report exactly what was deducted (0 for x402-paid, BYOK-discounted otherwise) —
  // the flat 15 this used to advertise predates the 2026-07-27 pricing audit (40 base).
  const researchReportCost = paid ? 0 : byokAdjustedCost(req, 40, ["x-brave-key", "x-tavily-key", "x-anthropic-key"]);
  if (!paid) { const ok = await deductCredits(req, res, "research-report", researchReportCost); if (!ok) return; }
  const query = String(req.body.query ?? req.body.topic ?? req.query.query ?? req.query.topic ?? "").trim();
  const depth = String(req.body.depth ?? req.query.depth ?? "standard").toLowerCase();
  if (!query) return void res.status(400).json({ ok: false, error: "missing_param", message: "query is required" });

  // BYOK: check for user-provided search keys
  const byokBraveKeyRR = req.headers["x-brave-key"] as string | undefined;
  const byokTavilyKeyRR = req.headers["x-tavily-key"] as string | undefined;
  const byokAnthropicKeyRR = req.headers["x-anthropic-key"] as string | undefined;

  const braveKey = byokBraveKeyRR || process.env.BRAVE_SEARCH_API_KEY;
  const tavilyKey = byokTavilyKeyRR || process.env.TAVILY_API_KEY;
  const anthropicKey = byokAnthropicKeyRR || process.env.ANTHROPIC_API_KEY;
  const numResults = depth === "deep" ? 10 : 5;
  const rrHasByok = !!(byokBraveKeyRR || byokTavilyKeyRR || byokAnthropicKeyRR);

  // Step 1: Gather search results
  let searchResults: Array<{ title: string; url: string; description: string }> = [];
  let rrSearchProvider = "";

  if (tavilyKey) {
    if (byokTavilyKeyRR) console.log(`[BYOK] research-report using user-provided tavily key`);
    try {
      const r = await axios.post("https://api.tavily.com/search", {
        api_key: tavilyKey, query, max_results: numResults, include_answer: true, search_depth: depth === "deep" ? "advanced" : "basic"
      }, { timeout: 15000 });
      searchResults = ((r.data as { results?: Array<{ title: string; url: string; content?: string }> }).results ?? []).map(a => ({
        title: a.title, url: a.url, description: a.content ?? ""
      }));
      if (searchResults.length > 0) rrSearchProvider = "tavily";
    } catch (_) { /* try Brave */ }
  }

  if (searchResults.length === 0 && braveKey) {
    if (byokBraveKeyRR) console.log(`[BYOK] research-report using user-provided brave key`);
    try {
      const r = await axios.get("https://api.search.brave.com/res/v1/web/search", {
        params: { q: query, count: numResults, safesearch: "off" },
        headers: { "Accept": "application/json", "X-Subscription-Token": braveKey },
        timeout: 10000
      });
      searchResults = ((r.data as { web?: { results?: Array<{ title: string; url: string; description?: string }> } }).web?.results ?? []).map(a => ({
        title: a.title, url: a.url, description: a.description ?? ""
      }));
      if (searchResults.length > 0) rrSearchProvider = "brave";
    } catch (_) { /* fall through */ }
  }

  if (searchResults.length === 0) {
    return void res.status(502).json({ ok: false, error: "search_failed", message: "No search results available", request_id: reqId() });
  }

  // Step 2: Synthesize with Claude
  if (!anthropicKey) {
    return void res.json({ ok: true, query, sources: searchResults, report: null, message: "Search results only — Anthropic key not configured. Pass x-anthropic-key header for BYOK.", credits_used: researchReportCost, ...(rrHasByok ? { byok: true, byok_provider: rrSearchProvider || "unknown" } : {}), request_id: reqId() });
  }

  const sourcesText = searchResults.map((s, i) => `[${i+1}] ${s.title}\n${s.url}\n${s.description}`).join("\n\n");
  const systemPrompt = `You are a research analyst. Write a concise, well-structured research report based on the provided sources. Include: an executive summary, key findings, and a conclusion. Cite sources using [N] notation. Be factual and objective.`;
  const userPrompt = `Research query: "${query}"\n\nSources:\n${sourcesText}\n\nWrite a ${depth === "deep" ? "comprehensive" : "concise"} research report.`;

  try {
    const claude = await axios.post("https://api.anthropic.com/v1/messages", {
      model: "claude-haiku-4-5", max_tokens: depth === "deep" ? 2000 : 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    }, {
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      timeout: 30000
    });
    const report = ((claude.data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "").trim();
    return void res.json({ ok: true, query, depth, report, sources: searchResults, credits_used: researchReportCost, ...(rrHasByok ? { byok: true, byok_provider: byokAnthropicKeyRR ? "anthropic" : rrSearchProvider } : {}), request_id: reqId() });
  } catch (e) {
    return void res.status(502).json({ ok: false, error: "synthesis_failed", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 53. FACT-CHECK ───────────────────────────────────────────────────────────
router.post("/fact-check", ...toolMiddleware("fact-check"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "fact-check", 14); if (!ok) return; }
  const claim = String(req.body.claim ?? req.query.claim ?? "").trim();
  if (!claim) return void res.status(400).json({ ok: false, error: "missing_param", message: "claim is required" });

  // BYOK: check for user-provided search keys
  const byokBraveKeyFC = req.headers["x-brave-key"] as string | undefined;
  const byokTavilyKeyFC = req.headers["x-tavily-key"] as string | undefined;
  const byokAnthropicKeyFC = req.headers["x-anthropic-key"] as string | undefined;

  const braveKey = byokBraveKeyFC || process.env.BRAVE_SEARCH_API_KEY;
  const tavilyKey = byokTavilyKeyFC || process.env.TAVILY_API_KEY;
  const anthropicKey = byokAnthropicKeyFC || process.env.ANTHROPIC_API_KEY;
  const fcHasByok = !!(byokBraveKeyFC || byokTavilyKeyFC || byokAnthropicKeyFC);
  let fcSearchProvider = "";

  // Step 1: Search for evidence
  let evidence: Array<{ title: string; url: string; description: string }> = [];

  if (tavilyKey) {
    if (byokTavilyKeyFC) console.log(`[BYOK] fact-check using user-provided tavily key`);
    try {
      const r = await axios.post("https://api.tavily.com/search", {
        api_key: tavilyKey, query: `fact check: ${claim}`, max_results: 8, include_answer: false, search_depth: "advanced"
      }, { timeout: 12000 });
      evidence = ((r.data as { results?: Array<{ title: string; url: string; content?: string }> }).results ?? []).map(a => ({
        title: a.title, url: a.url, description: a.content ?? ""
      }));
      if (evidence.length > 0) fcSearchProvider = "tavily";
    } catch (_) { /* try Brave */ }
  }

  if (evidence.length === 0 && braveKey) {
    if (byokBraveKeyFC) console.log(`[BYOK] fact-check using user-provided brave key`);
    try {
      const r = await axios.get("https://api.search.brave.com/res/v1/web/search", {
        params: { q: `fact check "${claim}"`, count: 8, safesearch: "off" },
        headers: { "Accept": "application/json", "X-Subscription-Token": braveKey },
        timeout: 10000
      });
      evidence = ((r.data as { web?: { results?: Array<{ title: string; url: string; description?: string }> } }).web?.results ?? []).map(a => ({
        title: a.title, url: a.url, description: a.description ?? ""
      }));
      if (evidence.length > 0) fcSearchProvider = "brave";
    } catch (_) { /* fall through */ }
  }

  if (!anthropicKey) {
    return void res.json({ ok: true, claim, verdict: null, confidence: null, evidence, message: "Evidence only — Anthropic key not configured. Pass x-anthropic-key header for BYOK.", credits_used: 14, ...(fcHasByok ? { byok: true, byok_provider: fcSearchProvider || "unknown" } : {}), request_id: reqId() });
  }

  // Step 2: Analyze with Claude
  const evidenceText = evidence.map((e, i) => `[${i+1}] ${e.title}\n${e.url}\n${e.description}`).join("\n\n");
  const systemPrompt = `You are a professional fact-checker. Analyze the provided claim and evidence to determine its accuracy. Respond in JSON with exactly these fields:
- verdict: "TRUE" | "FALSE" | "MIXED" | "UNVERIFIED" | "MISLEADING"  
- confidence: number 0-100 representing how confident you are
- summary: 2-3 sentence explanation of your verdict
- supporting_evidence: array of quote strings from sources that support the claim
- contradicting_evidence: array of quote strings that contradict the claim
- caveats: any important nuances or context`;

  try {
    const claude = await axios.post("https://api.anthropic.com/v1/messages", {
      model: "claude-haiku-4-5", max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Claim to fact-check: "${claim}"\n\nEvidence:\n${evidenceText}\n\nRespond with valid JSON only.` }]
    }, {
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      timeout: 20000
    });

    const raw = (claude.data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "{}";
    let analysis: Record<string, unknown> = {};
    try {
      // Extract JSON from response (may have markdown wrapping)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (_) { analysis = { verdict: "UNVERIFIED", summary: raw }; }

    return void res.json({
      ok: true, claim,
      verdict: analysis.verdict ?? "UNVERIFIED",
      confidence: analysis.confidence ?? null,
      summary: analysis.summary ?? null,
      supporting_evidence: analysis.supporting_evidence ?? [],
      contradicting_evidence: analysis.contradicting_evidence ?? [],
      caveats: analysis.caveats ?? null,
      sources: evidence,
      credits_used: 14, ...(fcHasByok ? { byok: true, byok_provider: byokAnthropicKeyFC ? "anthropic" : fcSearchProvider } : {}), request_id: reqId()
    });
  } catch (e) {
    return void res.status(502).json({ ok: false, error: "analysis_failed", message: safeErr(e), request_id: reqId() });
  }
});

// ─── SESSION-CREATE ───────────────────────────────────────────────────────────
// Creates a conversation session with optional system prompt and model.
// Sessions are stored in memory (Map) — no DB required yet.

interface SessionData {
  session_id: string;
  owner_key: string;
  namespace: string;
  system_prompt: string | null;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  created_at: string;
}

const sessionStore = new Map<string, SessionData>();

function getSessionOwnerKey(req: AuthedRequest): string | null {
  if (req.agent?.id) return `agent:${req.agent.id}`;
  const payer = (req as AuthedRequest & { x402Payer?: string }).x402Payer;
  if (isX402Paid(req) && typeof payer === "string" && payer.trim()) {
    return `x402:${payer.trim().toLowerCase()}`;
  }
  return null;
}

// Clean up old sessions every 30 minutes (sessions older than 4 hours)
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [id, session] of sessionStore.entries()) {
    if (new Date(session.created_at).getTime() < cutoff) sessionStore.delete(id);
  }
}, 30 * 60 * 1000);

router.post("/session-create", ...toolMiddleware("session-create"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "session-create", 5);
    if (!ok) return;
  }
  const { namespace, model } = req.body as { namespace?: string; model?: string };
  const systemPrompt = req.body.system_prompt ?? req.body.system;
  if (!namespace || typeof namespace !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "namespace is required", request_id: reqId() });
    return;
  }

  const AI_MODE_PRESETS: Record<string, string> = {
    fast: "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-6",
    deep: "claude-opus-4-6",
  };
  const SESSION_MODEL_ALIASES: Record<string, string> = { "claude": "claude-sonnet-4-6", "gpt": "gpt-4o", "gpt4": "gpt-4o", "gpt-4": "gpt-4o" };
  const resolvedModel = model ? (SESSION_MODEL_ALIASES[model.toLowerCase()] ?? model) : "claude-sonnet-4-6";
  const ALLOWED = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "gpt-4o", "gpt-4o-mini"];
  if (!ALLOWED.includes(resolvedModel)) {
    res.status(400).json({ ok: false, error: "invalid_model", message: `model must be one of: claude, gpt4, ${ALLOWED.join(", ")}`, request_id: reqId() });
    return;
  }
  const ownerKey = getSessionOwnerKey(req);
  if (!ownerKey) {
    res.status(403).json({ ok: false, error: "session_owner_required", message: "Unable to identify the caller for this session.", request_id: reqId() });
    return;
  }

  const session_id = `sess_${crypto.randomUUID().replace(/-/g, "")}`;
  const created_at = new Date().toISOString();

  const session: SessionData = {
    session_id,
    owner_key: ownerKey,
    namespace: namespace.slice(0, 100),
    system_prompt: systemPrompt ? String(systemPrompt).slice(0, 4000) : null,
    model: resolvedModel,
    messages: [],
    created_at,
  };

  sessionStore.set(session_id, session);

  res.json({
    ok: true,
    session_id,
    namespace: session.namespace,
    model: resolvedModel,
    created_at,
    credits_used: 5,
    request_id: reqId(),
  });
});

// ─── SESSION-MESSAGE ──────────────────────────────────────────────────────────
// Sends a message in an existing session, maintaining conversation history.

router.post("/session-message", ...toolMiddleware("session-message"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const { session_id, message } = req.body as { session_id?: string; message?: string };

  if (!session_id || typeof session_id !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "session_id is required", request_id: reqId() });
    return;
  }
  if (!message || typeof message !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "message is required", request_id: reqId() });
    return;
  }
  if (message.length > 10000) {
    res.status(400).json({ ok: false, error: "message_too_long", message: "message must be 10000 chars or less", request_id: reqId() });
    return;
  }

  const session = sessionStore.get(session_id);
  if (!session) {
    res.status(404).json({ ok: false, error: "session_not_found", message: `Session '${session_id}' not found or expired`, request_id: reqId() });
    return;
  }
  const ownerKey = getSessionOwnerKey(req);
  if (!ownerKey || session.owner_key !== ownerKey) {
    res.status(403).json({ ok: false, error: "session_forbidden", message: "This session belongs to a different caller.", request_id: reqId() });
    return;
  }

  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "session-message", 20);
    if (!ok) return;
  }

  // Add user message to history
  session.messages.push({ role: "user", content: message });

  // Keep conversation history bounded (last 50 messages)
  if (session.messages.length > 50) {
    session.messages = session.messages.slice(-50);
  }

  const model = session.model;
  const CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];
  const GPT_MODELS = ["gpt-4o", "gpt-4o-mini"];

  try {
    let responseText = "";

    if (CLAUDE_MODELS.includes(model)) {
      if (!getAnthropic()) {
        res.status(503).json({ ok: false, error: "service_unavailable", message: "Anthropic API key not configured", request_id: reqId() });
        return;
      }
      const msg = await getAnthropic()!.messages.create({
        model,
        max_tokens: 2048,
        ...(session.system_prompt ? { system: session.system_prompt } : {}),
        messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      responseText = msg.content.find((b) => b.type === "text")?.text ?? "";
    } else if (GPT_MODELS.includes(model)) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        res.status(503).json({ ok: false, error: "service_unavailable", message: "OpenAI API key not configured", request_id: reqId() });
        return;
      }
      const messages: Array<{ role: string; content: string }> = [];
      if (session.system_prompt) messages.push({ role: "system", content: session.system_prompt });
      messages.push(...session.messages.map((m) => ({ role: m.role, content: m.content })));

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model, max_tokens: 2048, messages }),
      });
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      responseText = data.choices?.[0]?.message?.content ?? "";
    }

    // Add assistant response to history
    session.messages.push({ role: "assistant", content: responseText });

    res.json({
      ok: true,
      response: responseText,
      session_id,
      message_count: session.messages.length,
      model_used: model,
      credits_used: 20,
      request_id: reqId(),
    });
  } catch (e) {
    // Remove the user message we just added since the call failed
    session.messages.pop();
    res.status(500).json({ ok: false, error: "session_message_failed", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 54. VIDEO-GENERATE (Runway) ──────────────────────────────────────────────
router.post("/video-generate", ...toolMiddleware("video-generate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const { prompt, duration = 5, aspect_ratio = "16:9" } = req.body as { prompt?: string; duration?: number; aspect_ratio?: string };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  { const _mod = moderateGenerationPrompt(prompt); if (!_mod.allowed) { console.warn(`[moderation] blocked category=${_mod.category} tool=video-generate`); res.status(400).json({ ok: false, error: "content_policy", category: _mod.category, message: _mod.reason, request_id: reqId() }); return; } }
  const validDurations = [5, 10];
  if (!validDurations.includes(duration)) { res.status(400).json({ ok: false, error: "invalid_request", message: "duration must be 5 or 10", request_id: reqId() }); return; }
  // Scaled by duration at 140 credits/second, 700 minimum (5s = 700, 10s = 1400).
  // Runway gen4.5 ≈ $0.80–1.00 for 10s; at the worst-case $0.00114/credit bulk rate
  // 1400 credits = $1.60, keeping a safe margin over the top-tier COGS (audit 2026-07-27).
  const videoCost = Math.max(700, duration * 140);
  const paid = isX402Paid(req);
  // Input/config validation runs BEFORE the hourly gate so invalid or
  // unservable requests never burn a quota slot.
  const ratioAliases: Record<string, string> = {
    "16:9": "1280:720",
    "9:16": "720:1280",
    "1280:768": "1280:720",
    "768:1280": "720:1280",
  };
  const resolvedRatio = ratioAliases[aspect_ratio] ?? aspect_ratio;
  const validRatios = ["1280:720", "720:1280"];
  if (!validRatios.includes(resolvedRatio)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "aspect_ratio must be one of: 16:9, 9:16, 1280:720, 720:1280", request_id: reqId() });
    return;
  }
  const runwayKey = process.env.RUNWAY_API_KEY;
  if (!runwayKey) { res.status(503).json({ ok: false, error: "not_configured", message: "RUNWAY_API_KEY not configured", request_id: reqId() }); return; }
  // Hourly per-identity cap (audit 2026-07-27): Runway bills real money per
  // generation, so bound the burst blast radius for ALL payment rails — agent
  // id for credit callers, settled payer wallet for x402 callers (falling back
  // to the caller IP when payer metadata is unresolved, so unrelated callers
  // never share one bucket). Follows the EMAIL_RECIPIENT_DAILY_CAP in-memory
  // pattern (PR #76); env-tunable via VIDEO_HOURLY_CAP (default 5/hour).
  const videoIdentity = req.agent?.id
    ?? `x402:${(req as AuthedRequest & { x402Payer?: string }).x402Payer?.trim().toLowerCase() ?? `ip:${req.ip ?? "unknown"}`}`;
  if (!videoHourlyGate(videoIdentity)) {
    res.status(429).json({
      ok: false,
      error: "video_rate_limited",
      message: `Video generation is limited to ${VIDEO_HOURLY_CAP} requests per hour per account — a cost-abuse guard on the underlying Runway generation spend. Try again next hour.`,
      request_id: reqId(),
    });
    return;
  }
  if (!paid) {
    // Release the slot when the request dies before any Runway spend — a
    // caller at their daily limit or out of credits must not lose hourly quota.
    const withinLimit = await enforceDailyToolLimit(req, res, "video-generate");
    if (!withinLimit) { releaseVideoHourlySlot(videoIdentity); return; }
    const ok = await deductCredits(req, res, "video-generate", videoCost);
    if (!ok) { releaseVideoHourlySlot(videoIdentity); return; }
  }
  try {
    const candidateModels = [process.env.RUNWAY_VIDEO_MODEL, "gen4.5"].filter((value, index, self): value is string => !!value && self.indexOf(value) === index);
    let startResp: import("axios").AxiosResponse<{ id?: string }> | null = null;
    let startError: string | null = null;
    let selectedModel: string | null = null;

    for (const model of candidateModels) {
      const attempt = await axios.post("https://api.dev.runwayml.com/v1/text_to_video",
        { model, promptText: prompt, duration, ratio: resolvedRatio, watermark: false },
        {
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
          timeout: 30000,
          validateStatus: () => true,
        });

      if (attempt.status >= 200 && attempt.status < 300) {
        startResp = attempt as import("axios").AxiosResponse<{ id?: string }>;
        selectedModel = model;
        break;
      }

      const err = typeof attempt.data === "string" ? attempt.data : JSON.stringify(attempt.data);
      if (attempt.status === 403 && /not available/i.test(err)) {
        startError = `Runway model ${model} is not available for this API key`;
        continue;
      }

      console.error("[video-generate] Runway start error:", attempt.status, err);
      res.status(502).json({ ok: false, error: "runway_error", message: `Runway returned ${attempt.status}: ${err.slice(0, 200)}`, request_id: reqId() }); return;
    }

    if (!startResp || !selectedModel) {
      res.status(503).json({ ok: false, error: "not_configured", message: startError ?? "No compatible Runway model is configured for this API key", request_id: reqId() }); return;
    }

    const startData = startResp.data as { id?: string };
    const taskId = startData.id;
    if (!taskId) { res.status(502).json({ ok: false, error: "runway_error", message: "No task ID returned from Runway", request_id: reqId() }); return; }

    // Poll for completion (max 120s)
    let videoUrl: string | null = null;
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pollResp = await axios.get(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
        headers: { "Authorization": `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
        timeout: 15000,
        validateStatus: () => true,
      });
      if (pollResp.status < 200 || pollResp.status >= 300) continue;
      const pollData = pollResp.data as { status?: string; output?: string[]; failure?: string; failureCode?: string };
      if (pollData.status === "SUCCEEDED" && pollData.output?.length) {
        videoUrl = pollData.output[0];
        break;
      }
      if (pollData.status === "FAILED") {
        res.status(502).json({ ok: false, error: "generation_failed", message: pollData.failure ?? pollData.failureCode ?? "Video generation failed", request_id: reqId() }); return;
      }
    }
    if (!videoUrl) { res.status(504).json({ ok: false, error: "timeout", message: "Video generation timed out after 120s. Task ID: " + taskId, task_id: taskId, request_id: reqId() }); return; }
    res.json({ ok: true, video_url: videoUrl, duration, aspect_ratio: resolvedRatio, model: selectedModel, task_id: taskId, credits_used: paid ? 0 : videoCost, request_id: reqId() });
  } catch (e) { console.error("[video-generate]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── 55. IMAGE-REMOVE-BG (RemoveBG) ──────────────────────────────────────────
router.post("/image-remove-bg", ...toolMiddleware("image-remove-bg"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "image-remove-bg", 350); if (!ok) return; }
  const { image_url, image_base64: inputBase64, size = "auto" } = req.body as { image_url?: string; image_base64?: string; size?: string };
  if (!image_url && !inputBase64) { res.status(400).json({ ok: false, error: "invalid_request", message: "image_url or image_base64 is required", request_id: reqId() }); return; }
  const validSizes = ["auto", "preview", "hd", "full"];
  if (!validSizes.includes(size)) { res.status(400).json({ ok: false, error: "invalid_request", message: `size must be one of: ${validSizes.join(", ")}`, request_id: reqId() }); return; }
  const removebgKey = process.env.REMOVEBG_API_KEY;
  if (!removebgKey) { res.status(503).json({ ok: false, error: "not_configured", message: "REMOVEBG_API_KEY not configured", request_id: reqId() }); return; }
  try {
    // Download the image ourselves and send base64 to RemoveBG. RemoveBG's own
    // image_url fetcher is frequently blocked/429'd by CDNs (e.g. Wikimedia),
    // which made valid requests fail.
    let imgB64 = inputBase64;
    if (image_url && !imgB64) {
      try { await validateUrl(image_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      try {
        const imgResp = await safeAxiosGet(image_url, { responseType: "arraybuffer", timeout: 20000, maxContentLength: 22 * 1024 * 1024, headers: { "User-Agent": "ArchTools/1.0 (+https://archtools.dev)" } });
        imgB64 = Buffer.from(imgResp.data as ArrayBuffer).toString("base64");
      } catch (dlErr) {
        const st = axios.isAxiosError(dlErr) ? dlErr.response?.status : undefined;
        res.status(400).json({ ok: false, error: "image_download_failed", message: `Could not download image from image_url${st ? ` (HTTP ${st})` : ""}. Check the URL is public and reachable, or pass image_base64 instead.`, request_id: reqId() }); return;
      }
    }
    const resp = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": removebgKey, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ image_file_b64: imgB64, size: size === "hd" ? "full" : size, format: "png", type: "auto" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error("[image-remove-bg] RemoveBG error:", resp.status, err);
      // NOTE: never return 502 from origin — Cloudflare replaces origin 502
      // bodies with its own error page, hiding our JSON from the client.
      let detail = err.slice(0, 300);
      try { const j = JSON.parse(err) as { errors?: Array<{ title?: string }> }; detail = j.errors?.[0]?.title ?? detail; } catch { /* keep raw */ }
      const status = resp.status >= 400 && resp.status < 500 ? 400 : 503;
      res.status(status).json({ ok: false, error: "removebg_error", message: `RemoveBG rejected the request (${resp.status}): ${detail.slice(0, 200)}`, request_id: reqId() }); return;
    }
    const data = await resp.json() as { data?: { result_b64?: string; foreground_top?: number; foreground_left?: number; foreground_width?: number; foreground_height?: number } };
    const imageBase64 = data.data?.result_b64 ?? "";
    if (!imageBase64) { res.status(503).json({ ok: false, error: "removebg_error", message: "No result image returned", request_id: reqId() }); return; }
    res.json({ ok: true, image_base64: imageBase64, format: "png", size, credits_used: 350, request_id: reqId() });
  } catch (e) {
    console.error("[image-remove-bg]", e);
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    res.status(isTimeout ? 503 : 500).json({ ok: false, error: isTimeout ? "upstream_timeout" : "fetch_error", message: isTimeout ? "RemoveBG did not respond in time. Please retry." : safeErr(e), request_id: reqId() });
  }
});

// ─── 56. EMAIL-FIND (Hunter.io) ──────────────────────────────────────────────
router.post("/email-find", ...toolMiddleware("email-find"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "email-find", 110); if (!ok) return; }
  const { domain, first_name, last_name } = req.body as { domain?: string; first_name?: string; last_name?: string };
  if (!domain) { res.status(400).json({ ok: false, error: "invalid_request", message: "domain is required", request_id: reqId() }); return; }
  const hunterKey = process.env.HUNTER_API_KEY;
  if (!hunterKey) { res.status(503).json({ ok: false, error: "not_configured", message: "HUNTER_API_KEY not configured", request_id: reqId() }); return; }
  try {
    const hasFullName = !!(first_name && last_name);
    const endpoint = hasFullName ? "email-finder" : "domain-search";
    const params = new URLSearchParams({ domain, api_key: hunterKey });
    if (hasFullName) {
      params.set("first_name", first_name!);
      params.set("last_name", last_name!);
    }
    const resp = await fetch(`https://api.hunter.io/v2/${endpoint}?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      const err = await resp.text();
      console.error("[email-find] Hunter error:", resp.status, err);
      // NOTE: never return 502 from origin — Cloudflare replaces origin 502 bodies
      // with its own error page, hiding our JSON from the client.
      let detail = err.slice(0, 300);
      try { const j = JSON.parse(err) as { errors?: Array<{ details?: string }> }; detail = j.errors?.[0]?.details ?? detail; } catch { /* keep raw */ }
      const status = resp.status >= 400 && resp.status < 500 ? 400 : 503;
      res.status(status).json({ ok: false, error: "hunter_error", message: `Hunter.io rejected the request (${resp.status}): ${detail.slice(0, 200)}`, request_id: reqId() }); return;
    }
    if (hasFullName) {
      const data = await resp.json() as { data?: { email?: string; confidence?: number; sources?: unknown[]; first_name?: string; last_name?: string; position?: string; company?: string } };
      const result = data.data;
      if (!result?.email) {
        // Empty result is NOT an error — Hunter.io answered fine, it just has
        // no email for this person. 200 + waived charge (agents don't pay for nothing).
        waiveCharge(res);
        res.json({ ok: true, email: null, results: [], count: 0, match_type: "person", message: "No email address found for the given name and domain.", credits_used: 0, request_id: reqId() });
        return;
      }
      res.json({ ok: true, email: result.email, confidence: result.confidence ?? 0, sources: result.sources?.length ?? 0, first_name: result.first_name ?? first_name ?? null, last_name: result.last_name ?? last_name ?? null, position: result.position ?? null, company: result.company ?? null, match_type: "person", credits_used: 110, request_id: reqId() });
      return;
    }
    const data = await resp.json() as { data?: { emails?: Array<{ value?: string; confidence?: number; first_name?: string; last_name?: string; position?: string; department?: string }> ; organization?: string } };
    const emails = data.data?.emails ?? [];
    if (!emails.length) {
      // Empty result is NOT an error — Hunter.io answered fine, it just has
      // no emails for this domain. 200 + waived charge (agents don't pay for nothing).
      waiveCharge(res);
      res.json({ ok: true, domain, company: data.data?.organization ?? null, results: [], count: 0, match_type: "domain", message: "No email addresses found for this domain.", credits_used: 0, request_id: reqId() });
      return;
    }
    res.json({ ok: true, domain, company: data.data?.organization ?? null, results: emails.slice(0, 10).map((r) => ({ email: r.value ?? null, confidence: r.confidence ?? 0, first_name: r.first_name ?? null, last_name: r.last_name ?? null, position: r.position ?? null, department: r.department ?? null })), count: emails.length, match_type: "domain", credits_used: 110, request_id: reqId() });
  } catch (e) {
    console.error("[email-find]", e);
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    res.status(isTimeout ? 503 : 500).json({ ok: false, error: isTimeout ? "upstream_timeout" : "fetch_error", message: isTimeout ? "Hunter.io did not respond in time. Please retry." : safeErr(e), request_id: reqId() });
  }
});

// ─── 57. SEMANTIC-SEARCH (Exa) ───────────────────────────────────────────────
router.post("/semantic-search", ...toolMiddleware("semantic-search"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "semantic-search", 8); if (!ok) return; }
  const { query, num_results = 5, limit, type = "neural", documents } = req.body as { query?: string; num_results?: number; limit?: number; type?: string; documents?: string[] };
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return; }
  const n = Math.min(Math.max(1, Number(limit ?? num_results ?? 5)), 20);

  if (Array.isArray(documents) && documents.length > 0) {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const queryTerms = new Set(normalize(query).split(" ").filter(Boolean));
    const scored = documents.map((doc, index) => {
      const text = typeof doc === "string" ? doc : JSON.stringify(doc);
      const norm = normalize(text);
      const words = new Set(norm.split(" ").filter(Boolean));
      let overlap = 0;
      for (const term of queryTerms) if (words.has(term)) overlap += 1;
      const phraseBoost = norm.includes(normalize(query)) ? 2 : 0;
      const score = queryTerms.size ? (overlap / queryTerms.size) + phraseBoost : 0;
      return { index, text: text.slice(0, 1000), score };
    }).sort((a, b) => b.score - a.score).slice(0, n);

    res.json({ ok: true, query, type: "documents", results: scored, count: scored.length, documents_searched: documents.length, credits_used: 8, request_id: reqId() });
    return;
  }

  const validTypes = ["neural", "keyword"];
  if (!validTypes.includes(type)) { res.status(400).json({ ok: false, error: "invalid_request", message: `type must be one of: ${validTypes.join(", ")}`, request_id: reqId() }); return; }
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) { res.status(503).json({ ok: false, error: "not_configured", message: "EXA_API_KEY not configured", request_id: reqId() }); return; }
  try {
    const resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${exaKey}` },
      body: JSON.stringify({ query, numResults: n, type, contents: { text: { maxCharacters: 1000 } } }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error("[semantic-search] Exa error:", resp.status, err);
      res.status(502).json({ ok: false, error: "exa_error", message: `Exa returned ${resp.status}: ${err.slice(0, 200)}`, request_id: reqId() }); return;
    }
    const data = await resp.json() as { results?: Array<{ title?: string; url?: string; text?: string; score?: number; publishedDate?: string; author?: string }> };
    const results = (data.results ?? []).map(r => ({ title: r.title ?? "", url: r.url ?? "", text: (r.text ?? "").slice(0, 1000), score: r.score ?? 0, published_date: r.publishedDate ?? null, author: r.author ?? null }));
    res.json({ ok: true, query, type, results, count: results.length, credits_used: 8, request_id: reqId() });
  } catch (e) { console.error("[semantic-search]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── wallet-balance ──────────────────────────────────────────────────────────
router.post("/wallet-balance", ...toolMiddleware("wallet-balance"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "wallet-balance", 1); if (!ok) return; }
  const { address } = req.body as { address?: string };
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "address is required and must be a valid Ethereum address (0x + 40 hex chars)", request_id: reqId() });
    return;
  }
  try {
    const requestPath = `/platform/v2/evm/token-balances/base/${address}`;
    const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
    const jwt = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID ?? process.env.CDP_API_KEY ?? "",
      apiKeySecret: process.env.CDP_API_KEY_SECRET ?? process.env.CDP_API_SECRET ?? "",
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath,
    });
    const r = await fetch(`https://api.cdp.coinbase.com${requestPath}`, {
      headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[wallet-balance] CDP error:", r.status, errText);
      res.status(502).json({ ok: false, error: "cdp_error", message: `CDP API returned ${r.status}`, request_id: reqId() });
      return;
    }
    const data = await r.json() as { balances?: any[] };
    const balances = (data.balances ?? []).map((b: any) => ({
      token: b.token?.symbol ?? b.symbol ?? "UNKNOWN",
      name: b.token?.name ?? b.name ?? "",
      amount: b.amount ?? b.balance ?? "0",
      decimals: b.token?.decimals ?? b.decimals ?? 18,
    }));
    res.json({ ok: true, address, network: "base", balances, count: balances.length, data_source: "Coinbase Developer Platform", request_id: reqId() });
  } catch (e) { console.error("[wallet-balance]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── address-history ─────────────────────────────────────────────────────────
router.post("/address-history", ...toolMiddleware("address-history"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "address-history", 1); if (!ok) return; }
  const { address, limit = 20 } = req.body as { address?: string; limit?: number };
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "address is required and must be a valid Ethereum address (0x + 40 hex chars)", request_id: reqId() });
    return;
  }
  const n = Math.min(Math.max(1, limit), 100);
  try {
    const requestPath = `/platform/v2/evm/transaction-history/base/${address}`;
    const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
    const jwt = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID ?? process.env.CDP_API_KEY ?? "",
      apiKeySecret: process.env.CDP_API_KEY_SECRET ?? process.env.CDP_API_SECRET ?? "",
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath,
    });
    const r = await fetch(`https://api.cdp.coinbase.com${requestPath}?limit=${n}`, {
      headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[address-history] CDP error:", r.status, errText);
      res.status(502).json({ ok: false, error: "cdp_error", message: `CDP API returned ${r.status}`, request_id: reqId() });
      return;
    }
    const data = await r.json() as { transactions?: any[]; next_page_token?: string };
    const transactions = (data.transactions ?? []).slice(0, n).map((tx: any) => ({
      hash: tx.transaction_hash ?? tx.hash ?? "",
      block_number: tx.block_number ?? null,
      timestamp: tx.block_timestamp ?? tx.timestamp ?? null,
      from: tx.from_address ?? tx.from ?? "",
      to: tx.to_address ?? tx.to ?? "",
      value: tx.value ?? "0",
      status: tx.status ?? "unknown",
    }));
    res.json({ ok: true, address, network: "base", transactions, count: transactions.length, data_source: "Coinbase Developer Platform", request_id: reqId() });
  } catch (e) { console.error("[address-history]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── gas-price ───────────────────────────────────────────────────────────────
router.post("/gas-price", ...toolMiddleware("gas-price"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "gas-price", 1); if (!ok) return; }
  try {
    const r = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 1 }),
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: "rpc_error", message: `Base RPC returned ${r.status}`, request_id: reqId() });
      return;
    }
    const data = await r.json() as { result?: string };
    const hexWei = data.result ?? "0x0";
    const wei = BigInt(hexWei);
    const gweiNum = Number(wei) / 1e9;
    res.json({ ok: true, network: "base", gas_price_wei: wei.toString(), gas_price_gwei: Math.round(gweiNum * 1000) / 1000, gas_price_hex: hexWei, data_source: "Base Mainnet RPC", request_id: reqId() });
  } catch (e) { console.error("[gas-price]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── base-nft-metadata ───────────────────────────────────────────────────────
router.post("/base-nft-metadata", ...toolMiddleware("base-nft-metadata"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "base-nft-metadata", 1); if (!ok) return; }
  const { contractAddress, tokenId } = req.body as { contractAddress?: string; tokenId?: unknown };
  if (!contractAddress || tokenId === null || tokenId === undefined || String(tokenId).trim() === "") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "contractAddress and tokenId are required", request_id: reqId() });
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "contractAddress must be a valid Ethereum address (0x + 40 hex chars)", request_id: reqId() });
    return;
  }
  const tokenIdClean = normalizeCdpTokenId(tokenId);
  if (!tokenIdClean) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "tokenId must be a decimal NFT token ID", request_id: reqId() });
    return;
  }
  try {
    const requestPath = `/platform/v2/evm/nfts/base/${contractAddress}/${encodeURIComponent(tokenIdClean)}`;
    const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
    const jwt = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID ?? process.env.CDP_API_KEY ?? "",
      apiKeySecret: process.env.CDP_API_KEY_SECRET ?? process.env.CDP_API_SECRET ?? "",
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath,
    });
    const r = await fetch(`https://api.cdp.coinbase.com${requestPath}`, {
      headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[base-nft-metadata] CDP error:", r.status, errText);
      res.status(502).json({ ok: false, error: "cdp_error", message: `CDP API returned ${r.status}`, request_id: reqId() });
      return;
    }
    const data = await r.json() as any;
    res.json({
      ok: true,
      contractAddress,
      tokenId: tokenIdClean,
      network: "base",
      name: data.name ?? data.token?.name ?? null,
      description: data.description ?? null,
      image: data.image ?? data.image_url ?? null,
      attributes: data.attributes ?? data.traits ?? [],
      token_uri: data.token_uri ?? null,
      data_source: "Coinbase Developer Platform",
      request_id: reqId(),
    });
  } catch (e) { console.error("[base-nft-metadata]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── eth-resolve-ens ─────────────────────────────────────────────────────────
router.post("/eth-resolve-ens", ...toolMiddleware("eth-resolve-ens"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "eth-resolve-ens", 1); if (!ok) return; }
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "name is required (e.g. vitalik.eth)", request_id: reqId() });
    return;
  }
  try {
    const r = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(name.trim())}`, {
      headers: { "Accept": "application/json", "User-Agent": "ArchTools/1.9" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[eth-resolve-ens] ENSIdeas error:", r.status, errText);
      res.status(502).json({ ok: false, error: "ens_error", message: `ENS resolver returned ${r.status}`, request_id: reqId() });
      return;
    }
    const data = await r.json() as { address?: string; name?: string; displayName?: string; avatar?: string; error?: string };
    if (!data.address || data.address === "0x0000000000000000000000000000000000000000") {
      res.status(404).json({ ok: false, error: "not_found", message: `ENS name '${name}' could not be resolved`, request_id: reqId() });
      return;
    }
    res.json({
      ok: true,
      name: data.name ?? name,
      address: data.address,
      displayName: data.displayName ?? null,
      avatar: data.avatar ?? null,
      data_source: "ENS (via ensideas.com)",
      request_id: reqId(),
    });
  } catch (e) { console.error("[eth-resolve-ens]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── base-block-info ─────────────────────────────────────────────────────────
router.post("/base-block-info", ...toolMiddleware("base-block-info"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "base-block-info", 1); if (!ok) return; }
  try {
    const r = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", params: ["latest", false], id: 1 }),
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: "rpc_error", message: `Base RPC returned ${r.status}`, request_id: reqId() });
      return;
    }
    const data = await r.json() as { result?: any };
    const block = data.result;
    if (!block) {
      res.status(502).json({ ok: false, error: "rpc_error", message: "No block data returned from Base RPC", request_id: reqId() });
      return;
    }
    const blockNumber = parseInt(block.number, 16);
    const timestamp = parseInt(block.timestamp, 16);
    const gasUsed = parseInt(block.gasUsed, 16);
    const gasLimit = parseInt(block.gasLimit, 16);
    const txCount = Array.isArray(block.transactions) ? block.transactions.length : 0;
    const baseFeePerGas = block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) : null;
    res.json({
      ok: true,
      network: "base",
      block_number: blockNumber,
      block_hash: block.hash ?? null,
      timestamp,
      datetime: new Date(timestamp * 1000).toISOString(),
      gas_used: gasUsed,
      gas_limit: gasLimit,
      gas_utilization_pct: Math.round((gasUsed / gasLimit) * 10000) / 100,
      base_fee_per_gas_wei: baseFeePerGas !== null ? baseFeePerGas.toString() : null,
      base_fee_per_gas_gwei: baseFeePerGas !== null ? Math.round((baseFeePerGas / 1e9) * 1000) / 1000 : null,
      transaction_count: txCount,
      miner: block.miner ?? null,
      data_source: "Base Mainnet RPC",
      request_id: reqId(),
    });
  } catch (e) { console.error("[base-block-info]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── defi-tvl ────────────────────────────────────────────────────────────────
router.post("/defi-tvl", ...toolMiddleware("defi-tvl"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "defi-tvl", 1); if (!ok) return; }
  const { protocol, limit = 10 } = req.body as { protocol?: string; limit?: number };
  try {
    if (protocol) {
      const slug = protocol.toLowerCase().trim();
      const r = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) {
        if (r.status === 404) { res.status(404).json({ ok: false, error: "not_found", message: `Protocol '${slug}' not found on DefiLlama`, request_id: reqId() }); return; }
        res.status(502).json({ ok: false, error: "fetch_error", message: `DefiLlama returned ${r.status}`, request_id: reqId() }); return;
      }
      const data = await r.json() as any;
      res.json({
        ok: true,
        protocol: {
          name: data.name ?? slug,
          slug: data.slug ?? slug,
          tvl: data.currentChainTvls ? Object.values(data.currentChainTvls as Record<string, number>).reduce((a: number, b: number) => a + b, 0) : (data.tvl ?? null),
          category: data.category ?? null,
          chains: data.chains ?? [],
          change_1d: data.change_1d ?? null,
          change_7d: data.change_7d ?? null,
          url: data.url ?? null,
          logo: data.logo ?? null,
        },
        data_source: "DefiLlama",
        attribution: "Powered by DefiLlama API — https://defillama.com",
        request_id: reqId(),
      });
    } else {
      const n = Math.min(Math.max(1, limit), 100);
      const r = await fetch("https://api.llama.fi/protocols", { signal: AbortSignal.timeout(10000) });
      if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `DefiLlama returned ${r.status}`, request_id: reqId() }); return; }
      const data = await r.json() as any[];
      const sorted = data.sort((a: any, b: any) => (b.tvl ?? 0) - (a.tvl ?? 0)).slice(0, n);
      const protocols = sorted.map((p: any) => ({
        name: p.name, slug: p.slug, tvl: p.tvl ?? 0, category: p.category ?? null,
        chain: p.chain ?? null, chains: p.chains ?? [],
        change_1d: p.change_1d ?? null, change_7d: p.change_7d ?? null,
      }));
      res.json({ ok: true, protocols, count: protocols.length, data_source: "DefiLlama", attribution: "Powered by DefiLlama API — https://defillama.com", request_id: reqId() });
    }
  } catch (e) { console.error("[defi-tvl]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-dominance ────────────────────────────────────────────────────────
router.post("/crypto-dominance", ...toolMiddleware("crypto-dominance"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-dominance", 1); if (!ok) return; }
  try {
    const r = await fetch(`${cgBase()}/global`, { headers: cgHeaders(), signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
      try {
        const ccResp = await fetch("https://api.coincap.io/v2/assets?limit=2", { signal: AbortSignal.timeout(8000) });
        if (ccResp.ok) {
          const ccData = await ccResp.json() as { data: any[] };
          const btc = ccData.data?.find((c: any) => c.id === "bitcoin");
          const eth = ccData.data?.find((c: any) => c.id === "ethereum");
          res.json({
            ok: true,
            btc_dominance: btc?.marketCapDominance ? parseFloat(btc.marketCapDominance) : null,
            eth_dominance: eth?.marketCapDominance ? parseFloat(eth.marketCapDominance) : null,
            total_market_cap_usd: null, total_volume_24h_usd: null,
            source: "coincap_fallback",
            data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com",
            request_id: reqId(),
          }); return;
        }
      } catch (_) { /* fall through */ }
      res.status(502).json({ ok: false, error: "fetch_error", message: `CoinGecko returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { data?: { market_cap_percentage?: Record<string, number>; total_market_cap?: Record<string, number>; total_volume?: Record<string, number>; active_cryptocurrencies?: number; markets?: number; market_cap_change_percentage_24h_usd?: number } };
    const d = data.data;
    res.json({
      ok: true,
      btc_dominance: d?.market_cap_percentage?.btc ?? null,
      eth_dominance: d?.market_cap_percentage?.eth ?? null,
      top_10_dominance: d?.market_cap_percentage ? Object.entries(d.market_cap_percentage).slice(0, 10).map(([k, v]) => ({ symbol: k, dominance_pct: Math.round(v * 100) / 100 })) : [],
      total_market_cap_usd: d?.total_market_cap?.usd ?? null,
      total_volume_24h_usd: d?.total_volume?.usd ?? null,
      active_cryptocurrencies: d?.active_cryptocurrencies ?? null,
      markets: d?.markets ?? null,
      market_cap_change_24h_pct: d?.market_cap_change_percentage_24h_usd ?? null,
      data_source: "CoinGecko", attribution: "Powered by CoinGecko API — https://www.coingecko.com",
      data_license: "CoinGecko Terms apply — https://www.coingecko.com/en/api_terms",
      request_id: reqId(),
    });
  } catch (e) { console.error("[crypto-dominance]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── nft-collection-stats ────────────────────────────────────────────────────
router.post("/nft-collection-stats", ...toolMiddleware("nft-collection-stats"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "nft-collection-stats", 2); if (!ok) return; }
  const { collection } = req.body as { collection?: string };
  if (!collection) { res.status(400).json({ ok: false, error: "invalid_request", message: "collection is required (e.g. bored-ape-yacht-club)", request_id: reqId() }); return; }
  try {
    const slug = collection.toLowerCase().trim();
    const parseCollection = (c: any) => ({
      name: c.name ?? collection, slug: c.slug ?? slug,
      floor_price_eth: c.floorAsk?.price?.amount?.native ?? null,
      floor_price_usd: c.floorAsk?.price?.amount?.usd ?? null,
      volume_24h: c.volume?.["1day"] ?? null, volume_7d: c.volume?.["7day"] ?? null,
      volume_all_time: c.volume?.allTime ?? null,
      token_count: c.tokenCount ?? null, owner_count: c.ownerCount ?? null,
      image: c.image ?? null, description: c.description?.slice(0, 500) ?? null,
    });
    // Try by slug first, then by name
    for (const param of [`slug=${encodeURIComponent(slug)}`, `name=${encodeURIComponent(collection)}`]) {
      const r = await fetch(`https://api.reservoir.tools/collections/v7?${param}&limit=1`, {
        headers: { "Accept": "application/json", "User-Agent": "ArchTools/1.9" },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json() as { collections?: any[] };
        if (data.collections?.length) {
          res.json({ ok: true, collection: parseCollection(data.collections[0]), data_source: "Reservoir", attribution: "Powered by Reservoir API — https://reservoir.tools", request_id: reqId() });
          return;
        }
      }
    }
    res.status(404).json({ ok: false, error: "not_found", message: `NFT collection '${collection}' not found`, request_id: reqId() });
  } catch (e) { console.error("[nft-collection-stats]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── base-tx-decode ──────────────────────────────────────────────────────────
router.post("/base-tx-decode", ...toolMiddleware("base-tx-decode"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "base-tx-decode", 1); if (!ok) return; }
  const { txHash } = req.body as { txHash?: string };
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "txHash is required and must be a valid transaction hash (0x + 64 hex chars)", request_id: reqId() }); return;
  }
  try {
    const txResp = await fetch("https://mainnet.base.org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionByHash", params: [txHash], id: 1 }),
    });
    if (!txResp.ok) { res.status(502).json({ ok: false, error: "rpc_error", message: `Base RPC returned ${txResp.status}`, request_id: reqId() }); return; }
    const txData = await txResp.json() as { result?: any };
    const tx = txData.result;
    if (!tx) { res.status(404).json({ ok: false, error: "not_found", message: `Transaction '${txHash}' not found on Base`, request_id: reqId() }); return; }

    const receiptResp = await fetch("https://mainnet.base.org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionReceipt", params: [txHash], id: 2 }),
    });
    let status: string = "pending";
    let gasUsed: number | null = null;
    let effectiveGasPrice: number | null = null;
    if (receiptResp.ok) {
      const receiptData = await receiptResp.json() as { result?: any };
      const receipt = receiptData.result;
      if (receipt) {
        status = receipt.status === "0x1" ? "success" : receipt.status === "0x0" ? "failed" : "pending";
        gasUsed = receipt.gasUsed ? parseInt(receipt.gasUsed, 16) : null;
        effectiveGasPrice = receipt.effectiveGasPrice ? parseInt(receipt.effectiveGasPrice, 16) : null;
      }
    }

    const valueWei = tx.value ? BigInt(tx.value) : BigInt(0);
    const valueEth = Number(valueWei) / 1e18;
    const gasLimit = tx.gas ? parseInt(tx.gas, 16) : null;
    const gasPriceWei = tx.gasPrice ? parseInt(tx.gasPrice, 16) : null;
    const blockNumber = tx.blockNumber ? parseInt(tx.blockNumber, 16) : null;
    const nonce = tx.nonce ? parseInt(tx.nonce, 16) : null;
    const inputData = tx.input ?? "0x";
    const methodSig = inputData.length >= 10 ? inputData.slice(0, 10) : null;

    let txFeeEth: number | null = null;
    if (gasUsed !== null && effectiveGasPrice !== null) {
      txFeeEth = (gasUsed * effectiveGasPrice) / 1e18;
    } else if (gasUsed !== null && gasPriceWei !== null) {
      txFeeEth = (gasUsed * gasPriceWei) / 1e18;
    }

    res.json({
      ok: true, txHash, network: "base", status,
      from: tx.from ?? null, to: tx.to ?? null,
      value_wei: valueWei.toString(), value_eth: Math.round(valueEth * 1e8) / 1e8,
      block_number: blockNumber, nonce,
      gas_limit: gasLimit, gas_used: gasUsed,
      gas_price_gwei: gasPriceWei !== null ? Math.round((gasPriceWei / 1e9) * 1000) / 1000 : null,
      tx_fee_eth: txFeeEth !== null ? Math.round(txFeeEth * 1e8) / 1e8 : null,
      method_signature: methodSig,
      has_input_data: inputData !== "0x" && inputData.length > 2,
      input_data_size: inputData.length > 2 ? (inputData.length - 2) / 2 : 0,
      data_source: "Base Mainnet RPC", request_id: reqId(),
    });
  } catch (e) { console.error("[base-tx-decode]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── stock-price ─────────────────────────────────────────────────────────────
router.post("/stock-price", ...toolMiddleware("stock-price"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "stock-price", 1); if (!ok) return; }
  const { symbol } = req.body as { symbol?: string };
  if (!symbol || typeof symbol !== "string" || !/^[A-Za-z0-9.\-^=]{1,20}$/.test(symbol.trim())) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required (e.g. AAPL, TSLA, MSFT)", request_id: reqId() }); return;
  }
  const ticker = symbol.trim().toUpperCase();
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
      if (r.status === 404) { res.status(404).json({ ok: false, error: "not_found", message: `Symbol '${ticker}' not found`, request_id: reqId() }); return; }
      res.status(502).json({ ok: false, error: "fetch_error", message: `Yahoo Finance returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) { res.status(404).json({ ok: false, error: "not_found", message: `No data for symbol '${ticker}'`, request_id: reqId() }); return; }
    const meta = result.meta ?? {};
    const price = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = (price !== null && prevClose !== null) ? Math.round((price - prevClose) * 100) / 100 : null;
    const changePct = (price !== null && prevClose !== null && prevClose !== 0) ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : null;
    const volume = meta.regularMarketVolume ?? null;
    res.json({
      ok: true, symbol: ticker,
      currency: meta.currency ?? "USD",
      price, previous_close: prevClose,
      change, change_percent: changePct,
      volume, market_time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      exchange: meta.exchangeName ?? null,
      data_source: "Yahoo Finance", request_id: reqId(),
    });
  } catch (e) { console.error("[stock-price]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── weather-current ─────────────────────────────────────────────────────────
router.post("/weather-current", ...toolMiddleware("weather-current"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "weather-current", 1); if (!ok) return; }
  const { city } = req.body as { city?: string };
  if (!city || typeof city !== "string" || city.trim().length === 0 || city.trim().length > 100) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "city is required (e.g. New York, London, Tokyo)", request_id: reqId() }); return;
  }
  const cityName = city.trim();
  try {
    const r = await fetch(`https://wttr.in/${encodeURIComponent(cityName)}?format=j1`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "ArchTools/1.0" },
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: "fetch_error", message: `wttr.in returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as any;
    const current = data?.current_condition?.[0];
    if (!current) { res.status(404).json({ ok: false, error: "not_found", message: `No weather data for '${cityName}'`, request_id: reqId() }); return; }
    const area = data?.nearest_area?.[0];
    res.json({
      ok: true,
      location: {
        city: area?.areaName?.[0]?.value ?? cityName,
        region: area?.region?.[0]?.value ?? null,
        country: area?.country?.[0]?.value ?? null,
      },
      weather: {
        temp_c: parseInt(current.temp_C) || null,
        temp_f: parseInt(current.temp_F) || null,
        feels_like_c: parseInt(current.FeelsLikeC) || null,
        feels_like_f: parseInt(current.FeelsLikeF) || null,
        humidity: parseInt(current.humidity) || null,
        wind_speed_kmph: parseInt(current.windspeedKmph) || null,
        wind_speed_mph: parseInt(current.windspeedMiles) || null,
        wind_direction: current.winddir16Point ?? null,
        condition: current.weatherDesc?.[0]?.value ?? null,
        uv_index: parseInt(current.uvIndex) || null,
        visibility_km: parseInt(current.visibility) || null,
        pressure_mb: parseInt(current.pressure) || null,
        cloud_cover: parseInt(current.cloudcover) || null,
      },
      observation_time: current.observation_time ?? null,
      data_source: "wttr.in", request_id: reqId(),
    });
  } catch (e) { console.error("[weather-current]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── github-repo-stats ───────────────────────────────────────────────────────
router.post("/github-repo-stats", ...toolMiddleware("github-repo-stats"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "github-repo-stats", 1); if (!ok) return; }
  const { owner, repo } = req.body as { owner?: string; repo?: string };
  if (!owner || !repo || typeof owner !== "string" || typeof repo !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "owner and repo are required (e.g. owner: 'facebook', repo: 'react')", request_id: reqId() }); return;
  }
  const o = owner.trim();
  const r = repo.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(o) || !/^[A-Za-z0-9._-]{1,100}$/.test(r)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid owner or repo name", request_id: reqId() }); return;
  }
  try {
    const resp = await fetch(`https://api.github.com/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "ArchTools/1.0", "Accept": "application/vnd.github+json" },
    });
    if (!resp.ok) {
      if (resp.status === 404) { res.status(404).json({ ok: false, error: "not_found", message: `Repository '${o}/${r}' not found`, request_id: reqId() }); return; }
      res.status(502).json({ ok: false, error: "fetch_error", message: `GitHub API returned ${resp.status}`, request_id: reqId() }); return;
    }
    const data = await resp.json() as any;
    res.json({
      ok: true,
      repository: {
        full_name: data.full_name ?? `${o}/${r}`,
        description: data.description ?? null,
        language: data.language ?? null,
        stars: data.stargazers_count ?? 0,
        forks: data.forks_count ?? 0,
        open_issues: data.open_issues_count ?? 0,
        watchers: data.subscribers_count ?? 0,
        size_kb: data.size ?? null,
        default_branch: data.default_branch ?? "main",
        license: data.license?.spdx_id ?? null,
        topics: data.topics ?? [],
        created_at: data.created_at ?? null,
        updated_at: data.updated_at ?? null,
        pushed_at: data.pushed_at ?? null,
        is_fork: data.fork ?? false,
        is_archived: data.archived ?? false,
        homepage: data.homepage ?? null,
        html_url: data.html_url ?? null,
      },
      data_source: "GitHub API", request_id: reqId(),
    });
  } catch (e) { console.error("[github-repo-stats]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── wikipedia-search ────────────────────────────────────────────────────────
router.post("/wikipedia-search", ...toolMiddleware("wikipedia-search"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "wikipedia-search", 1); if (!ok) return; }
  const { query, limit = 3 } = req.body as { query?: string; limit?: number };
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return;
  }
  const q = query.trim();
  const n = Math.min(Math.max(1, limit), 20);
  try {
    const r = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${n}&format=json&origin=*`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `Wikipedia API returned ${r.status}`, request_id: reqId() }); return; }
    const data = await r.json() as any;
    const results = (data?.query?.search ?? []).map((item: any) => ({
      title: item.title,
      snippet: (item.snippet ?? "").replace(/<[^>]*>/g, ""),
      page_id: item.pageid,
      word_count: item.wordcount ?? null,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    }));
    res.json({
      ok: true,
      query: q,
      total_hits: data?.query?.searchinfo?.totalhits ?? results.length,
      results,
      data_source: "Wikipedia API",
      request_id: reqId(),
    });
  } catch (e) { console.error("[wikipedia-search]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── url-health-check ────────────────────────────────────────────────────────
router.post("/url-health-check", ...toolMiddleware("url-health-check"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "url-health-check", 1); if (!ok) return; }
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return;
  }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  try {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await safeFetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "ArchTools-HealthCheck/1.0" },
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    res.json({
      ok: true,
      url,
      is_up: r.ok,
      status_code: r.status,
      status_text: r.statusText,
      response_time_ms: elapsed,
      content_type: r.headers.get("content-type") ?? null,
      server: r.headers.get("server") ?? null,
      redirected: r.url !== url,
      final_url: r.url !== url ? r.url : null,
      request_id: reqId(),
    });
  } catch (e: any) {
    const isTimeout = e?.name === "AbortError";
    res.json({
      ok: true,
      url,
      is_up: false,
      status_code: null,
      status_text: isTimeout ? "TIMEOUT" : "CONNECTION_FAILED",
      response_time_ms: null,
      content_type: null,
      server: null,
      error: isTimeout ? "Request timed out after 15s" : (e?.message ?? "Connection failed"),
      request_id: reqId(),
    });
  }
});

// ─── calculate-compound-interest ─────────────────────────────────────────────
router.post("/calculate-compound-interest", ...toolMiddleware("calculate-compound-interest"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "calculate-compound-interest", 1); if (!ok) return; }
  const { principal, rate, years, compounds_per_year = 12 } = req.body as { principal?: number; rate?: number; years?: number; compounds_per_year?: number };
  if (principal === undefined || rate === undefined || years === undefined) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "principal, rate (annual % e.g. 5 for 5%), and years are required", request_id: reqId() }); return;
  }
  if (typeof principal !== "number" || typeof rate !== "number" || typeof years !== "number" || typeof compounds_per_year !== "number") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "principal, rate, years, and compounds_per_year must be numbers", request_id: reqId() }); return;
  }
  if (principal < 0 || rate < 0 || years < 0 || compounds_per_year < 1 || compounds_per_year > 365) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Values must be non-negative; compounds_per_year must be 1-365", request_id: reqId() }); return;
  }
  const r_dec = rate / 100;
  const n = compounds_per_year;
  const t = years;
  const finalAmount = principal * Math.pow(1 + r_dec / n, n * t);
  const totalInterest = finalAmount - principal;
  const effectiveAnnualRate = (Math.pow(1 + r_dec / n, n) - 1) * 100;
  // Year-by-year breakdown (capped at 50 years)
  const schedule: Array<{ year: number; balance: number }> = [];
  const maxYears = Math.min(Math.ceil(t), 50);
  for (let y = 1; y <= maxYears; y++) {
    schedule.push({ year: y, balance: Math.round(principal * Math.pow(1 + r_dec / n, n * y) * 100) / 100 });
  }
  res.json({
    ok: true,
    inputs: { principal, annual_rate_percent: rate, years, compounds_per_year },
    results: {
      final_amount: Math.round(finalAmount * 100) / 100,
      total_interest: Math.round(totalInterest * 100) / 100,
      effective_annual_rate: Math.round(effectiveAnnualRate * 1000) / 1000,
      total_return_percent: Math.round((totalInterest / principal) * 10000) / 100,
    },
    schedule,
    request_id: reqId(),
  });
});

// ─── word-count-stats ────────────────────────────────────────────────────────
router.post("/word-count-stats", ...toolMiddleware("word-count-stats"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "word-count-stats", 1); if (!ok) return; }
  const { text } = req.body as { text?: string };
  if (!text || typeof text !== "string") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return;
  }
  if (text.length > 500_000) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Text too long (max 500,000 characters)", request_id: reqId() }); return;
  }
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const charCount = text.length;
  const charCountNoSpaces = text.replace(/\s/g, "").length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const paragraphCount = paragraphs.length || 1;
  const avgWordLength = wordCount > 0 ? Math.round((charCountNoSpaces / wordCount) * 100) / 100 : 0;
  const readingTimeMinutes = Math.round((wordCount / 238) * 10) / 10; // 238 wpm average
  const speakingTimeMinutes = Math.round((wordCount / 150) * 10) / 10; // 150 wpm speaking
  // Top words frequency
  const freq: Record<string, number> = {};
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    if (lower.length > 2) freq[lower] = (freq[lower] ?? 0) + 1;
  }
  const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));
  res.json({
    ok: true,
    stats: {
      word_count: wordCount,
      char_count: charCount,
      char_count_no_spaces: charCountNoSpaces,
      sentence_count: sentenceCount,
      paragraph_count: paragraphCount,
      avg_word_length: avgWordLength,
      reading_time_minutes: readingTimeMinutes,
      speaking_time_minutes: speakingTimeMinutes,
    },
    top_words: topWords,
    request_id: reqId(),
  });
});

// ─── exchange-rates ──────────────────────────────────────────────────────────
router.post("/exchange-rates", ...toolMiddleware("exchange-rates"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "exchange-rates", 1); if (!ok) return; }
  const { base = "USD", target } = req.body as { base?: string; target?: string };
  try {
    const baseCurrency = base.toUpperCase().trim();
    const r = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(baseCurrency)}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `Exchange rate API returned ${r.status}`, request_id: reqId() }); return; }
    const data = await r.json() as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
    if (data.result !== "success" || !data.rates) { res.status(502).json({ ok: false, error: "rate_error", message: "Could not fetch exchange rates", request_id: reqId() }); return; }
    if (target) {
      const targetCurrency = target.toUpperCase().trim();
      const rate = data.rates[targetCurrency];
      if (rate === undefined) { res.status(422).json({ ok: false, error: "invalid_currency", message: `Currency '${targetCurrency}' not found`, request_id: reqId() }); return; }
      res.json({ ok: true, base: baseCurrency, target: targetCurrency, rate, timestamp: data.time_last_update_utc ?? null, request_id: reqId() });
    } else {
      res.json({ ok: true, base: baseCurrency, rates: data.rates, currency_count: Object.keys(data.rates).length, timestamp: data.time_last_update_utc ?? null, request_id: reqId() });
    }
  } catch (e) { console.error("[exchange-rates]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── ip-geolocation ──────────────────────────────────────────────────────────
router.post("/ip-geolocation", ...toolMiddleware("ip-geolocation"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "ip-geolocation", 1); if (!ok) return; }
  const { ip } = req.body as { ip?: string };
  if (!ip) { res.status(400).json({ ok: false, error: "invalid_request", message: "ip is required", request_id: reqId() }); return; }
  try {
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip.trim())}/json/`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "ArchTools/1.9" },
    });
    if (!r.ok) {
      if (r.status === 429) { res.status(429).json({ ok: false, error: "rate_limited", message: "IP geolocation rate limit hit. Try again shortly.", request_id: reqId() }); return; }
      res.status(502).json({ ok: false, error: "fetch_error", message: `ipapi.co returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as any;
    if (data.error) { res.status(422).json({ ok: false, error: "lookup_error", message: data.reason ?? "Invalid IP address", request_id: reqId() }); return; }
    res.json({
      ok: true, ip: data.ip ?? ip,
      city: data.city ?? null, region: data.region ?? null, country: data.country_name ?? null, country_code: data.country_code ?? null,
      lat: data.latitude ?? null, lon: data.longitude ?? null,
      org: data.org ?? null, timezone: data.timezone ?? null, currency: data.currency ?? null,
      asn: data.asn ?? null, postal: data.postal ?? null,
      request_id: reqId(),
    });
  } catch (e) { console.error("[ip-geolocation]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── text-similarity ─────────────────────────────────────────────────────────
router.post("/text-similarity", ...toolMiddleware("text-similarity"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "text-similarity", 1); if (!ok) return; }
  const { text1, text2 } = req.body as { text1?: string; text2?: string };
  if (!text1 || !text2) { res.status(400).json({ ok: false, error: "invalid_request", message: "text1 and text2 are required", request_id: reqId() }); return; }
  // Jaccard similarity (word overlap)
  const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 0);
  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  const similarity = union.size > 0 ? intersection.size / union.size : 0;
  res.json({
    ok: true,
    similarity_score: Math.round(similarity * 10000) / 10000,
    common_words: [...intersection].sort(),
    common_count: intersection.size,
    text1_word_count: words1.size,
    text2_word_count: words2.size,
    union_size: union.size,
    method: "jaccard",
    request_id: reqId(),
  });
});

// ─── base64-operations ───────────────────────────────────────────────────────
router.post("/base64-operations", ...toolMiddleware("base64-operations"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "base64-operations", 1); if (!ok) return; }
  const { text, operation = "encode" } = req.body as { text?: string; operation?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  const validOps = ["encode", "decode"];
  if (!validOps.includes(operation)) { res.status(400).json({ ok: false, error: "invalid_request", message: `operation must be one of: ${validOps.join(", ")}`, request_id: reqId() }); return; }
  try {
    let result: string;
    let bytes: number;
    if (operation === "encode") {
      const buf = Buffer.from(text, "utf8");
      result = buf.toString("base64");
      bytes = buf.length;
    } else {
      const buf = Buffer.from(text, "base64");
      result = buf.toString("utf8");
      bytes = buf.length;
    }
    res.json({ ok: true, result, operation, bytes, input_length: text.length, output_length: result.length, request_id: reqId() });
  } catch (e) { res.status(422).json({ ok: false, error: "operation_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── color-convert ───────────────────────────────────────────────────────────
router.post("/color-convert", ...toolMiddleware("color-convert"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "color-convert", 1); if (!ok) return; }
  const { color, to } = req.body as { color?: string; to?: string };
  if (!color || !to) { res.status(400).json({ ok: false, error: "invalid_request", message: "color and to are required", request_id: reqId() }); return; }
  const validFormats = ["hex", "rgb", "hsl"];
  if (!validFormats.includes(to)) { res.status(400).json({ ok: false, error: "invalid_request", message: `to must be one of: ${validFormats.join(", ")}`, request_id: reqId() }); return; }
  try {
    let r: number, g: number, b: number;
    const input = color.trim();
    // Parse hex
    const hexMatch = input.match(/^#?([0-9a-fA-F]{3,8})$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    // Parse rgb(r, g, b)
    else if (input.match(/^rgb/i)) {
      const m = input.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) throw new Error("Invalid RGB format. Use: rgb(255, 0, 0)");
      r = Math.min(255, parseInt(m[1])); g = Math.min(255, parseInt(m[2])); b = Math.min(255, parseInt(m[3]));
    }
    // Parse hsl(h, s%, l%)
    else if (input.match(/^hsl/i)) {
      const m = input.match(/([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?/);
      if (!m) throw new Error("Invalid HSL format. Use: hsl(0, 100%, 50%)");
      const h = parseFloat(m[1]) / 360;
      const s = parseFloat(m[2]) / 100;
      const l = parseFloat(m[3]) / 100;
      // HSL to RGB conversion
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      if (s === 0) { r = g = b = Math.round(l * 255); }
      else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        g = Math.round(hue2rgb(p, q, h) * 255);
        b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
      }
    } else {
      throw new Error("Unrecognized color format. Use hex (#ff0000), rgb(255,0,0), or hsl(0,100%,50%)");
    }
    // Convert to target format
    let result: string;
    if (to === "hex") {
      result = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    } else if (to === "rgb") {
      result = `rgb(${r}, ${g}, ${b})`;
    } else {
      // RGB to HSL
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      let h = 0, s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
      }
      result = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    }
    res.json({ ok: true, input: color, to, result, rgb: { r, g, b }, request_id: reqId() });
  } catch (e) { res.status(422).json({ ok: false, error: "conversion_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── JWT-DECODE ──────────────────────────────────────────────────────────────

router.post("/jwt-decode", ...toolMiddleware("jwt-decode"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "jwt-decode", 1); if (!ok) return; }
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") { res.status(400).json({ ok: false, error: "invalid_request", message: "token is required", request_id: reqId() }); return; }
  try {
    const parts = token.split(".");
    if (parts.length < 2 || parts.length > 3) { res.status(422).json({ ok: false, error: "invalid_token", message: "Token must have 2 or 3 parts separated by dots", request_id: reqId() }); return; }
    const decodeBase64Url = (s: string): string => {
      const padded = s.replace(/-/g, "+").replace(/_/g, "/");
      return Buffer.from(padded, "base64").toString("utf8");
    };
    let header: unknown;
    let payload: unknown;
    try { header = JSON.parse(decodeBase64Url(parts[0])); } catch { res.status(422).json({ ok: false, error: "invalid_token", message: "Could not decode JWT header", request_id: reqId() }); return; }
    try { payload = JSON.parse(decodeBase64Url(parts[1])); } catch { res.status(422).json({ ok: false, error: "invalid_token", message: "Could not decode JWT payload", request_id: reqId() }); return; }
    const signaturePresent = parts.length === 3 && parts[2].length > 0;
    const exp = (payload as Record<string, unknown>)?.exp;
    let isExpired: boolean | null = null;
    let expiryDate: string | null = null;
    if (typeof exp === "number") {
      const expiryMs = exp * 1000;
      isExpired = Date.now() > expiryMs;
      expiryDate = new Date(expiryMs).toISOString();
    }
    res.json({ ok: true, header, payload, signature_present: signaturePresent, is_expired: isExpired, expiry_date: expiryDate, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "decode_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── CSS-MINIFY ──────────────────────────────────────────────────────────────

router.post("/css-minify", ...toolMiddleware("css-minify"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "css-minify", 1); if (!ok) return; }
  const { css } = req.body as { css?: string };
  if (!css || typeof css !== "string") { res.status(400).json({ ok: false, error: "invalid_request", message: "css is required", request_id: reqId() }); return; }
  try {
    const originalBytes = Buffer.byteLength(css, "utf8");
    let minified = css.replace(/\/\*[\s\S]*?\*\//g, "");
    minified = minified.replace(/\s+/g, " ");
    minified = minified.replace(/\s*([{}:;,>~+])\s*/g, "$1");
    minified = minified.replace(/;}/g, "}");
    minified = minified.trim();
    const minifiedBytes = Buffer.byteLength(minified, "utf8");
    const reductionPct = originalBytes > 0 ? Math.round(((originalBytes - minifiedBytes) / originalBytes) * 10000) / 100 : 0;
    res.json({ ok: true, minified, original_bytes: originalBytes, minified_bytes: minifiedBytes, reduction_pct: reductionPct, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "minify_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── MARKDOWN-TO-HTML ────────────────────────────────────────────────────────

router.post("/markdown-to-html", ...toolMiddleware("markdown-to-html"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "markdown-to-html", 1); if (!ok) return; }
  const { markdown } = req.body as { markdown?: string };
  if (!markdown || typeof markdown !== "string") { res.status(400).json({ ok: false, error: "invalid_request", message: "markdown is required", request_id: reqId() }); return; }
  try {
    let html = markdown;
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => `<pre><code${lang ? ` class="language-${lang}"` : ""}>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
    html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    html = html.replace(/^---$/gm, "<hr>");
    html = html.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
    html = html.replace(/^(?!<[a-z])((?!^\s*$).+)$/gm, "<p>$1</p>");
    html = html.replace(/<p>\s*<\/p>/g, "");
    html = html.trim();
    res.json({ ok: true, html, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "convert_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── NUMBER-FORMAT ───────────────────────────────────────────────────────────

router.post("/number-format", ...toolMiddleware("number-format"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "number-format", 1); if (!ok) return; }
  const { number, format, currency = "USD", locale = "en-US" } = req.body as { number?: number; format?: string; currency?: string; locale?: string };
  if (number === undefined || typeof number !== "number") { res.status(400).json({ ok: false, error: "invalid_request", message: "number is required and must be a number", request_id: reqId() }); return; }
  const validFormats = ["currency", "percentage", "scientific", "ordinal", "words"];
  if (!format || !validFormats.includes(format)) { res.status(400).json({ ok: false, error: "invalid_request", message: `format is required and must be one of: ${validFormats.join(", ")}`, request_id: reqId() }); return; }
  try {
    let formatted: string;
    switch (format) {
      case "currency":
        formatted = new Intl.NumberFormat(locale, { style: "currency", currency }).format(number);
        break;
      case "percentage":
        formatted = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number / 100);
        break;
      case "scientific":
        formatted = number.toExponential();
        break;
      case "ordinal": {
        const abs = Math.abs(Math.round(number));
        const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
        const mod100 = abs % 100;
        const mod10 = abs % 10;
        const suffix = (mod100 >= 11 && mod100 <= 13) ? "th" : (suffixes[mod10] ?? "th");
        formatted = `${abs}${suffix}`;
        break;
      }
      case "words": {
        const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
        const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
        const n = Math.round(number);
        if (n === 0) { formatted = "zero"; break; }
        if (n < 0) { formatted = `negative ${Math.abs(n)}`; break; }
        if (n < 20) { formatted = ones[n]; break; }
        if (n < 100) { formatted = tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : ""); break; }
        if (n < 1000) { formatted = ones[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + (n % 100 < 20 ? ones[n % 100] : tens[Math.floor((n % 100) / 10)] + (n % 10 ? "-" + ones[n % 10] : "")) : ""); break; }
        formatted = new Intl.NumberFormat(locale).format(n) + " (too large for words)";
        break;
      }
      default: formatted = String(number);
    }
    res.json({ ok: true, formatted, raw: number, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "format_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── TIMEZONE-NOW ────────────────────────────────────────────────────────────

router.post("/timezone-now", ...toolMiddleware("timezone-now"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "timezone-now", 1); if (!ok) return; }
  const { timezone, format = "iso" } = req.body as { timezone?: string; format?: string };
  if (!timezone || typeof timezone !== "string") { res.status(400).json({ ok: false, error: "invalid_request", message: "timezone is required (e.g. America/New_York)", request_id: reqId() }); return; }
  const validFormats = ["iso", "readable", "unix"];
  if (!validFormats.includes(format)) { res.status(400).json({ ok: false, error: "invalid_request", message: `format must be one of: ${validFormats.join(", ")}`, request_id: reqId() }); return; }
  try {
    const now = new Date();
    const tzFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset" });
    const formatted = tzFormatter.format(now);
    const offsetMatch = formatted.match(/GMT([+-]\d{2}:\d{2})/);
    const utcOffset = offsetMatch ? offsetMatch[1] : "unknown";
    const shortFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" });
    const shortParts = shortFormatter.formatToParts(now);
    const timezoneName = shortParts.find(p => p.type === "timeZoneName")?.value ?? timezone;
    const jan = new Date(now.getFullYear(), 0, 1);
    const jul = new Date(now.getFullYear(), 6, 1);
    const janOffset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).format(jan);
    const julOffset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).format(jul);
    const isDst = janOffset !== julOffset && formatted.includes(julOffset.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? "___NOMATCH___") ? true : janOffset !== julOffset && formatted.includes(janOffset.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? "___NOMATCH___") ? false : null;
    let datetime: string;
    const readableFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    switch (format) {
      case "unix": datetime = Math.floor(now.getTime() / 1000).toString(); break;
      case "readable": datetime = readableFormatter.format(now); break;
      default: datetime = now.toLocaleString("sv-SE", { timeZone: timezone }).replace(" ", "T"); break;
    }
    res.json({ ok: true, datetime, unix_timestamp: Math.floor(now.getTime() / 1000), utc_offset: utcOffset, timezone_name: timezoneName, is_dst: isDst, request_id: reqId() });
  } catch (e) {
    const msg = safeErr(e);
    if (msg.includes("Invalid time zone") || msg.includes("timeZone")) {
      res.status(422).json({ ok: false, error: "invalid_timezone", message: `Invalid timezone: ${timezone}`, request_id: reqId() });
    } else {
      res.status(500).json({ ok: false, error: "timezone_error", message: msg, request_id: reqId() });
    }
  }
});

// ─── HTML-EXTRACT-TEXT ───────────────────────────────────────────────────────

router.post("/html-extract-text", ...toolMiddleware("html-extract-text"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "html-extract-text", 1); if (!ok) return; }
  const { html } = req.body as { html?: string };
  if (!html || typeof html !== "string") { res.status(400).json({ ok: false, error: "invalid_request", message: "html is required", request_id: reqId() }); return; }
  try {
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    text = text.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)));
    text = text.replace(/\s+/g, " ").trim();
    const words = text.split(/\s+/).filter(w => w.length > 0);
    res.json({ ok: true, text, word_count: words.length, char_count: text.length, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "extract_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── GET handler for x402scan compatibility ─────────────────────────────────
// x402scan sends GET to each anonymous-x402 endpoint and expects 402 Payment
// Required. Account-backed side-effect tools intentionally stay out of this
// discovery path. Never run settlement middleware on GET: a paid GET probe
// would collect funds without ever executing the POST-only tool
// (pay-and-get-nothing) — so build the 402 payment requirement DIRECTLY.
router.get("/:toolName", (req: Request, res: Response): void => {
  const paramToolName = req.params.toolName;
  const toolName = Array.isArray(paramToolName) ? paramToolName[0] : paramToolName;
  if (!toolName) {
    res.status(404).json({ error: "unknown_tool", message: "Tool not found" });
    return;
  }
  const price = X402_PRICES[toolName];
  if (!price || !isX402AnonymousTool(toolName)) {
    res.status(404).json({ error: "unknown_tool", message: `Tool '${toolName}' not found` });
    return;
  }

  const paymentRequired = buildPaymentRequiredV2(toolName, price);
  const paymentRequiredB64 = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
  res.status(402)
    .header("Content-Type", "application/json")
    .header("PAYMENT-REQUIRED", paymentRequiredB64)
    .header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, Payment-Required, PAYMENT-SIGNATURE, Payment-Signature, PAYMENT-RESPONSE, Payment-Response, X-Payment, X-Payment-Response")
    .json(paymentRequired);
});

export default router;
