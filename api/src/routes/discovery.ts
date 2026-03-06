import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { X402_PRICES } from "../middleware/x402";

const router = Router();

const BASE_URL = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";
const API_BASE = "https://arch-ai-tools.onrender.com";
const NETWORK = process.env.X402_NETWORK ?? "base";

// GET /health
router.get("/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [toolCount, agentCount] = await Promise.all([
      prisma.tool.count(),
      prisma.agent.count(),
    ]);
    res.json({ ok: true, service: "arch-tools-api", version: "1.5.0", db: "connected", tools: toolCount || 30, agents: agentCount });
  } catch {
    res.status(503).json({ ok: false, service: "arch-tools-api", db: "error" });
  }
});

// GET /.well-known/x402 — x402 discovery (no duplicates)
router.get("/.well-known/x402", (_req: Request, res: Response): void => {
  const endpoints = Object.entries(X402_PRICES).map(([tool, price]) => ({
    path: `/v1/tools/${tool}`,
    method: "POST",
    price: `$${price}`,
    description: TOOL_DESCRIPTIONS[tool] ?? tool,
  }));

  res.json({
    name: "Arch Tools",
    description: "30 production-ready API tools for developers and AI agents",
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
router.get("/v1/tools", async (_req: Request, res: Response): Promise<void> => {
  try {
    const tools = await prisma.tool.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
    res.json({ ok: true, tools });
  } catch {
    res.json({ ok: true, tools: FALLBACK_TOOLS });
  }
});

// GET /llms.txt — llms.txt for AI discovery
router.get("/llms.txt", (_req: Request, res: Response): void => {
  res.type("text/plain").send(LLMS_TXT);
});

// GET /openapi.json
router.get("/openapi.json", (_req: Request, res: Response): void => {
  res.json(OPENAPI_STUB);
});

// ─── Tool descriptions for x402 discovery ────────────────────────────────────

const TOOL_DESCRIPTIONS: Record<string, string> = {
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
  "extract-pdf": "Extract text from a PDF (URL or base64)",
};

const LLMS_TXT = `# Arch Tools
> 30 production-ready API tools for developers and AI agents.
> Base URL: ${API_BASE}
> Docs: ${BASE_URL}
> OpenAPI: ${API_BASE}/openapi.json
> MCP: https://arch-tools-mcp.onrender.com/mcp

## Authentication
All tool endpoints require an API key via header:
  Authorization: Bearer YOUR_API_KEY

Get a key at ${BASE_URL}/signin

## Credit System
Tools cost credits per call. Credits never expire.

  Starter Pack:   1,000 credits — $9
  Pro Pack:      10,000 credits — $49
  Business Pack: 100,000 credits — $199

## All Tools (30 total)

### Data
POST /v1/tools/validate-data        (1 credit)  — Validate JSON against a JSON Schema
POST /v1/tools/convert-format       (2 credits) — Convert between JSON, YAML, CSV, XML
POST /v1/tools/extract-metadata     (3 credits) — Extract OG tags, word count, links from text or URLs

### Security
POST /v1/tools/generate-hash        (1 credit)  — sha256, sha512, md5, sha1
POST /v1/tools/pii-detect           (10 credits) — Detect and optionally redact PII

### Text
POST /v1/tools/transform-text       (3 credits) — uppercase, slug, camel, snake, base64, and more
POST /v1/tools/readability-score    (2 credits) — Flesch-Kincaid grade and reading ease
POST /v1/tools/diff-text            (2 credits) — Structured diff: unified, words, chars, or JSON

### AI (Claude-powered)
POST /v1/tools/ai-generate          (20 credits) — Text generation via Claude Sonnet
POST /v1/tools/ocr-extract          (10 credits) — Extract text from images (URL or base64)
POST /v1/tools/sentiment-analysis   (8 credits)  — Sentiment + 6 emotions (joy, anger, sadness…)
POST /v1/tools/summarize            (10 credits) — paragraph, bullets, tldr, headline, executive styles
POST /v1/tools/extract-entities     (8 credits)  — NER: people, orgs, locations, dates, money
POST /v1/tools/language-detect      (3 credits)  — 100+ languages with confidence score
POST /v1/tools/regex-generate       (8 credits)  — Natural language → validated regex with tests

### Web
POST /v1/tools/web-scrape           (5 credits)  — Scrape any public URL with optional CSS selector
POST /v1/tools/search-web           (5 credits)  — Search results (DuckDuckGo)
POST /v1/tools/web-search           (10 credits) — Real-time search with AI-synthesized answer
POST /v1/tools/extract-page         (5 credits)  — Clean text, links, and metadata from any webpage
POST /v1/tools/extract-pdf          (6 credits)  — Extract text from a PDF
POST /v1/tools/browser-task         (10 credits) — Headless browser automation (click/type/extract)
POST /v1/tools/rss-parse            (4 credits)  — Parse RSS or Atom feeds into structured JSON

### Network
POST /v1/tools/ip-lookup            (2 credits)  — Geo, ISP, VPN/proxy detection
POST /v1/tools/whois-lookup         (3 credits)  — Domain registration and expiry via RDAP

### Validation
POST /v1/tools/email-verify         (3 credits)  — MX check + disposable domain detection
POST /v1/tools/phone-validate       (2 credits)  — E.164 format, type, country code

### Finance
POST /v1/tools/currency-convert     (2 credits)  — 170+ currencies with live rates

### Utilities
POST /v1/tools/timezone-convert     (1 credit)   — Any IANA timezone pair
POST /v1/tools/generate-uuid        (1 credit)   — v1/v4, random tokens, API-key format

### Media
POST /v1/tools/qr-code              (2 credits)  — PNG data URL or SVG output

## Workflows
POST /v1/workflows/run — Execute multiple tools in sequence (up to 8 steps)

## Discovery Endpoints
GET  /v1/tools       — Full tool list with schemas
GET  /openapi.json   — OpenAPI 3.0 spec
GET  /health         — Service health + tool count
GET  /v1/agent/usage — Credit balance

## MCP Integration
SSE endpoint: https://arch-tools-mcp.onrender.com/mcp
All 30 tools available. Compatible with Claude Desktop, Cursor, Windsurf.

## x402 / USDC Autonomous Payment
AI agents can self-fund via x402 protocol using USDC on Base.
Discovery: ${API_BASE}/.well-known/x402

## SDKs
Python: pip install archtools
Node:   npm install @archtools/sdk

## Legal
Terms:   ${API_BASE}/legal/terms
Privacy: ${API_BASE}/legal/privacy
`;

const OPENAPI_STUB = {
  openapi: "3.0.3",
  info: { title: "Arch Tools API", version: "1.5.0", description: "30 production-ready API tools for developers and AI agents.", contact: { name: "Arch Tools", url: BASE_URL } },
  servers: [{ url: API_BASE }],
  tags: [{ name: "Tools" }, { name: "Agents" }, { name: "Billing" }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API Key" } } },
};

const FALLBACK_TOOLS = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
  name,
  description,
  credits: Object.entries({ "ai-generate": 20, "ocr-extract": 10, "sentiment-analysis": 8, "summarize": 10, "extract-entities": 8, "regex-generate": 8, "pii-detect": 10, "web-search": 10, "web-scrape": 5, "search-web": 5, "extract-page": 5, "browser-task": 10, "extract-pdf": 6, "rss-parse": 4, "currency-convert": 2, "email-verify": 3, "phone-validate": 2, "ip-lookup": 2, "whois-lookup": 3, "language-detect": 3, "transform-text": 3, "extract-metadata": 3, "diff-text": 2, "readability-score": 2, "convert-format": 2, "qr-code": 2, "generate-uuid": 1, "timezone-convert": 1, "validate-data": 1, "generate-hash": 1 }).find(([k]) => k === name)?.[1] ?? 5,
  category: ["ai-generate","ocr-extract","sentiment-analysis","summarize","extract-entities","regex-generate","pii-detect","web-search","language-detect"].includes(name) ? "ai" : ["web-scrape","search-web","extract-page","browser-task","rss-parse"].includes(name) ? "web" : "utility",
  enabled: true,
}));

export default router;
