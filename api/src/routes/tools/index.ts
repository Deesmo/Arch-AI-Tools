import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, AuthedRequest } from "../../middleware/auth";
import { x402Middleware } from "../../middleware/x402";
import { deductCredits, reqId, safeErr } from "../../utils/credits";
import { getCached, setCached } from "../../lib/lru";
import { config } from "../../config";
import { validateUrl } from "../../lib/ssrf";
import crypto from "crypto";
import { v1 as uuidv1, v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";

const router = Router();
const _anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropic = (_anthropicKey && !_anthropicKey.startsWith("ENTER"))
  ? new Anthropic({ apiKey: _anthropicKey })
  : null;

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
  const tier = agent?.tier ?? "free";
  const limit = tier === "business" ? config.rateLimits.business
              : tier === "pro"      ? config.rateLimits.pro
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
      message: `Rate limit of ${limit} req/min exceeded for ${tier} tier. Upgrade at archtools.dev.`,
      request_id: reqId(),
    });
    return;
  }

  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", limit - record.count);
  next();
}

// ─── Helper: combined x402 + auth + rate limit middleware ────────────────────

function toolMiddleware(toolName: string) {
  return [x402Middleware(toolName), requireAuth, tierRateLimiter];
}

function isX402Paid(req: Request): boolean {
  return !!(req as Request & { x402Paid?: boolean }).x402Paid;
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
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
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
  const { text, format = "png", size = 256, error_correction = "M" } = req.body as { text?: string; format?: string; size?: number; error_correction?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
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
  const { input, from, to } = req.body as { input?: string; from?: string; to?: string };
  if (!input || !from || !to) { res.status(400).json({ ok: false, error: "invalid_request", message: "input, from, and to are required", request_id: reqId() }); return; }
  try {
    const yaml = await import("js-yaml");
    let parsed: unknown;
    if (from === "json") parsed = JSON.parse(input);
    else if (from === "yaml") parsed = yaml.load(input);
    else if (from === "csv") {
      const { parse } = await import("csv-parse/sync");
      parsed = parse(input, { columns: true, skip_empty_lines: true });
    } else if (from === "xml") {
      const xml2js = await import("xml2js");
      parsed = await xml2js.parseStringPromise(input);
    } else { res.status(400).json({ ok: false, error: "invalid_request", message: `Unsupported from format: ${from}`, request_id: reqId() }); return; }

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
    } else { res.status(400).json({ ok: false, error: "invalid_request", message: `Unsupported to format: ${to}`, request_id: reqId() }); return; }

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
  const { text, mode } = req.body as { text?: string; mode?: string };
  if (!text || !mode) { res.status(400).json({ ok: false, error: "invalid_request", message: "text and mode are required", request_id: reqId() }); return; }
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
      const resp = await axios.get(url, { timeout: 10000, headers: { "User-Agent": "ArchTools/1.5 Metadata Extractor" } });
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
    const resp = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "ArchTools/1.5 Web Scraper (https://archtools.dev)" } });
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
    res.json({ ok: true, url, title: $("title").text(), text: content.slice(0, 8000), word_count: content.split(/\s+/).length, links: links.slice(0, 30), status_code: resp.status, request_id: reqId() });
  } catch (e) {
    const status = axios.isAxiosError(e) ? (e.response?.status ?? 502) : 500;
    res.status(status).json({ ok: false, error: "scrape_error", message: safeErr(e), request_id: reqId() });
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
    const resp = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "ArchTools/1.5" } });
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
  const { query, num_results = 5 } = req.body as { query?: string; num_results?: number };
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return; }
  try {
    // Brave Search (uses SERPER_API_KEY env var which is set to Brave key)
    if (process.env.SERPER_API_KEY) {
      try {
        const resp = await fetch("https://api.search.brave.com/res/v1/web/search?" + new URLSearchParams({ q: query, count: String(Math.min(num_results, 10)) }), {
          headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": process.env.SERPER_API_KEY },
        });
        if (resp.ok) {
          const data = await resp.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
          const results = (data.web?.results ?? []).map(r => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "" }));
          if (results.length > 0) {
            res.json({ ok: true, query, results, count: results.length, source: "brave", request_id: reqId() }); return;
          }
        }
      } catch (_) { /* fall through to DDG */ }
    }
    // Fallback: DuckDuckGo Instant Answer
    const resp = await axios.get("https://api.duckduckgo.com/", {
      params: { q: query, format: "json", no_redirect: 1, no_html: 1, skip_disambig: 1 },
      timeout: 8000,
    });
    const data = resp.data as { AbstractText?: string; AbstractURL?: string; RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> };
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: query, url: data.AbstractURL, snippet: data.AbstractText.slice(0, 300) });
    }
    (data.RelatedTopics ?? []).slice(0, num_results - results.length).forEach(t => {
      if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 300) });
    });
    res.json({ ok: true, query, results: results.slice(0, num_results), count: results.length, request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "search_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 10. WEB-SEARCH (AI-synthesized) ─────────────────────────────────────────

router.post("/web-search", ...toolMiddleware("web-search"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "web-search", 10);
    if (!ok) return;
  }
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { query } = req.body as { query?: string };
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return; }
  try {
    // Get raw results first
    const raw = await axios.get("https://api.duckduckgo.com/", { params: { q: query, format: "json", no_html: 1 }, timeout: 6000 });
    const d = raw.data as { AbstractText?: string; RelatedTopics?: Array<{ Text?: string }> };
    const context = [d.AbstractText, ...(d.RelatedTopics ?? []).slice(0, 5).map(t => t.Text)].filter(Boolean).join("\n\n").slice(0, 3000);
    // Synthesize with Claude
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: `Answer this query based on the following search context. Be concise and factual.\n\nQuery: ${query}\n\nContext:\n${context}\n\nAnswer:` }],
    });
    const answer = msg.content.find(b => b.type === "text")?.text ?? "";
    res.json({ ok: true, query, answer, request_id: reqId() });
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
    const resp = await axios.get(url, { timeout: 10000, headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
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
  try {
    const resp = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,proxy,hosting,query`, { timeout: 6000 });
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
  try {
    const resp = await axios.get(`https://rdap.org/domain/${clean}`, { timeout: 10000, headers: { "Accept": "application/json" } });
    const data = resp.data as Record<string, unknown>;
    const events = (data.events as Array<{ eventAction: string; eventDate: string }>) ?? [];
    const nameservers = ((data.nameservers as Array<{ ldhName: string }>) ?? []).map(ns => ns.ldhName);
    const created = events.find(e => e.eventAction === "registration")?.eventDate ?? null;
    const expires = events.find(e => e.eventAction === "expiration")?.eventDate ?? null;
    const updated = events.find(e => e.eventAction === "last changed")?.eventDate ?? null;
    res.json({ ok: true, domain: clean, status: data.status, registered: created, expires, last_updated: updated, nameservers, registrar: (data.entities as Array<Record<string, unknown>>)?.[0]?.handle ?? null, request_id: reqId() });
  } catch (e) {
    res.status(502).json({ ok: false, error: "whois_error", message: safeErr(e), request_id: reqId() });
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
  const { text1, text2, mode = "words" } = req.body as { text1?: string; text2?: string; mode?: string };
  if (!text1 || !text2) { res.status(400).json({ ok: false, error: "invalid_request", message: "text1 and text2 are required", request_id: reqId() }); return; }
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
    if (anthropic) {
      const msg = await anthropic.messages.create({
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text } = req.body as { text?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    const msg = await anthropic.messages.create({
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
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
    const msg = await anthropic.messages.create({
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text } = req.body as { text?: string };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    const msg = await anthropic.messages.create({
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { description, examples } = req.body as { description?: string; examples?: string[] };
  if (!description) { res.status(400).json({ ok: false, error: "invalid_request", message: "description is required", request_id: reqId() }); return; }
  try {
    const msg = await anthropic.messages.create({
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { text, redact = false } = req.body as { text?: string; redact?: boolean };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: `Detect PII in this text${redact ? " and provide redacted version" : ""}. Return ONLY JSON:\n{"found": [{"type": "email|phone|ssn|credit_card|name|address|dob|ip", "value": "...", "start": 0, "end": 5}], "has_pii": true${redact ? ', "redacted": "text with [EMAIL] placeholders"' : ""}}\n\nText: ${text.slice(0, 4000)}` }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { found?: unknown[]; has_pii?: boolean; redacted?: string };
    res.json({ ok: true, has_pii: parsed.has_pii ?? false, found: parsed.found ?? [], count: (parsed.found ?? []).length, ...(redact ? { redacted: parsed.redacted ?? text } : {}), request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "pii_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── 27. AI-GENERATE ─────────────────────────────────────────────────────────

router.post("/ai-generate", ...toolMiddleware("ai-generate"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) {
    const ok = await deductCredits(req, res, "ai-generate", 20);
    if (!ok) return;
  }
  const { prompt, system, model = "claude-sonnet-4-6", max_tokens = 1000 } = req.body as { prompt?: string; system?: string; model?: string; max_tokens?: number };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  const MAX_PROMPT = parseInt(process.env.AI_MAX_PROMPT_CHARS ?? "32000", 10);
  if (prompt.length > MAX_PROMPT) { res.status(400).json({ ok: false, error: "prompt_too_long", message: `Prompt exceeds ${MAX_PROMPT} character limit`, request_id: reqId() }); return; }

  const CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];
  const GPT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
  const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
  const GROK_MODELS = ["grok-3", "grok-3-fast", "grok-2"];

  const maxTok = Math.min(max_tokens, 4096);

  try {
    // ── OpenAI (GPT-4o, GPT-4-turbo, GPT-3.5) — check before Claude to avoid default fallthrough ──
    if (GPT_MODELS.includes(model)) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "OPENAI_API_KEY not set", request_id: reqId() }); return; }
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTok, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
      });
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? "";
      res.json({ ok: true, text, model, provider: "openai", usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 }, request_id: reqId() });
      return;
    }

    // ── Google Gemini ──
    if (GEMINI_MODELS.includes(model)) {
      const googleKey = process.env.GOOGLE_API_KEY;
      if (!googleKey || googleKey.startsWith("ENTER")) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires a Google API key that has not been configured.", request_id: reqId() }); return; }
      const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { maxOutputTokens: maxTok } }),
      });
      const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      res.json({ ok: true, text, model, provider: "google", usage: { input_tokens: data.usageMetadata?.promptTokenCount ?? 0, output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0 }, request_id: reqId() });
      return;
    }

    // ── xAI Grok ──
    if (GROK_MODELS.includes(model)) {
      const xaiKey = process.env.XAI_API_KEY;
      if (!xaiKey || xaiKey.startsWith("ENTER")) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an xAI API key that has not been configured.", request_id: reqId() }); return; }
      const resp = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${xaiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTok, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
      });
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = data.choices?.[0]?.message?.content ?? "";
      res.json({ ok: true, text, model, provider: "xai", usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 }, request_id: reqId() });
      return;
    }

    // Validate model
    const allModels = [...CLAUDE_MODELS, ...GPT_MODELS, ...GEMINI_MODELS, ...GROK_MODELS];
    if (!allModels.includes(model)) {
      res.status(400).json({ ok: false, error: "invalid_model", message: `Unknown model '${model}'. Valid models: ${allModels.join(", ")}`, request_id: reqId() });
      return;
    }

    // ── Claude ──
    if (CLAUDE_MODELS.includes(model)) {
      if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
      const msg = await anthropic.messages.create({ model, max_tokens: maxTok, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] });
      const text = msg.content.find(b => b.type === "text")?.text ?? "";
      res.json({ ok: true, text, model, provider: "anthropic", usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }, request_id: reqId() });
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
    const ok = await deductCredits(req, res, "ocr-extract", 10);
    if (!ok) return;
  }
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { image_url, image_base64, media_type = "image/jpeg" } = req.body as { image_url?: string; image_base64?: string; media_type?: string };
  if (!image_url && !image_base64) { res.status(400).json({ ok: false, error: "invalid_request", message: "image_url or image_base64 is required", request_id: reqId() }); return; }
  try {
    let imgBase64 = image_base64;
    let imgMediaType: string = media_type;
    if (image_url && !image_base64) {
      try { await validateUrl(image_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      const imgResp = await axios.get(image_url, { responseType: "arraybuffer", timeout: 15000 });
      imgBase64 = Buffer.from(imgResp.data as ArrayBuffer).toString("base64");
      imgMediaType = (imgResp.headers["content-type"] as string || "image/jpeg").split(";")[0];
    }
    const imageContent = { type: "image" as const, source: { type: "base64" as const, media_type: imgMediaType as "image/jpeg", data: imgBase64! } };
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: [imageContent, { type: "text", text: "Extract all text from this image. Return the text exactly as it appears, preserving formatting and structure." }] }],
    });
    const text = msg.content.find(b => b.type === "text")?.text ?? "";
    res.json({ ok: true, text, word_count: text.split(/\s+/).length, request_id: reqId() });
  } catch (e) {
    console.error("[ocr-extract] error:", e);
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
  const { url, action = "extract", selector, text: inputText } = req.body as { url?: string; action?: string; selector?: string; text?: string };
  if (!url) { res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() }); return; }
  try { await validateUrl(url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  // Fallback: use axios + cheerio for extract (Playwright not available on Render free tier)
  try {
    const resp = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 ArchTools Browser Task" } });
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { pdf_url, pdf_base64 } = req.body as { pdf_url?: string; pdf_base64?: string };
  if (!pdf_url && !pdf_base64) { res.status(400).json({ ok: false, error: "invalid_request", message: "pdf_url or pdf_base64 is required", request_id: reqId() }); return; }
  try {
    let base64Data = pdf_base64;
    if (pdf_url && !pdf_base64) {
      try { await validateUrl(pdf_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
      const resp = await axios.get(pdf_url, { responseType: "arraybuffer", timeout: 20000 });
      const buffer = Buffer.from(resp.data as ArrayBuffer);
      if (buffer.length > 5 * 1024 * 1024) {
        res.status(400).json({ ok: false, error: "file_too_large", message: "PDF must be under 5MB", request_id: reqId() });
        return;
      }
      base64Data = buffer.toString("base64");
    }
    try {
      const msg = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data! } }, { type: "text", text: "Extract all text from this PDF. Preserve the structure and formatting as much as possible." }] }],
      });
      const text = msg.content.find(b => b.type === "text")?.text ?? "";
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
    const resp = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 ArchTools Screenshot" } });
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
      const resp = await axios.get(url, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0 ArchTools" } });
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
    const ok = await deductCredits(req, res, "webhook-send", 2);
    if (!ok) return;
  }
  const { webhook_url, payload, headers: customHeaders = {}, method = "POST" } = req.body as {
    webhook_url?: string;
    payload?: unknown;
    headers?: Record<string, string>;
    method?: string;
  };
  if (!webhook_url) { res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url is required", request_id: reqId() }); return; }
  if (!webhook_url.startsWith("http")) { res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url must be a valid http/https URL", request_id: reqId() }); return; }
  try { await validateUrl(webhook_url); } catch (err) { res.status(400).json({ ok: false, error: "invalid_url", message: (err as Error).message, request_id: reqId() }); return; }
  const allowedMethods = ["POST", "PUT", "PATCH"];
  const httpMethod = allowedMethods.includes(method.toUpperCase()) ? method.toUpperCase() : "POST";
  try {
    const start = Date.now();
    const resp = await axios({
      method: httpMethod as "POST" | "PUT" | "PATCH",
      url: webhook_url,
      data: payload ?? {},
      headers: { "Content-Type": "application/json", "User-Agent": "ArchTools-Webhook/1.0", ...customHeaders },
      timeout: 10000,
      validateStatus: () => true,
    });
    res.json({
      ok: true,
      webhook_url,
      method: httpMethod,
      status_code: resp.status,
      response_ms: Date.now() - start,
      response_body: String(resp.data).slice(0, 500),
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
  const { data, path: jsonPath } = req.body as { data?: unknown; path?: string };
  if (!data || !jsonPath) { res.status(400).json({ ok: false, error: "invalid_request", message: "data and path are required", request_id: reqId() }); return; }
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
    const ok = await deductCredits(req, res, "image-generate", 15);
    if (!ok) return;
  }
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { prompt, style = "svg", width = 400, height = 300 } = req.body as { prompt?: string; style?: string; width?: number; height?: number };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Generate a complete, self-contained SVG image (${width}x${height}) based on this prompt: "${prompt}"\n\nRequirements:\n- Valid SVG with viewBox="0 0 ${width} ${height}"\n- Use only SVG elements (rect, circle, path, text, etc.)\n- Make it visually appealing and creative\n- Return ONLY the SVG code, nothing else, no markdown fences`,
      }],
    });
    const svg = msg.content.find(b => b.type === "text")?.text ?? "";
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
  const { data: barcodeData, type = "code128", width = 250, height = 100 } = req.body as { data?: string; type?: string; width?: number; height?: number };
  if (!barcodeData) { res.status(400).json({ ok: false, error: "invalid_request", message: "data is required", request_id: reqId() }); return; }
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
  <text x="${svgWidth / 2}" y="${height - 2}" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">${chars}</text>
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
  if (!anthropic) { res.status(503).json({ ok: false, error: "service_unavailable", message: "This tool requires an Anthropic API key that has not been configured.", request_id: reqId() }); return; }
  const { goal, context, steps } = req.body as { goal?: string; context?: string; steps?: number };
  if (!goal) { res.status(400).json({ ok: false, error: "invalid_request", message: "goal is required", request_id: reqId() }); return; }
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: `You are an autonomous agent. Complete this goal in ${steps ?? 3} steps, then provide a final answer.\n\nGoal: ${goal}\n${context ? `Context: ${context}` : ""}\n\nReturn ONLY JSON:\n{"steps": [{"step": 1, "action": "...", "result": "..."}], "final_answer": "...", "success": true}`,
      }],
    });
    const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { steps?: unknown[]; final_answer?: string; success?: boolean };
    res.json({ ok: true, goal, steps: parsed.steps ?? [], final_answer: parsed.final_answer ?? "", success: parsed.success ?? true, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "workflow_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── CRYPTO TOOLS ─────────────────────────────────────────────────────────────
// Helper: returns CoinGecko headers, including API key when configured
const cgHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { "Accept": "application/json", "User-Agent": "ArchTools/1.6" };
  const key = config.coingecko?.apiKey;
  if (key && key.length > 10 && !key.startsWith("REPLACE")) h["x-cg-pro-api-key"] = key;
  return h;
};

// ─── crypto-price ────────────────────────────────────────────────────────────
router.post("/crypto-price", ...toolMiddleware("crypto-price"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-price", 1); if (!ok) return; }
  const { symbol, currency = "usd" } = req.body as { symbol?: string; currency?: string };
  if (!symbol) { res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required (e.g. bitcoin, ethereum)", request_id: reqId() }); return; }
  try {
    const id = symbol.toLowerCase().trim();
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`, { headers: cgHeaders() });
    if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `CoinGecko returned ${r.status}`, request_id: reqId() }); return; }
    const data = await r.json() as Record<string, Record<string, number>>;
    if (!data || !data[id]) {
      res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found or CoinGecko rate limit hit. Try again in a moment or use a Pro API key.`, request_id: reqId() });
      return;
    }
    const d = data[id];
    res.json({ ok: true, symbol: id, currency, price: d[currency], change_24h: d[`${currency}_24h_change`], market_cap: d[`${currency}_market_cap`], volume_24h: d[`${currency}_24h_vol`], request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-ohlcv ────────────────────────────────────────────────────────────
router.post("/crypto-ohlcv", ...toolMiddleware("crypto-ohlcv"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-ohlcv", 2); if (!ok) return; }
  const { symbol, days = 7, currency = "usd" } = req.body as { symbol?: string; days?: number; currency?: string };
  if (!symbol) { res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required", request_id: reqId() }); return; }
  try {
    const id = symbol.toLowerCase().trim();
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=${currency}&days=${days}`, { headers: cgHeaders() });
    if (!r.ok) { res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found`, request_id: reqId() }); return; }
    const raw = await r.json() as number[][];
    const candles = raw.map(([ts, o, h, l, c]) => ({ timestamp: ts, open: o, high: h, low: l, close: c }));
    res.json({ ok: true, symbol: id, currency, days, candles, count: candles.length, request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-market-cap ───────────────────────────────────────────────────────
router.post("/crypto-market-cap", ...toolMiddleware("crypto-market-cap"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-market-cap", 1); if (!ok) return; }
  const { limit = 10, currency = "usd" } = req.body as { limit?: number; currency?: string };
  try {
    const n = Math.min(Math.max(1, limit), 100);

    // Try CoinGecko with exponential backoff (Render IPs get rate-limited)
    const cgUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${n}&page=1&sparkline=false`;
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
      res.json({ ok: true, currency, coins, source: "coingecko", request_id: reqId() }); return;
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
      res.json({ ok: true, currency: "usd", coins, source: "coincap_fallback", request_id: reqId() }); return;
    }

    res.status(502).json({ ok: false, error: "fetch_error", message: "Both CoinGecko and CoinCap are unavailable. Try again shortly.", request_id: reqId() });
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
    res.json({ ok: true, current: latest, history, interpretation: Number(latest.value) < 25 ? "Extreme Fear — potential buy signal for contrarians" : Number(latest.value) > 75 ? "Extreme Greed — potential sell signal" : "Neutral zone", request_id: reqId() });
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
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false`, { headers: cgHeaders() });
    if (!r.ok) { res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found`, request_id: reqId() }); return; }
    const data = await r.json() as { sentiment_votes_up_percentage?: number; sentiment_votes_down_percentage?: number; community_data?: { twitter_followers?: number; reddit_subscribers?: number; reddit_active_accounts?: number }; market_data?: { price_change_percentage_24h?: number; price_change_percentage_7d?: number } };
    res.json({
      ok: true, symbol: id,
      sentiment: { votes_up_pct: data.sentiment_votes_up_percentage ?? null, votes_down_pct: data.sentiment_votes_down_percentage ?? null, overall: (data.sentiment_votes_up_percentage ?? 50) > 60 ? "bullish" : (data.sentiment_votes_up_percentage ?? 50) < 40 ? "bearish" : "neutral" },
      community: { twitter_followers: data.community_data?.twitter_followers ?? null, reddit_subscribers: data.community_data?.reddit_subscribers ?? null, reddit_active: data.community_data?.reddit_active_accounts ?? null },
      price_momentum: { change_24h: data.market_data?.price_change_percentage_24h ?? null, change_7d: data.market_data?.price_change_percentage_7d ?? null },
      request_id: reqId()
    });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── crypto-news ─────────────────────────────────────────────────────────────
router.post("/crypto-news", ...toolMiddleware("crypto-news"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "crypto-news", 2); if (!ok) return; }
  const { symbol, limit = 10 } = req.body as { symbol?: string; limit?: number };
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
      // Filter by symbol if provided
      if (symbol && articles.length > 0) {
        const q = symbol.toLowerCase();
        const filtered = articles.filter(a => a.title.toLowerCase().includes(q));
        if (filtered.length > 0) articles = filtered;
      }
      articles = articles.slice(0, n);
    }

    res.json({ ok: true, symbol: symbol ?? "all", articles, count: articles.length, request_id: reqId() });
  } catch (e) {
    res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── token-lookup ─────────────────────────────────────────────────────────────
router.post("/token-lookup", ...toolMiddleware("token-lookup"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "token-lookup", 1); if (!ok) return; }
  const { query } = req.body as { query?: string };
  if (!query) { res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: reqId() }); return; }
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, { headers: cgHeaders() });
    if (!r.ok) { res.status(502).json({ ok: false, error: "fetch_error", message: `CoinGecko returned ${r.status}`, request_id: reqId() }); return; }
    const data = await r.json() as { coins?: { id: string; name: string; symbol: string; market_cap_rank?: number; thumb?: string }[] };
    const coins = (data.coins ?? []).slice(0, 10).map(c => ({ id: c.id, name: c.name, symbol: c.symbol.toUpperCase(), market_cap_rank: c.market_cap_rank ?? null }));
    res.json({ ok: true, query, results: coins, count: coins.length, tip: "Use the 'id' field with other crypto tools (e.g. crypto-price)", request_id: reqId() });
  } catch (e) { res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

export default router;

// ─── text-to-speech ───────────────────────────────────────────────────────────
router.post("/text-to-speech", ...toolMiddleware("text-to-speech"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "text-to-speech", 5); if (!ok) return; }
  const { text, voice_id = "EXAVITQu4vr4xnSDxMaL", model_id = "eleven_turbo_v2_5", stability = 0.5, similarity_boost = 0.75 } = req.body as { text?: string; voice_id?: string; model_id?: string; stability?: number; similarity_boost?: number };
  if (!text) { res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: reqId() }); return; }
  if (text.length > 5000) { res.status(400).json({ ok: false, error: "invalid_request", message: "text must be 5000 chars or less", request_id: reqId() }); return; }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Text-to-speech not configured", request_id: reqId() }); return; }
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
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
  if (!paid) { const ok = await deductCredits(req, res, "transcribe-audio", 8); if (!ok) return; }
  const { audio_url, language, prompt: whisperPrompt } = req.body as { audio_url?: string; language?: string; prompt?: string };
  if (!audio_url) { res.status(400).json({ ok: false, error: "invalid_request", message: "audio_url is required", request_id: reqId() }); return; }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Transcription not configured", request_id: reqId() }); return; }
  try {
    // Fetch audio file
    const audioResp = await fetch(audio_url, { signal: AbortSignal.timeout(30000) });
    if (!audioResp.ok) { res.status(400).json({ ok: false, error: "fetch_error", message: `Could not fetch audio URL (${audioResp.status})`, request_id: reqId() }); return; }
    const audioBuffer = await audioResp.arrayBuffer();
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
  } catch (e) { console.error("[transcribe-audio]", e); res.status(500).json({ ok: false, error: "fetch_error", message: safeErr(e), request_id: reqId() }); }
});

// ─── email-send ───────────────────────────────────────────────────────────────
router.post("/email-send", ...toolMiddleware("email-send"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "email-send", 3); if (!ok) return; }
  const { to, subject, body, from, html } = req.body as { to?: string; subject?: string; body?: string; from?: string; html?: string };
  if (!to || !subject || (!body && !html)) { res.status(400).json({ ok: false, error: "invalid_request", message: "to, subject, and body (or html) are required", request_id: reqId() }); return; }
  if (!to.includes("@")) { res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid email address", request_id: reqId() }); return; }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Email sending not configured", request_id: reqId() }); return; }
  try {
    const fromAddr = from ?? "Arch Tools <no-reply@archtools.dev>";
    const htmlBody = html ?? `<p>${(body ?? "").replace(/\n/g, "<br>")}</p>`;
    const textBody = body ?? html?.replace(/<[^>]+>/g, "") ?? "";
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

// ─── design-create ────────────────────────────────────────────────────────────
router.post("/design-create", ...toolMiddleware("design-create"), async (req: AuthedRequest, res: Response): Promise<void> => {
  const paid = isX402Paid(req);
  if (!paid) { const ok = await deductCredits(req, res, "design-create", 15); if (!ok) return; }
  const { prompt, size = "1024x1024", quality = "standard", style = "vivid", n = 1 } = req.body as { prompt?: string; size?: string; quality?: string; style?: string; n?: number };
  if (!prompt) { res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: reqId() }); return; }
  const validSizes = ["1024x1024", "1792x1024", "1024x1792"];
  const safeSize = validSizes.includes(size) ? size : "1024x1024";
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { res.status(503).json({ ok: false, error: "not_configured", message: "Image generation not configured", request_id: reqId() }); return; }
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "dall-e-3", prompt, size: safeSize, quality, style, n: Math.min(n, 1), response_format: "url" })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { error?: { message?: string } };
      console.error("[design-create] OpenAI error:", r.status, err);
      res.status(502).json({ ok: false, error: "generation_error", message: err.error?.message ?? `OpenAI returned ${r.status}`, request_id: reqId() }); return;
    }
    const data = await r.json() as { data?: { url: string; revised_prompt?: string }[] };
    const images = (data.data ?? []).map(img => ({ url: img.url, revised_prompt: img.revised_prompt ?? null }));
    res.json({ ok: true, images, count: images.length, size: safeSize, quality, style, request_id: reqId() });
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
      dev: "https://rdap.nic.google/v1/domain/",
      app: "https://rdap.nic.google/v1/domain/",
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
