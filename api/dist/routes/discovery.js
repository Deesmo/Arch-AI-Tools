"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const x402_1 = require("../middleware/x402");
const router = (0, express_1.Router)();
const BASE_URL = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";
const API_BASE = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";
const NETWORK = process.env.X402_NETWORK ?? "base";
// GET /health
router.get("/health", async (_req, res) => {
    try {
        const [toolCount, agentCount] = await Promise.all([
            prisma_1.prisma.tool.count(),
            prisma_1.prisma.agent.count(),
        ]);
        res.json({ ok: true, service: "arch-tools-api", version: "1.7.0", db: "connected", tools: toolCount || 50, agents: agentCount });
    }
    catch {
        res.json({ ok: true, service: "arch-tools-api", version: "1.7.0", db: "error" });
    }
});
// GET /.well-known/x402 — x402 discovery (no duplicates)
router.get("/.well-known/x402", (_req, res) => {
    const endpoints = Object.entries(x402_1.X402_PRICES).map(([tool, price]) => ({
        path: `/v1/tools/${tool}`,
        method: "POST",
        price: `$${price}`,
        description: TOOL_DESCRIPTIONS[tool] ?? tool,
    }));
    res.json({
        name: "Arch Tools",
        description: "The first API platform built for autonomous agent payments. 50 production tools, USDC on Base via x402 or Stripe.",
        url: BASE_URL,
        api_base: API_BASE,
        version: "1",
        endpoints,
        payment: {
            stripe: { url: `${BASE_URL}/pricing` },
            x402: { status: "active", networks: [NETWORK], token: "USDC" },
        },
        mcp: {
            server: "arch-tools-mcp",
            transport: ["stdio", "sse"],
            discovery: "/v1/tools",
        },
        llms_txt: `${API_BASE}/llms.txt`,
        contact: BASE_URL,
    });
});
// GET /v1/tools — full tool list with schemas
router.get("/v1/tools", async (_req, res) => {
    try {
        const tools = await prisma_1.prisma.tool.findMany({ where: { active: true }, orderBy: { name: "asc" } });
        res.json({ ok: true, tools });
    }
    catch {
        res.json({ ok: true, tools: FALLBACK_TOOLS });
    }
});
// GET /llms.txt — llms.txt for AI discovery
router.get("/llms.txt", (_req, res) => {
    res.type("text/plain").send(LLMS_TXT);
});
// GET /openapi.json
router.get("/openapi.json", (_req, res) => {
    res.json(OPENAPI_STUB);
});
// ─── Tool descriptions for x402 discovery ────────────────────────────────────
const TOOL_DESCRIPTIONS = {
    "validate-data": "Validate JSON against a JSON Schema",
    "generate-hash": "Generate cryptographic hashes (sha256/sha512/md5)",
    "qr-code": "Generate QR codes (PNG or SVG)",
    "convert-format": "Convert between JSON, YAML, CSV, XML",
    "transform-text": "Transform text (10 modes: slug, camel, base64…)",
    "extract-metadata": "Extract OG tags, word count, links from text or URLs",
    "web-scrape": "Scrape any public URL with optional CSS selector",
    "extract-page": "Clean text, links, and metadata from any webpage",
    "search-web": "Web search with structured results (DuckDuckGo)",
    "web-search": "Real-time web search with AI-synthesized answer",
    "rss-parse": "Parse RSS/Atom feeds into structured JSON",
    "ip-lookup": "Geo, ISP, VPN/proxy detection",
    "whois-lookup": "Domain registration, expiry, nameservers via RDAP",
    "email-verify": "MX check + disposable domain detection",
    "phone-validate": "E.164 format, type, country code",
    "currency-convert": "170+ currencies with live rates",
    "timezone-convert": "Convert datetime between any two IANA timezones",
    "generate-uuid": "Generate UUIDs, tokens, and API-key-format strings",
    "diff-text": "Structured diff in unified, words, chars, or JSON format",
    "readability-score": "Flesch-Kincaid readability and grade level",
    "language-detect": "Detect language with confidence score (100+ languages)",
    "sentiment-analysis": "Sentiment + emotion detection (joy, anger, fear…)",
    "summarize": "Summarize in 5 styles (bullets, tldr, executive…)",
    "extract-entities": "NER: people, orgs, locations, dates, money",
    "regex-generate": "Generate regex from plain English with explanations",
    "pii-detect": "Detect and optionally redact PII",
    "ai-generate": "AI text generation via Claude",
    "ocr-extract": "Extract text from images (URL or base64)",
    "browser-task": "Headless browser automation (click/type/extract) via Playwright",
    "text-to-speech": "Convert text to natural-sounding audio via ElevenLabs (returns base64 MP3)",
    "transcribe-audio": "Transcribe audio files to text via OpenAI Whisper (URL input, 100+ languages)",
    "email-send": "Send transactional emails via Resend — plain text or HTML",
    "design-create": "Generate images from text prompts via DALL-E 3 (1024x1024, 1792x1024, 1024x1792)",
    "domain-check": "Check if a domain is available or registered via RDAP (no key needed)",
    "extract-pdf": "Extract text from a PDF (URL or base64)",
};
const LLMS_TXT = `# Arch Tools
> The first API platform built for autonomous agent payments.
> 50 production-ready tools. One key. USDC on Base via x402 or Stripe.
> Base URL: ${API_BASE}
> Docs: ${BASE_URL}
> OpenAPI: ${API_BASE}/openapi.json
> MCP SSE: https://arch-tools-mcp.onrender.com/sse

## Authentication
All tool endpoints require an API key:
  Authorization: Bearer YOUR_API_KEY

Get a free key (100 credits) at ${BASE_URL}/#register

## x402 Autonomous Payment (no key required)
AI agents can pay per-call with USDC on Base via the x402 protocol.
No API key, no signup, no human credit card needed.
Discovery: ${API_BASE}/.well-known/x402
Protocol: https://x402.org

## Credit System
Tools cost credits per call. Credits never expire. Non-transferable.

  Starter Pack:    10,000 credits — $9    ($0.0009/credit)
  Pro Pack:        60,000 credits — $49   ($0.00082/credit)
  Business Pack:  250,000 credits — $199  ($0.00080/credit)

## All Tools (50 total)

### AI (Claude-powered)
POST /v1/tools/ai-generate          (20 credits) — Text generation via Claude Sonnet
POST /v1/tools/ocr-extract          (10 credits) — Extract text from images (URL or base64)
POST /v1/tools/sentiment-analysis   (8 credits)  — Sentiment + 6 emotions (joy, anger, sadness…)
POST /v1/tools/summarize            (10 credits) — paragraph, bullets, tldr, headline, executive styles
POST /v1/tools/extract-entities     (8 credits)  — NER: people, orgs, locations, dates, money
POST /v1/tools/language-detect      (3 credits)  — 100+ languages with confidence score
POST /v1/tools/regex-generate       (8 credits)  — Natural language → validated regex with tests
POST /v1/tools/pii-detect           (10 credits) — Detect and optionally redact PII
POST /v1/tools/image-generate       (15 credits) — Generate SVG images from text prompts
POST /v1/tools/workflow-agent       (25 credits) — Multi-step autonomous AI agent pipeline

### Web
POST /v1/tools/web-scrape           (5 credits)  — Scrape any public URL with optional CSS selector
POST /v1/tools/search-web           (5 credits)  — Search results (DuckDuckGo)
POST /v1/tools/web-search           (10 credits) — Real-time search with AI-synthesized answer
POST /v1/tools/extract-page         (5 credits)  — Clean text, links, and metadata from any webpage
POST /v1/tools/extract-pdf          (6 credits)  — Extract text from a PDF (URL or base64)
POST /v1/tools/browser-task         (10 credits) — Headless browser automation via Playwright
POST /v1/tools/rss-parse            (4 credits)  — Parse RSS or Atom feeds into structured JSON
POST /v1/tools/screenshot-capture   (10 credits) — Screenshot any URL
POST /v1/tools/html-to-markdown     (2 credits)  — Convert HTML to clean Markdown
POST /v1/tools/url-shorten          (1 credit)   — Shorten any URL
POST /v1/tools/webhook-send         (2 credits)  — Send HTTP webhooks with payload

### Crypto (read-only, no key required — uses CoinGecko + Alternative.me)
POST /v1/tools/crypto-price         (1 credit)   — Real-time price, 24h change, market cap, volume
POST /v1/tools/crypto-market-cap    (1 credit)   — Top N coins by market cap
POST /v1/tools/crypto-fear-greed    (1 credit)   — Fear & Greed Index with historical data
POST /v1/tools/token-lookup         (1 credit)   — Search any token by name or ticker
POST /v1/tools/crypto-ohlcv         (2 credits)  — OHLCV candlestick data for technical analysis
POST /v1/tools/crypto-sentiment     (2 credits)  — Community sentiment + social stats
POST /v1/tools/crypto-news          (2 credits)  — Latest news headlines, filterable by symbol

### Data & Validation
POST /v1/tools/validate-data        (1 credit)   — Validate JSON against a JSON Schema
POST /v1/tools/convert-format       (2 credits)  — Convert between JSON, YAML, CSV, XML
POST /v1/tools/extract-metadata     (3 credits)  — Extract OG tags, word count, links
POST /v1/tools/jsonpath-query       (1 credit)   — JSONPath queries on any JSON payload
POST /v1/tools/barcode-generate     (2 credits)  — Generate Code128 barcodes as SVG
POST /v1/tools/qr-code              (2 credits)  — PNG data URL or SVG output

### Text
POST /v1/tools/transform-text       (3 credits)  — uppercase, slug, camel, snake, base64, and more
POST /v1/tools/readability-score    (2 credits)  — Flesch-Kincaid grade and reading ease
POST /v1/tools/diff-text            (2 credits)  — Structured diff: unified, words, chars, or JSON

### Network
POST /v1/tools/ip-lookup            (2 credits)  — Geo, ISP, VPN/proxy detection
POST /v1/tools/whois-lookup         (3 credits)  — Domain registration and expiry via RDAP

### Validation
POST /v1/tools/email-verify         (3 credits)  — MX check + disposable domain detection
POST /v1/tools/phone-validate       (2 credits)  — E.164 format, type, country code

### Security
POST /v1/tools/generate-hash        (1 credit)   — sha256, sha512, md5, sha1

### Finance
POST /v1/tools/currency-convert     (2 credits)  — 170+ currencies with live rates

### Utilities
POST /v1/tools/timezone-convert     (1 credit)   — Any IANA timezone pair
POST /v1/tools/generate-uuid        (1 credit)   — v1/v4, random tokens, API-key format

## Workflows
POST /v1/workflows/run — Execute multiple tools in sequence (up to 8 steps)

## Discovery Endpoints
GET  /v1/tools        — Full tool list with schemas
GET  /openapi.json    — OpenAPI 3.0 spec
GET  /health          — Service health + tool count
GET  /v1/agent/usage  — Credit balance for your key

## MCP Integration
SSE endpoint: https://arch-tools-mcp.onrender.com/sse
Registry: io.github.Deesmo/arch-tools-mcp
Compatible with: Claude Desktop, Cursor, Windsurf, any MCP client

## Legal
Credits are non-transferable, non-refundable, tied to one API key.
Terms:   ${BASE_URL}/terms.html
Privacy: ${BASE_URL}/privacy.html
`;
const OPENAPI_STUB = {
    openapi: "3.0.3",
    info: { title: "Arch Tools API", version: "1.7.0", description: "50 production-ready API tools for developers and AI agents. Dual payment rails: Stripe + x402 USDC on Base.", contact: { name: "Arch Tools", url: BASE_URL } },
    servers: [{ url: API_BASE }],
    tags: [{ name: "Tools" }, { name: "Agents" }, { name: "Billing" }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API Key" } } },
};
const FALLBACK_TOOLS = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
    name,
    description,
    credits: Object.entries({ "ai-generate": 20, "ocr-extract": 10, "sentiment-analysis": 8, "summarize": 10, "extract-entities": 8, "regex-generate": 8, "pii-detect": 10, "web-search": 10, "web-scrape": 5, "search-web": 5, "extract-page": 5, "browser-task": 10, "extract-pdf": 6, "rss-parse": 4, "currency-convert": 2, "email-verify": 3, "phone-validate": 2, "ip-lookup": 2, "whois-lookup": 3, "language-detect": 3, "transform-text": 3, "extract-metadata": 3, "diff-text": 2, "readability-score": 2, "convert-format": 2, "qr-code": 2, "generate-uuid": 1, "timezone-convert": 1, "validate-data": 1, "generate-hash": 1, "text-to-speech": 5, "transcribe-audio": 8, "email-send": 3, "design-create": 15, "domain-check": 2 }).find(([k]) => k === name)?.[1] ?? 5,
    category: ["ai-generate", "ocr-extract", "sentiment-analysis", "summarize", "extract-entities", "regex-generate", "pii-detect", "web-search", "language-detect"].includes(name) ? "ai" : ["web-scrape", "search-web", "extract-page", "browser-task", "rss-parse"].includes(name) ? "web" : "utility",
    active: true,
    endpoint: `/v1/tools/${name}`,
    method: "POST",
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
}));
exports.default = router;
//# sourceMappingURL=discovery.js.map