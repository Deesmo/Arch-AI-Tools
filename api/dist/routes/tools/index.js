"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const x402_1 = require("../../middleware/x402");
const credits_1 = require("../../utils/credits");
const config_1 = require("../../config");
const crypto_1 = __importDefault(require("crypto"));
const uuid_1 = require("uuid");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const axios_1 = __importDefault(require("axios"));
const router = (0, express_1.Router)();
const anthropic = process.env.ANTHROPIC_API_KEY
    ? new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;
// ─── Per-key rate limiter (runs AFTER auth so we know the tier) ───────────────
const requestCounts = new Map();
// Clean up expired rate limit entries every 5 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetAt)
            requestCounts.delete(key);
    }
}, 5 * 60 * 1000);
function tierRateLimiter(req, res, next) {
    const agent = req.agent;
    const key = agent?.apiKey?.slice(0, 20) ?? req.ip ?? "anon";
    const tier = agent?.tier ?? "free";
    const limit = tier === "business" ? config_1.config.rateLimits.business
        : tier === "pro" ? config_1.config.rateLimits.pro
            : config_1.config.rateLimits.free;
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
            request_id: (0, credits_1.reqId)(),
        });
        return;
    }
    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", limit - record.count);
    next();
}
// ─── Helper: combined x402 + auth + rate limit middleware ────────────────────
function toolMiddleware(toolName) {
    return [(0, x402_1.x402Middleware)(toolName), auth_1.requireAuth, tierRateLimiter];
}
function isX402Paid(req) {
    return !!req.x402Paid;
}
// ─── 1. VALIDATE-DATA ────────────────────────────────────────────────────────
router.post("/validate-data", ...toolMiddleware("validate-data"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "validate-data", 1);
        if (!ok)
            return;
    }
    const { data, schema } = req.body;
    if (data === undefined || !schema) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "data and schema are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        // Simple JSON Schema validation (type checking)
        const errors = [];
        function validate(val, sc, path) {
            const t = sc["type"];
            if (t === "object" && (typeof val !== "object" || val === null || Array.isArray(val))) {
                errors.push(`${path}: expected object`);
                return;
            }
            if (t === "array" && !Array.isArray(val)) {
                errors.push(`${path}: expected array`);
                return;
            }
            if (t === "string" && typeof val !== "string") {
                errors.push(`${path}: expected string`);
                return;
            }
            if (t === "number" && typeof val !== "number") {
                errors.push(`${path}: expected number`);
                return;
            }
            if (t === "boolean" && typeof val !== "boolean") {
                errors.push(`${path}: expected boolean`);
                return;
            }
            const required = sc["required"];
            const properties = sc["properties"];
            if (required && typeof val === "object" && val !== null) {
                for (const r of required) {
                    if (!(r in val))
                        errors.push(`${path}.${r}: required field missing`);
                }
            }
            if (properties && typeof val === "object" && val !== null) {
                for (const [k, subSchema] of Object.entries(properties)) {
                    if (k in val) {
                        validate(val[k], subSchema, `${path}.${k}`);
                    }
                }
            }
        }
        validate(data, schema, "$");
        res.json({ ok: true, valid: errors.length === 0, errors, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "validation_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 2. GENERATE-HASH ────────────────────────────────────────────────────────
router.post("/generate-hash", ...toolMiddleware("generate-hash"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "generate-hash", 1);
        if (!ok)
            return;
    }
    const { text, algorithm = "sha256", encoding = "hex" } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const algos = ["sha256", "sha512", "sha1", "md5", "sha384"];
    if (!algos.includes(algorithm)) {
        res.status(400).json({ ok: false, error: "invalid_request", message: `algorithm must be one of: ${algos.join(", ")}`, request_id: (0, credits_1.reqId)() });
        return;
    }
    const enc = (encoding === "base64" ? "base64" : "hex");
    const hash = crypto_1.default.createHash(algorithm).update(text, "utf8").digest(enc);
    res.json({ ok: true, hash, algorithm, encoding: enc, length: hash.length, input_length: text.length, request_id: (0, credits_1.reqId)() });
});
// ─── 3. QR-CODE ──────────────────────────────────────────────────────────────
router.post("/qr-code", ...toolMiddleware("qr-code"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "qr-code", 2);
        if (!ok)
            return;
    }
    const { text, format = "png", size = 256, error_correction = "M" } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const QRCode = await Promise.resolve().then(() => __importStar(require("qrcode")));
        const ecl = (["L", "M", "Q", "H"].includes(error_correction ?? "M") ? error_correction : "M");
        if (format === "svg") {
            const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: ecl });
            res.json({ ok: true, format: "svg", data: svg, request_id: (0, credits_1.reqId)() });
        }
        else {
            const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: ecl, width: Math.min(Math.max(size, 64), 1024) });
            res.json({ ok: true, format: "png", data: dataUrl, request_id: (0, credits_1.reqId)() });
        }
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "qr_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 4. CONVERT-FORMAT ───────────────────────────────────────────────────────
router.post("/convert-format", ...toolMiddleware("convert-format"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "convert-format", 2);
        if (!ok)
            return;
    }
    const { input, from, to } = req.body;
    if (!input || !from || !to) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "input, from, and to are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const yaml = await Promise.resolve().then(() => __importStar(require("js-yaml")));
        let parsed;
        if (from === "json")
            parsed = JSON.parse(input);
        else if (from === "yaml")
            parsed = yaml.load(input);
        else if (from === "csv") {
            const { parse } = await Promise.resolve().then(() => __importStar(require("csv-parse/sync")));
            parsed = parse(input, { columns: true, skip_empty_lines: true });
        }
        else if (from === "xml") {
            const xml2js = await Promise.resolve().then(() => __importStar(require("xml2js")));
            parsed = await xml2js.parseStringPromise(input);
        }
        else {
            res.status(400).json({ ok: false, error: "invalid_request", message: `Unsupported from format: ${from}`, request_id: (0, credits_1.reqId)() });
            return;
        }
        let output;
        if (to === "json")
            output = JSON.stringify(parsed, null, 2);
        else if (to === "yaml")
            output = yaml.dump(parsed);
        else if (to === "csv") {
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            const { stringify } = await Promise.resolve().then(() => __importStar(require("csv-stringify/sync")));
            output = stringify(rows, { header: true });
        }
        else if (to === "xml") {
            const { create } = await Promise.resolve().then(() => __importStar(require("xmlbuilder2")));
            output = create({ root: parsed }).end({ prettyPrint: true });
        }
        else {
            res.status(400).json({ ok: false, error: "invalid_request", message: `Unsupported to format: ${to}`, request_id: (0, credits_1.reqId)() });
            return;
        }
        res.json({ ok: true, output, from, to, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(422).json({ ok: false, error: "conversion_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 5. TRANSFORM-TEXT ───────────────────────────────────────────────────────
router.post("/transform-text", ...toolMiddleware("transform-text"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "transform-text", 3);
        if (!ok)
            return;
    }
    const { text, mode } = req.body;
    if (!text || !mode) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text and mode are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const modes = ["uppercase", "lowercase", "titlecase", "slug", "camel", "snake", "kebab", "base64_encode", "base64_decode", "reverse", "trim", "word_count"];
    if (!modes.includes(mode)) {
        res.status(400).json({ ok: false, error: "invalid_request", message: `mode must be one of: ${modes.join(", ")}`, request_id: (0, credits_1.reqId)() });
        return;
    }
    let result;
    const words = text.trim().split(/\s+/);
    switch (mode) {
        case "uppercase":
            result = text.toUpperCase();
            break;
        case "lowercase":
            result = text.toLowerCase();
            break;
        case "titlecase":
            result = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
            break;
        case "slug":
            result = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            break;
        case "camel":
            result = words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
            break;
        case "snake":
            result = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
            break;
        case "kebab":
            result = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            break;
        case "base64_encode":
            result = Buffer.from(text, "utf8").toString("base64");
            break;
        case "base64_decode":
            result = Buffer.from(text, "base64").toString("utf8");
            break;
        case "reverse":
            result = text.split("").reverse().join("");
            break;
        case "trim":
            result = text.trim();
            break;
        case "word_count":
            result = words.filter(w => w.length > 0).length;
            break;
        default: result = text;
    }
    res.json({ ok: true, result, mode, input_length: text.length, request_id: (0, credits_1.reqId)() });
});
// ─── 6. EXTRACT-METADATA ─────────────────────────────────────────────────────
router.post("/extract-metadata", ...toolMiddleware("extract-metadata"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "extract-metadata", 3);
        if (!ok)
            return;
    }
    const { text, url } = req.body;
    if (!text && !url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text or url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const cheerio = await Promise.resolve().then(() => __importStar(require("cheerio")));
        let html = text ?? "";
        let fetchedUrl = url ?? "";
        if (url && !text) {
            const resp = await axios_1.default.get(url, { timeout: 10000, headers: { "User-Agent": "ArchTools/1.5 Metadata Extractor" } });
            html = resp.data;
        }
        const $ = cheerio.load(html);
        const og = {};
        $('meta[property^="og:"]').each((_, el) => { const k = $(el).attr("property") ?? ""; const v = $(el).attr("content") ?? ""; if (k && v)
            og[k.replace("og:", "")] = v; });
        const meta = {};
        $("meta[name]").each((_, el) => { const k = $(el).attr("name") ?? ""; const v = $(el).attr("content") ?? ""; if (k && v)
            meta[k] = v; });
        const bodyText = $("body").text().replace(/\s+/g, " ").trim();
        const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
        const links = [];
        $("a[href]").each((_, el) => { const h = $(el).attr("href"); if (h?.startsWith("http"))
            links.push(h); });
        res.json({ ok: true, url: fetchedUrl, title: $("title").text() || og["title"] || "", description: meta["description"] || og["description"] || "", og, meta, word_count: wordCount, link_count: links.length, links: links.slice(0, 20), request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "metadata_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 7. WEB-SCRAPE ───────────────────────────────────────────────────────────
router.post("/web-scrape", ...toolMiddleware("web-scrape"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "web-scrape", 5);
        if (!ok)
            return;
    }
    const { url, selector } = req.body;
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(url, { timeout: 15000, headers: { "User-Agent": "ArchTools/1.5 Web Scraper (https://archtools.dev)" } });
        const cheerio = await Promise.resolve().then(() => __importStar(require("cheerio")));
        const $ = cheerio.load(resp.data);
        $("script, style, noscript, nav, footer, header, iframe").remove();
        let content;
        if (selector) {
            content = $(selector).text().replace(/\s+/g, " ").trim();
        }
        else {
            content = $("body").text().replace(/\s+/g, " ").trim();
        }
        const links = [];
        $("a[href]").each((_, el) => { const h = $(el).attr("href"); if (h?.startsWith("http"))
            links.push({ text: $(el).text().trim().slice(0, 100), href: h }); });
        res.json({ ok: true, url, title: $("title").text(), text: content.slice(0, 8000), word_count: content.split(/\s+/).length, links: links.slice(0, 30), status_code: resp.status, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        const status = axios_1.default.isAxiosError(e) ? (e.response?.status ?? 502) : 500;
        res.status(status).json({ ok: false, error: "scrape_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 8. EXTRACT-PAGE ─────────────────────────────────────────────────────────
router.post("/extract-page", ...toolMiddleware("extract-page"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "extract-page", 5);
        if (!ok)
            return;
    }
    const { url } = req.body;
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(url, { timeout: 15000, headers: { "User-Agent": "ArchTools/1.5" } });
        const cheerio = await Promise.resolve().then(() => __importStar(require("cheerio")));
        const $ = cheerio.load(resp.data);
        $("script, style, noscript, nav, footer, header, aside").remove();
        const title = $("title").text();
        const description = $('meta[name="description"]').attr("content") ?? "";
        const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);
        const images = [];
        $("img[src]").each((_, el) => { const s = $(el).attr("src"); if (s?.startsWith("http"))
            images.push(s); });
        const links = [];
        $("a[href]").each((_, el) => { const h = $(el).attr("href"); if (h?.startsWith("http"))
            links.push(h); });
        res.json({ ok: true, url, title, description, text, images: images.slice(0, 20), links: links.slice(0, 30), word_count: text.split(/\s+/).length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "extract_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 9. SEARCH-WEB ───────────────────────────────────────────────────────────
router.post("/search-web", ...toolMiddleware("search-web"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "search-web", 5);
        if (!ok)
            return;
    }
    const { query, num_results = 5 } = req.body;
    if (!query) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    // DuckDuckGo Instant Answer API (no key required)
    try {
        const resp = await axios_1.default.get("https://api.duckduckgo.com/", {
            params: { q: query, format: "json", no_redirect: 1, no_html: 1, skip_disambig: 1 },
            timeout: 8000,
        });
        const data = resp.data;
        const results = [];
        if (data.AbstractText && data.AbstractURL) {
            results.push({ title: query, url: data.AbstractURL, snippet: data.AbstractText.slice(0, 300) });
        }
        (data.RelatedTopics ?? []).slice(0, num_results - results.length).forEach(t => {
            if (t.Text && t.FirstURL)
                results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 300) });
        });
        res.json({ ok: true, query, results: results.slice(0, num_results), count: results.length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "search_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 10. WEB-SEARCH (AI-synthesized) ─────────────────────────────────────────
router.post("/web-search", ...toolMiddleware("web-search"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "web-search", 10);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { query } = req.body;
    if (!query) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        // Get raw results first
        const raw = await axios_1.default.get("https://api.duckduckgo.com/", { params: { q: query, format: "json", no_html: 1 }, timeout: 6000 });
        const d = raw.data;
        const context = [d.AbstractText, ...(d.RelatedTopics ?? []).slice(0, 5).map(t => t.Text)].filter(Boolean).join("\n\n").slice(0, 3000);
        // Synthesize with Claude
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 600,
            messages: [{ role: "user", content: `Answer this query based on the following search context. Be concise and factual.\n\nQuery: ${query}\n\nContext:\n${context}\n\nAnswer:` }],
        });
        const answer = msg.content.find(b => b.type === "text")?.text ?? "";
        res.json({ ok: true, query, answer, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "search_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 11. RSS-PARSE ───────────────────────────────────────────────────────────
router.post("/rss-parse", ...toolMiddleware("rss-parse"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "rss-parse", 4);
        if (!ok)
            return;
    }
    const { url, limit = 20 } = req.body;
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(url, { timeout: 10000, headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
        const xml2js = await Promise.resolve().then(() => __importStar(require("xml2js")));
        const parsed = await xml2js.parseStringPromise(resp.data, { explicitArray: false, mergeAttrs: true });
        const channel = parsed?.rss?.channel ?? parsed?.feed;
        if (!channel) {
            res.status(422).json({ ok: false, error: "parse_error", message: "Could not parse RSS/Atom feed", request_id: (0, credits_1.reqId)() });
            return;
        }
        const items = (channel.item ?? channel.entry ?? []);
        const entries = (Array.isArray(items) ? items : [items]).slice(0, limit).map((item) => ({
            title: typeof item.title === "string" ? item.title : item.title?._ ?? "",
            link: item.link ?? item.id ?? "",
            description: typeof item.description === "string" ? item.description?.slice(0, 500) : "",
            pubDate: item.pubDate ?? item.published ?? item.updated ?? "",
        }));
        res.json({ ok: true, url, feed_title: typeof channel.title === "string" ? channel.title : "", items: entries, count: entries.length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "rss_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 12. IP-LOOKUP ───────────────────────────────────────────────────────────
router.post("/ip-lookup", ...toolMiddleware("ip-lookup"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "ip-lookup", 2);
        if (!ok)
            return;
    }
    const { ip } = req.body;
    if (!ip) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "ip is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,proxy,hosting,query`, { timeout: 6000 });
        const data = resp.data;
        if (data.status === "fail") {
            res.status(422).json({ ok: false, error: "lookup_error", message: String(data.message ?? "Invalid IP"), request_id: (0, credits_1.reqId)() });
            return;
        }
        res.json({ ok: true, ip: data.query, country: data.country, country_code: data.countryCode, region: data.regionName, city: data.city, zip: data.zip, lat: data.lat, lon: data.lon, timezone: data.timezone, isp: data.isp, org: data.org, is_proxy: data.proxy, is_hosting: data.hosting, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "lookup_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 13. WHOIS-LOOKUP ────────────────────────────────────────────────────────
router.post("/whois-lookup", ...toolMiddleware("whois-lookup"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "whois-lookup", 3);
        if (!ok)
            return;
    }
    const { domain } = req.body;
    if (!domain) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "domain is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    try {
        const resp = await axios_1.default.get(`https://rdap.org/domain/${clean}`, { timeout: 10000, headers: { "Accept": "application/json" } });
        const data = resp.data;
        const events = data.events ?? [];
        const nameservers = (data.nameservers ?? []).map(ns => ns.ldhName);
        const created = events.find(e => e.eventAction === "registration")?.eventDate ?? null;
        const expires = events.find(e => e.eventAction === "expiration")?.eventDate ?? null;
        const updated = events.find(e => e.eventAction === "last changed")?.eventDate ?? null;
        res.json({ ok: true, domain: clean, status: data.status, registered: created, expires, last_updated: updated, nameservers, registrar: data.entities?.[0]?.handle ?? null, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "whois_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 14. EMAIL-VERIFY ────────────────────────────────────────────────────────
router.post("/email-verify", ...toolMiddleware("email-verify"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "email-verify", 3);
        if (!ok)
            return;
    }
    const { email } = req.body;
    if (!email) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "email is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid_format = emailRe.test(email);
    const domain = email.split("@")[1] ?? "";
    const disposableDomains = ["mailinator.com", "guerrillamail.com", "temp-mail.org", "throwaway.email", "yopmail.com", "trashmail.com", "fakeinbox.com", "maildrop.cc", "sharklasers.com", "guerrillamailblock.com"];
    const is_disposable = disposableDomains.includes(domain.toLowerCase());
    let mx_valid = false;
    if (valid_format && !is_disposable) {
        try {
            const resp = await axios_1.default.get(`https://dns.google/resolve?name=${domain}&type=MX`, { timeout: 5000 });
            const data = resp.data;
            mx_valid = data.Status === 0 && (data.Answer?.length ?? 0) > 0;
        }
        catch {
            mx_valid = false;
        }
    }
    res.json({ ok: true, email, valid_format, is_disposable, mx_valid, deliverable: valid_format && !is_disposable && mx_valid, domain, request_id: (0, credits_1.reqId)() });
});
// ─── 15. PHONE-VALIDATE ──────────────────────────────────────────────────────
router.post("/phone-validate", ...toolMiddleware("phone-validate"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "phone-validate", 2);
        if (!ok)
            return;
    }
    const { phone, country = "US" } = req.body;
    if (!phone) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "phone is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const { parsePhoneNumberFromString } = await Promise.resolve().then(() => __importStar(require("libphonenumber-js")));
        const parsed = parsePhoneNumberFromString(phone, country);
        if (!parsed) {
            res.json({ ok: true, valid: false, phone, message: "Could not parse phone number", request_id: (0, credits_1.reqId)() });
            return;
        }
        res.json({ ok: true, valid: parsed.isValid(), phone, e164: parsed.format("E.164"), national: parsed.formatNational(), international: parsed.formatInternational(), country_code: parsed.country, country_calling_code: `+${parsed.countryCallingCode}`, type: parsed.getType() ?? "unknown", request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "phone_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 16. CURRENCY-CONVERT ────────────────────────────────────────────────────
router.post("/currency-convert", ...toolMiddleware("currency-convert"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "currency-convert", 2);
        if (!ok)
            return;
    }
    const { amount, from, to } = req.body;
    if (!amount || !from || !to) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "amount, from, and to are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`, { timeout: 8000 });
        const data = resp.data;
        if (data.result !== "success" || !data.rates) {
            res.status(502).json({ ok: false, error: "rate_error", message: "Could not fetch exchange rates", request_id: (0, credits_1.reqId)() });
            return;
        }
        const rate = data.rates[to.toUpperCase()];
        if (!rate) {
            res.status(422).json({ ok: false, error: "invalid_currency", message: `Currency ${to} not found`, request_id: (0, credits_1.reqId)() });
            return;
        }
        const converted = Math.round(amount * rate * 100) / 100;
        res.json({ ok: true, from: from.toUpperCase(), to: to.toUpperCase(), amount, rate, converted, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "convert_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 17. TIMEZONE-CONVERT ────────────────────────────────────────────────────
router.post("/timezone-convert", ...toolMiddleware("timezone-convert"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "timezone-convert", 1);
        if (!ok)
            return;
    }
    const { datetime, from_tz, to_tz } = req.body;
    if (!datetime || !from_tz || !to_tz) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "datetime, from_tz, and to_tz are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const fromDate = new Date(datetime);
        if (isNaN(fromDate.getTime())) {
            res.status(422).json({ ok: false, error: "invalid_datetime", message: "Could not parse datetime", request_id: (0, credits_1.reqId)() });
            return;
        }
        const toFormatted = new Intl.DateTimeFormat("en-US", { timeZone: to_tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(fromDate);
        res.json({ ok: true, input: datetime, from_tz, to_tz, result: toFormatted, iso: fromDate.toISOString(), request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(422).json({ ok: false, error: "tz_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 18. GENERATE-UUID ───────────────────────────────────────────────────────
router.post("/generate-uuid", ...toolMiddleware("generate-uuid"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "generate-uuid", 1);
        if (!ok)
            return;
    }
    const { version = "v4", count = 1, format = "uuid" } = req.body;
    const n = Math.min(Math.max(1, count), 100);
    const results = [];
    for (let i = 0; i < n; i++) {
        if (version === "v1")
            results.push((0, uuid_1.v1)());
        else if (format === "api_key")
            results.push(`arch_${(0, uuid_1.v4)().replace(/-/g, "")}`);
        else if (format === "token")
            results.push(crypto_1.default.randomBytes(32).toString("hex"));
        else
            results.push((0, uuid_1.v4)());
    }
    res.json({ ok: true, version, format, values: results, count: n, request_id: (0, credits_1.reqId)() });
});
// ─── 19. DIFF-TEXT ───────────────────────────────────────────────────────────
router.post("/diff-text", ...toolMiddleware("diff-text"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "diff-text", 2);
        if (!ok)
            return;
    }
    const { text1, text2, mode = "words" } = req.body;
    if (!text1 || !text2) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text1 and text2 are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const diff = await Promise.resolve().then(() => __importStar(require("diff")));
        let changes;
        if (mode === "chars")
            changes = diff.diffChars(text1, text2);
        else if (mode === "lines" || mode === "unified")
            changes = diff.diffLines(text1, text2);
        else
            changes = diff.diffWords(text1, text2);
        const added = changes.filter(c => c.added).reduce((s, c) => s + (c.count ?? 0), 0);
        const removed = changes.filter(c => c.removed).reduce((s, c) => s + (c.count ?? 0), 0);
        res.json({ ok: true, mode, changes, added, removed, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "diff_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 20. READABILITY-SCORE ───────────────────────────────────────────────────
router.post("/readability-score", ...toolMiddleware("readability-score"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "readability-score", 2);
        if (!ok)
            return;
    }
    const { text } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
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
    res.json({ ok: true, flesch_kincaid_ease: Math.round(fk_ease * 10) / 10, flesch_kincaid_grade: Math.round(fk_grade * 10) / 10, grade_label: gradeLabel, word_count: words.length, sentence_count: sentences, avg_words_per_sentence: Math.round(asl * 10) / 10, avg_syllables_per_word: Math.round(asw * 10) / 10, request_id: (0, credits_1.reqId)() });
});
// ─── 21. LANGUAGE-DETECT ─────────────────────────────────────────────────────
router.post("/language-detect", ...toolMiddleware("language-detect"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "language-detect", 3);
        if (!ok)
            return;
    }
    const { text } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        // Use Claude for accurate language detection
        if (anthropic) {
            const msg = await anthropic.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 100,
                messages: [{ role: "user", content: `Detect the language of this text. Reply ONLY with a JSON object: {"language": "English", "code": "en", "confidence": 0.99}\n\nText: ${text.slice(0, 500)}` }],
            });
            const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
            const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
            res.json({ ok: true, language: parsed.language ?? "Unknown", code: parsed.code ?? "und", confidence: parsed.confidence ?? 0, request_id: (0, credits_1.reqId)() });
        }
        else {
            // Fallback: franc library
            const { franc } = await Promise.resolve().then(() => __importStar(require("franc")));
            const code = franc(text);
            res.json({ ok: true, language: code, code, confidence: 0.7, request_id: (0, credits_1.reqId)() });
        }
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "detect_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 22. SENTIMENT-ANALYSIS ──────────────────────────────────────────────────
router.post("/sentiment-analysis", ...toolMiddleware("sentiment-analysis"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "sentiment-analysis", 8);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { text } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            messages: [{ role: "user", content: `Analyze the sentiment of this text. Return ONLY a JSON object:\n{"sentiment": "positive|negative|neutral|mixed", "score": 0.85, "emotions": {"joy": 0.8, "anger": 0.1, "sadness": 0.0, "fear": 0.0, "surprise": 0.1, "disgust": 0.0}}\n\nText: ${text.slice(0, 2000)}` }],
        });
        const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        res.json({ ok: true, sentiment: parsed.sentiment ?? "neutral", score: parsed.score ?? 0.5, emotions: parsed.emotions ?? {}, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "sentiment_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 23. SUMMARIZE ───────────────────────────────────────────────────────────
router.post("/summarize", ...toolMiddleware("summarize"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "summarize", 10);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { text, style = "paragraph" } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const stylePrompts = {
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
        res.json({ ok: true, summary, style, original_word_count: text.split(/\s+/).length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "summarize_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 24. EXTRACT-ENTITIES ────────────────────────────────────────────────────
router.post("/extract-entities", ...toolMiddleware("extract-entities"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "extract-entities", 8);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { text } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 800,
            messages: [{ role: "user", content: `Extract named entities from this text. Return ONLY JSON:\n{"people": [], "organizations": [], "locations": [], "dates": [], "money": [], "other": []}\n\nText: ${text.slice(0, 4000)}` }],
        });
        const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
        const entities = JSON.parse(raw.replace(/```json|```/g, "").trim());
        const total = Object.values(entities).reduce((s, a) => s + a.length, 0);
        res.json({ ok: true, entities, total_found: total, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "entity_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 25. REGEX-GENERATE ──────────────────────────────────────────────────────
router.post("/regex-generate", ...toolMiddleware("regex-generate"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "regex-generate", 8);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { description, examples } = req.body;
    if (!description) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "description is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 400,
            messages: [{ role: "user", content: `Generate a JavaScript regex for: "${description}"\n${examples?.length ? `Examples that should match: ${examples.join(", ")}` : ""}\n\nReturn ONLY JSON: {"pattern": "^[a-z]+$", "flags": "i", "explanation": "...", "test_examples": ["match1", "match2"]}` }],
        });
        const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        res.json({ ok: true, pattern: parsed.pattern ?? "", flags: parsed.flags ?? "", regex: `/${parsed.pattern ?? ""}/${parsed.flags ?? ""}`, explanation: parsed.explanation ?? "", test_examples: parsed.test_examples ?? [], request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "regex_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 26. PII-DETECT ──────────────────────────────────────────────────────────
router.post("/pii-detect", ...toolMiddleware("pii-detect"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "pii-detect", 10);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { text, redact = false } = req.body;
    if (!text) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "text is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const msg = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 800,
            messages: [{ role: "user", content: `Detect PII in this text${redact ? " and provide redacted version" : ""}. Return ONLY JSON:\n{"found": [{"type": "email|phone|ssn|credit_card|name|address|dob|ip", "value": "...", "start": 0, "end": 5}], "has_pii": true${redact ? ', "redacted": "text with [EMAIL] placeholders"' : ""}}\n\nText: ${text.slice(0, 4000)}` }],
        });
        const raw = msg.content.find(b => b.type === "text")?.text ?? "{}";
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        res.json({ ok: true, has_pii: parsed.has_pii ?? false, found: parsed.found ?? [], count: (parsed.found ?? []).length, ...(redact ? { redacted: parsed.redacted ?? text } : {}), request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "pii_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 27. AI-GENERATE ─────────────────────────────────────────────────────────
router.post("/ai-generate", ...toolMiddleware("ai-generate"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "ai-generate", 20);
        if (!ok)
            return;
    }
    const { prompt, system, model = "claude-sonnet-4-6", max_tokens = 1000 } = req.body;
    if (!prompt) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const MAX_PROMPT = parseInt(process.env.AI_MAX_PROMPT_CHARS ?? "32000", 10);
    if (prompt.length > MAX_PROMPT) {
        res.status(400).json({ ok: false, error: "prompt_too_long", message: `Prompt exceeds ${MAX_PROMPT} character limit`, request_id: (0, credits_1.reqId)() });
        return;
    }
    const CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];
    const GPT_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
    const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
    const GROK_MODELS = ["grok-3", "grok-3-fast", "grok-2"];
    const maxTok = Math.min(max_tokens, 4096);
    try {
        // ── OpenAI (GPT-4o, GPT-4-turbo, GPT-3.5) — check before Claude to avoid default fallthrough ──
        if (GPT_MODELS.includes(model)) {
            const openaiKey = process.env.OPENAI_API_KEY;
            if (!openaiKey) {
                res.status(503).json({ ok: false, error: "not_configured", message: "OPENAI_API_KEY not set", request_id: (0, credits_1.reqId)() });
                return;
            }
            const resp = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
                body: JSON.stringify({ model, max_tokens: maxTok, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
            });
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content ?? "";
            res.json({ ok: true, text, model, provider: "openai", usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 }, request_id: (0, credits_1.reqId)() });
            return;
        }
        // ── Google Gemini ──
        if (GEMINI_MODELS.includes(model)) {
            const googleKey = process.env.GOOGLE_API_KEY;
            if (!googleKey) {
                res.status(503).json({ ok: false, error: "not_configured", message: "GOOGLE_API_KEY not set", request_id: (0, credits_1.reqId)() });
                return;
            }
            const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { maxOutputTokens: maxTok } }),
            });
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            res.json({ ok: true, text, model, provider: "google", usage: { input_tokens: data.usageMetadata?.promptTokenCount ?? 0, output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0 }, request_id: (0, credits_1.reqId)() });
            return;
        }
        // ── xAI Grok ──
        if (GROK_MODELS.includes(model)) {
            const xaiKey = process.env.XAI_API_KEY;
            if (!xaiKey) {
                res.status(503).json({ ok: false, error: "not_configured", message: "XAI_API_KEY not set", request_id: (0, credits_1.reqId)() });
                return;
            }
            const resp = await fetch("https://api.x.ai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${xaiKey}` },
                body: JSON.stringify({ model, max_tokens: maxTok, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
            });
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content ?? "";
            res.json({ ok: true, text, model, provider: "xai", usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 }, request_id: (0, credits_1.reqId)() });
            return;
        }
        // ── Claude (default — known Claude models OR unknown model name falls here) ──
        if (CLAUDE_MODELS.includes(model) || true) { // true = default fallthrough to Claude
            if (!anthropic) {
                res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
                return;
            }
            const selectedModel = CLAUDE_MODELS.includes(model) ? model : "claude-sonnet-4-6";
            const msg = await anthropic.messages.create({ model: selectedModel, max_tokens: maxTok, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] });
            const text = msg.content.find(b => b.type === "text")?.text ?? "";
            res.json({ ok: true, text, model: selectedModel, provider: "anthropic", usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }, request_id: (0, credits_1.reqId)() });
            return;
        }
        // Should never reach here (Claude block above has || true fallthrough)
        res.status(400).json({ ok: false, error: "invalid_model", message: `Unknown model '${model}'.`, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "generation_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 28. OCR-EXTRACT ─────────────────────────────────────────────────────────
router.post("/ocr-extract", ...toolMiddleware("ocr-extract"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "ocr-extract", 10);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { image_url, image_base64, media_type = "image/jpeg" } = req.body;
    if (!image_url && !image_base64) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "image_url or image_base64 is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const imageContent = image_url
            ? { type: "image", source: { type: "url", url: image_url } }
            : { type: "image", source: { type: "base64", media_type: media_type, data: image_base64 } };
        const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2000,
            messages: [{ role: "user", content: [imageContent, { type: "text", text: "Extract all text from this image. Return the text exactly as it appears, preserving formatting and structure." }] }],
        });
        const text = msg.content.find(b => b.type === "text")?.text ?? "";
        res.json({ ok: true, text, word_count: text.split(/\s+/).length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "ocr_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 29. BROWSER-TASK ────────────────────────────────────────────────────────
router.post("/browser-task", ...toolMiddleware("browser-task"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "browser-task", 10);
        if (!ok)
            return;
    }
    const { url, action = "extract", selector, text: inputText } = req.body;
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    // Fallback: use axios + cheerio for extract (Playwright not available on Render free tier)
    try {
        const resp = await axios_1.default.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 ArchTools Browser Task" } });
        const cheerio = await Promise.resolve().then(() => __importStar(require("cheerio")));
        const $ = cheerio.load(resp.data);
        if (action === "extract" || action === "html") {
            const content = selector ? (action === "html" ? $(selector).html() : $(selector).text()) : $("body").text().replace(/\s+/g, " ").trim();
            res.json({ ok: true, url, action, result: (content ?? "").slice(0, 5000), request_id: (0, credits_1.reqId)() });
        }
        else {
            res.json({ ok: true, url, action, result: `Simulated ${action} on ${selector ?? "page"}${inputText ? ` with text: ${inputText}` : ""}`, note: "Full Playwright automation requires dedicated infrastructure", request_id: (0, credits_1.reqId)() });
        }
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "browser_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 30. EXTRACT-PDF ─────────────────────────────────────────────────────────
router.post("/extract-pdf", ...toolMiddleware("extract-pdf"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "extract-pdf", 6);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { pdf_url, pdf_base64 } = req.body;
    if (!pdf_url && !pdf_base64) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "pdf_url or pdf_base64 is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        let base64Data = pdf_base64;
        if (pdf_url && !pdf_base64) {
            const resp = await axios_1.default.get(pdf_url, { responseType: "arraybuffer", timeout: 15000 });
            base64Data = Buffer.from(resp.data).toString("base64");
        }
        const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } }, { type: "text", text: "Extract all text from this PDF. Preserve the structure and formatting as much as possible." }] }],
        });
        const text = msg.content.find(b => b.type === "text")?.text ?? "";
        res.json({ ok: true, text, word_count: text.split(/\s+/).length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "pdf_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 31. SCREENSHOT-CAPTURE ──────────────────────────────────────────────────
router.post("/screenshot-capture", ...toolMiddleware("screenshot-capture"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "screenshot-capture", 10);
        if (!ok)
            return;
    }
    const { url, full_page = true } = req.body;
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 ArchTools Screenshot" } });
        const cheerio = await Promise.resolve().then(() => __importStar(require("cheerio")));
        const $ = cheerio.load(resp.data);
        const title = $("title").text() || "";
        const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";
        const ogImage = $('meta[property="og:image"]').attr("content") || "";
        const h1 = $("h1").first().text() || "";
        const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 1000);
        // Use free screenshot service
        const screenshotUrl = `https://api.screenshotone.com/take?url=${encodeURIComponent(url)}&full_page=${full_page}&format=png&viewport_width=1280&viewport_height=800`;
        res.json({
            ok: true,
            url,
            screenshot_url: screenshotUrl,
            page_meta: { title, description, og_image: ogImage, h1 },
            page_text_preview: bodyText,
            note: "screenshot_url is a best-effort link; for production use consider a dedicated screenshot service with API key",
            request_id: (0, credits_1.reqId)(),
        });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "screenshot_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 32. HTML-TO-MARKDOWN ────────────────────────────────────────────────────
router.post("/html-to-markdown", ...toolMiddleware("html-to-markdown"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "html-to-markdown", 3);
        if (!ok)
            return;
    }
    const { html, url } = req.body;
    if (!html && !url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "html or url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        let rawHtml = html ?? "";
        if (url && !html) {
            const resp = await axios_1.default.get(url, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0 ArchTools" } });
            rawHtml = resp.data;
        }
        const cheerio = await Promise.resolve().then(() => __importStar(require("cheerio")));
        const $ = cheerio.load(rawHtml);
        // Remove nav, footer, script, style
        $("script, style, nav, footer, iframe, noscript").remove();
        const title = $("title").text().trim();
        // Convert headings, paragraphs, links, lists to markdown
        function toMd(el) {
            let md = "";
            el.children().each((_i, node) => {
                const tag = node.tagName?.toLowerCase() ?? "";
                const child = $(node);
                if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
                    const level = parseInt(tag[1], 10);
                    md += `${"#".repeat(level)} ${child.text().trim()}\n\n`;
                }
                else if (tag === "p") {
                    const text = child.text().trim();
                    if (text)
                        md += `${text}\n\n`;
                }
                else if (tag === "a") {
                    const href = child.attr("href") ?? "";
                    const text = child.text().trim();
                    md += href ? `[${text}](${href})` : text;
                }
                else if (tag === "ul" || tag === "ol") {
                    child.children("li").each((_j, li) => {
                        md += `${tag === "ul" ? "- " : "1. "}${$(li).text().trim()}\n`;
                    });
                    md += "\n";
                }
                else if (tag === "code") {
                    md += `\`${child.text()}\``;
                }
                else if (tag === "pre") {
                    md += `\`\`\`\n${child.text()}\n\`\`\`\n\n`;
                }
                else if (tag === "blockquote") {
                    md += `> ${child.text().trim()}\n\n`;
                }
                else if (tag === "strong" || tag === "b") {
                    md += `**${child.text()}**`;
                }
                else if (tag === "em" || tag === "i") {
                    md += `*${child.text()}*`;
                }
                else if (tag === "br") {
                    md += "\n";
                }
                else if (tag === "hr") {
                    md += "---\n\n";
                }
                else if (tag === "img") {
                    const src = child.attr("src") ?? "";
                    const alt = child.attr("alt") ?? "image";
                    if (src)
                        md += `![${alt}](${src})\n\n`;
                }
                else if (child.children().length > 0) {
                    md += toMd(child);
                }
                else {
                    const text = child.text().trim();
                    if (text)
                        md += `${text} `;
                }
            });
            return md;
        }
        const markdown = (title ? `# ${title}\n\n` : "") + toMd($("body")).replace(/\n{3,}/g, "\n\n").trim();
        res.json({ ok: true, markdown, word_count: markdown.split(/\s+/).length, char_count: markdown.length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "markdown_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 33. URL-SHORTEN ─────────────────────────────────────────────────────────
router.post("/url-shorten", ...toolMiddleware("url-shorten"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "url-shorten", 1);
        if (!ok)
            return;
    }
    const { url } = req.body;
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const resp = await axios_1.default.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, { timeout: 8000 });
        const short = resp.data;
        if (!short.startsWith("http"))
            throw new Error("TinyURL service unavailable");
        res.json({ ok: true, original_url: url, short_url: short, service: "tinyurl", request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "shorten_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 34. WEBHOOK-SEND ────────────────────────────────────────────────────────
router.post("/webhook-send", ...toolMiddleware("webhook-send"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "webhook-send", 2);
        if (!ok)
            return;
    }
    const { webhook_url, payload, headers: customHeaders = {}, method = "POST" } = req.body;
    if (!webhook_url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    if (!webhook_url.startsWith("http")) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "webhook_url must be a valid http/https URL", request_id: (0, credits_1.reqId)() });
        return;
    }
    const allowedMethods = ["POST", "PUT", "PATCH"];
    const httpMethod = allowedMethods.includes(method.toUpperCase()) ? method.toUpperCase() : "POST";
    try {
        const start = Date.now();
        const resp = await (0, axios_1.default)({
            method: httpMethod,
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
            request_id: (0, credits_1.reqId)(),
        });
    }
    catch (e) {
        res.status(502).json({ ok: false, error: "webhook_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 35. JSONPATH-QUERY ──────────────────────────────────────────────────────
router.post("/jsonpath-query", ...toolMiddleware("jsonpath-query"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "jsonpath-query", 1);
        if (!ok)
            return;
    }
    const { data, path: jsonPath } = req.body;
    if (!data || !jsonPath) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "data and path are required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        // Simple JSONPath evaluator: supports $, .key, ['key'], [index], [*], ..key
        function evalPath(obj, expr) {
            const tokens = expr
                .replace(/\['([^']+)'\]/g, ".$1")
                .replace(/\[(\d+)\]/g, ".$1")
                .replace(/\[\*\]/g, ".*")
                .split(".")
                .filter(Boolean);
            function descend(current, toks) {
                if (toks.length === 0)
                    return [current];
                const [head, ...rest] = toks;
                if (head === "$")
                    return descend(current, rest);
                if (head === "*") {
                    if (Array.isArray(current))
                        return current.flatMap(item => descend(item, rest));
                    if (typeof current === "object" && current !== null)
                        return Object.values(current).flatMap(v => descend(v, rest));
                    return [];
                }
                if (head === "..") {
                    // Recursive descent
                    const results = descend(current, rest);
                    if (Array.isArray(current))
                        current.forEach(item => results.push(...descend(item, toks)));
                    else if (typeof current === "object" && current !== null)
                        Object.values(current).forEach(v => results.push(...descend(v, toks)));
                    return results;
                }
                if (Array.isArray(current)) {
                    const idx = parseInt(head, 10);
                    if (!isNaN(idx))
                        return descend(current[idx], rest);
                    return [];
                }
                if (typeof current === "object" && current !== null) {
                    const val = current[head];
                    if (val === undefined)
                        return [];
                    return descend(val, rest);
                }
                return [];
            }
            return descend(obj, tokens);
        }
        const results = evalPath(data, jsonPath);
        res.json({ ok: true, path: jsonPath, results, count: results.length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(400).json({ ok: false, error: "jsonpath_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 36. IMAGE-GENERATE (SVG via Claude) ────────────────────────────────────
router.post("/image-generate", ...toolMiddleware("image-generate"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "image-generate", 15);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { prompt, style = "svg", width = 400, height = 300 } = req.body;
    if (!prompt) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "prompt is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2000,
            messages: [{
                    role: "user",
                    content: `Generate a complete, self-contained SVG image (${width}x${height}) based on this prompt: "${prompt}"\n\nRequirements:\n- Valid SVG with viewBox="0 0 ${width} ${height}"\n- Use only SVG elements (rect, circle, path, text, etc.)\n- Make it visually appealing and creative\n- Return ONLY the SVG code, nothing else, no markdown fences`,
                }],
        });
        const svg = msg.content.find(b => b.type === "text")?.text ?? "";
        const base64 = Buffer.from(svg).toString("base64");
        const dataUrl = `data:image/svg+xml;base64,${base64}`;
        res.json({ ok: true, prompt, style: "svg", width, height, data_url: dataUrl, svg, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "generation_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 37. BARCODE-GENERATE ────────────────────────────────────────────────────
router.post("/barcode-generate", ...toolMiddleware("barcode-generate"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "barcode-generate", 2);
        if (!ok)
            return;
    }
    const { data: barcodeData, type = "code128", width = 250, height = 100 } = req.body;
    if (!barcodeData) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "data is required", request_id: (0, credits_1.reqId)() });
        return;
    }
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
                if (on)
                    bars += `<rect x="${x}" y="10" width="${barWidth}" height="${height - 20}" fill="#000"/>`;
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
        res.json({ ok: true, data: barcodeData, type, width: svgWidth, height, svg, data_url: `data:image/svg+xml;base64,${base64}`, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "barcode_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── 38. WORKFLOW-AGENT (multi-step pipeline) ─────────────────────────────────
router.post("/workflow-agent", ...toolMiddleware("workflow-agent"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "workflow-agent", 25);
        if (!ok)
            return;
    }
    if (!anthropic) {
        res.status(503).json({ ok: false, error: "not_configured", message: "ANTHROPIC_API_KEY not set", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { goal, context, steps } = req.body;
    if (!goal) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "goal is required", request_id: (0, credits_1.reqId)() });
        return;
    }
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
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        res.json({ ok: true, goal, steps: parsed.steps ?? [], final_answer: parsed.final_answer ?? "", success: parsed.success ?? true, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "workflow_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── CRYPTO TOOLS (read-only, no API keys required) ──────────────────────────
// ─── crypto-price ────────────────────────────────────────────────────────────
router.post("/crypto-price", ...toolMiddleware("crypto-price"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "crypto-price", 1);
        if (!ok)
            return;
    }
    const { symbol, currency = "usd" } = req.body;
    if (!symbol) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required (e.g. bitcoin, ethereum)", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const id = symbol.toLowerCase().trim();
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
        const data = await r.json();
        if (!data[id]) {
            res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found. Use CoinGecko ID (e.g. bitcoin, ethereum, solana)`, request_id: (0, credits_1.reqId)() });
            return;
        }
        const d = data[id];
        res.json({ ok: true, symbol: id, currency, price: d[currency], change_24h: d[`${currency}_24h_change`], market_cap: d[`${currency}_market_cap`], volume_24h: d[`${currency}_24h_vol`], request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── crypto-ohlcv ────────────────────────────────────────────────────────────
router.post("/crypto-ohlcv", ...toolMiddleware("crypto-ohlcv"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "crypto-ohlcv", 2);
        if (!ok)
            return;
    }
    const { symbol, days = 7, currency = "usd" } = req.body;
    if (!symbol) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const id = symbol.toLowerCase().trim();
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=${currency}&days=${days}`);
        if (!r.ok) {
            res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found`, request_id: (0, credits_1.reqId)() });
            return;
        }
        const raw = await r.json();
        const candles = raw.map(([ts, o, h, l, c]) => ({ timestamp: ts, open: o, high: h, low: l, close: c }));
        res.json({ ok: true, symbol: id, currency, days, candles, count: candles.length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── crypto-market-cap ───────────────────────────────────────────────────────
router.post("/crypto-market-cap", ...toolMiddleware("crypto-market-cap"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "crypto-market-cap", 1);
        if (!ok)
            return;
    }
    const { limit = 10, currency = "usd" } = req.body;
    try {
        const n = Math.min(Math.max(1, limit), 100);
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${n}&page=1&sparkline=false`);
        const data = await r.json();
        const coins = data.map(c => ({ rank: c.market_cap_rank, id: c.id, symbol: c.symbol, name: c.name, price: c.current_price, market_cap: c.market_cap, volume_24h: c.total_volume, change_24h: c.price_change_percentage_24h }));
        res.json({ ok: true, currency, coins, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── crypto-fear-greed ───────────────────────────────────────────────────────
router.post("/crypto-fear-greed", ...toolMiddleware("crypto-fear-greed"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "crypto-fear-greed", 1);
        if (!ok)
            return;
    }
    const { limit = 7 } = req.body;
    try {
        const n = Math.min(Math.max(1, limit), 30);
        const r = await fetch(`https://api.alternative.me/fng/?limit=${n}`);
        const data = await r.json();
        const history = data.data.map(d => ({ value: Number(d.value), classification: d.value_classification, date: new Date(Number(d.timestamp) * 1000).toISOString().split("T")[0] }));
        const latest = history[0];
        res.json({ ok: true, current: latest, history, interpretation: Number(latest.value) < 25 ? "Extreme Fear — potential buy signal for contrarians" : Number(latest.value) > 75 ? "Extreme Greed — potential sell signal" : "Neutral zone", request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── crypto-sentiment ────────────────────────────────────────────────────────
router.post("/crypto-sentiment", ...toolMiddleware("crypto-sentiment"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "crypto-sentiment", 2);
        if (!ok)
            return;
    }
    const { symbol } = req.body;
    if (!symbol) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "symbol is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const id = symbol.toLowerCase().trim();
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false`);
        if (!r.ok) {
            res.status(404).json({ ok: false, error: "not_found", message: `Token '${id}' not found`, request_id: (0, credits_1.reqId)() });
            return;
        }
        const data = await r.json();
        res.json({
            ok: true, symbol: id,
            sentiment: { votes_up_pct: data.sentiment_votes_up_percentage ?? null, votes_down_pct: data.sentiment_votes_down_percentage ?? null, overall: (data.sentiment_votes_up_percentage ?? 50) > 60 ? "bullish" : (data.sentiment_votes_up_percentage ?? 50) < 40 ? "bearish" : "neutral" },
            community: { twitter_followers: data.community_data?.twitter_followers ?? null, reddit_subscribers: data.community_data?.reddit_subscribers ?? null, reddit_active: data.community_data?.reddit_active_accounts ?? null },
            price_momentum: { change_24h: data.market_data?.price_change_percentage_24h ?? null, change_7d: data.market_data?.price_change_percentage_7d ?? null },
            request_id: (0, credits_1.reqId)()
        });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── crypto-news ─────────────────────────────────────────────────────────────
router.post("/crypto-news", ...toolMiddleware("crypto-news"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "crypto-news", 2);
        if (!ok)
            return;
    }
    const { symbol, limit = 10 } = req.body;
    try {
        const n = Math.min(Math.max(1, limit), 20);
        const url = symbol ? `https://cryptopanic.com/api/free/v1/posts/?auth_token=free&currencies=${symbol.toUpperCase()}&limit=${n}&public=true` : `https://cryptopanic.com/api/free/v1/posts/?auth_token=free&limit=${n}&public=true`;
        const r = await fetch(url, { headers: { "User-Agent": "ArchTools/1.0" } });
        if (!r.ok) {
            // Fallback: CoinGecko news endpoint
            const r2 = await fetch(`https://api.coingecko.com/api/v3/news?per_page=${n}`);
            const d2 = await r2.json();
            const articles = (d2.data ?? []).map(a => ({ title: a.title, url: a.url, published_at: a.published_at, source: a.author?.name ?? "CoinGecko" }));
            res.json({ ok: true, symbol: symbol ?? "all", articles, count: articles.length, request_id: (0, credits_1.reqId)() });
            return;
        }
        const data = await r.json();
        const articles = (data.results ?? []).slice(0, n).map(a => ({ title: a.title, url: a.url, published_at: a.published_at, source: a.source?.title ?? "Unknown" }));
        res.json({ ok: true, symbol: symbol ?? "all", articles, count: articles.length, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// ─── token-lookup ─────────────────────────────────────────────────────────────
router.post("/token-lookup", ...toolMiddleware("token-lookup"), async (req, res) => {
    const paid = isX402Paid(req);
    if (!paid) {
        const ok = await (0, credits_1.deductCredits)(req, res, "token-lookup", 1);
        if (!ok)
            return;
    }
    const { query } = req.body;
    if (!query) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "query is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
        const data = await r.json();
        const coins = (data.coins ?? []).slice(0, 10).map(c => ({ id: c.id, name: c.name, symbol: c.symbol.toUpperCase(), market_cap_rank: c.market_cap_rank ?? null }));
        res.json({ ok: true, query, results: coins, count: coins.length, tip: "Use the 'id' field with other crypto tools (e.g. crypto-price)", request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "fetch_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
exports.default = router;
//# sourceMappingURL=index.js.map