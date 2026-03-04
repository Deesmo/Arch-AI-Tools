import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { LANDING_HTML } from "./assets/landingHtml.js";
import { DASHBOARD_HTML } from "./assets/dashboardHtml.js";
import * as Sentry from "@sentry/node";

const landingHtml = LANDING_HTML;
const dashboardHtml = DASHBOARD_HTML;
import { logger } from "./lib/logger.js";
import { requestIdMiddleware, notFoundHandler, errorHandler } from "./lib/http.js";
import { requestLog } from "./middleware/requestLog.js";
import { metricsMiddleware } from "./lib/metrics.js";
import { legalRouter } from "./routes/legal.js";
import { openApiRouter } from "./routes/openapi.js";
import { docsRouter } from "./routes/docs.js";
import { postmanRouter } from "./routes/postman.js";
import { statusRouter } from "./routes/status.js";
import { limitsRouter } from "./routes/limits.js";
import { toolsRouter } from "./routes/tools.js";
import { agentRouter } from "./routes/agent.js";
import { publishRouter } from "./routes/publish.js";
import { invokeRouter } from "./routes/toolInvoke.js";
import { stripeRouter } from "./routes/stripe.js";
import { authRouter } from "./routes/auth.js";
import { workflowsRouter } from "./routes/workflows.js";
import { prisma } from "./db.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { adminRouter } from "./routes/admin.js";

// ─── Sentry Error Tracking ───
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.2, // 20% of transactions for performance monitoring
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
  });
  logger.info("Sentry initialized");
}



function publicApiBase() {
  // Prefer explicit public base; fall back to Render's external URL if present.
  return (
    process.env.PUBLIC_API_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "https://archtools.dev"
  );
}

const app = express();

// Render/Proxy hardening — ensures req.ip and rate limiting work correctly behind Render.
// See: https://expressjs.com/en/guide/behind-proxies.html
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(requestIdMiddleware);
app.use(requestLog);
app.use(metricsMiddleware);
app.use(
  cors({
    origin: (() => {
      // If explicitly configured, respect it.
      if (process.env.CORS_ORIGIN) {
        return process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
      }

      // Safe defaults:
      // - In production: only allow Arch Tools web origins (same brand).
      // - In dev/test: allow all for local iteration.
      if (process.env.NODE_ENV === "production") {
        return ["https://archtools.dev", "https://www.archtools.dev"];
      }
      return true;
    })(),
    credentials: true,
  })
);


// Capture raw body for Stripe webhook signature verification
app.use(
  express.json({
    limit: "2mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })

// URL-encoded bodies (rare, but safe)
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

// ─── Discovery & Meta Endpoints ───

// x402 discovery — all 30 tools
app.get("/.well-known/x402", (_req, res) => {
  const apiBase = publicApiBase();
  res.json({
    name: "Arch Tools",
    description: "30 production-ready API tools for developers and AI agents",
    url: "https://archtools.dev",
    api_base: apiBase,
    version: "1",
    endpoints: [
      // Core
      { path: "/v1/tools/validate-data",     method: "POST", price: "$0.001", description: "Validate JSON against a JSON Schema" },
      { path: "/v1/tools/generate-hash",     method: "POST", price: "$0.001", description: "Generate cryptographic hashes (sha256/sha512/md5)" },
      { path: "/v1/tools/qr-code",           method: "POST", price: "$0.002", description: "Generate QR codes (PNG or SVG)" },
      { path: "/v1/tools/convert-format",    method: "POST", price: "$0.002", description: "Convert between JSON, YAML, CSV, XML" },
      { path: "/v1/tools/transform-text",    method: "POST", price: "$0.003", description: "Transform text (10 modes: slug, camel, base64…)" },
      { path: "/v1/tools/extract-metadata",  method: "POST", price: "$0.003", description: "Extract OG tags, word count, links from text or URLs" },
      { path: "/v1/tools/web-scrape",        method: "POST", price: "$0.005", description: "Scrape any public URL with optional CSS selector" },
      { path: "/v1/tools/ai-generate",       method: "POST", price: "$0.020", description: "AI text generation via Claude" },
      // Web/Browser
      { path: "/v1/tools/search-web",        method: "POST", price: "$0.005", description: "Web search with structured results (Tavily/DuckDuckGo)" },
      { path: "/v1/tools/extract-page",      method: "POST", price: "$0.005", description: "Extract clean text, links, and metadata from a webpage" },
      { path: "/v1/tools/extract-pdf",       method: "POST", price: "$0.006", description: "Extract text and tables from a PDF" },
      { path: "/v1/tools/browser-task",      method: "POST", price: "$0.010", description: "Headless browser automation via Playwright" },
      // Tier 1: High-demand
      { path: "/v1/tools/ocr-extract",       method: "POST", price: "$0.010", description: "Extract text from images via AI vision" },
      { path: "/v1/tools/ip-lookup",         method: "POST", price: "$0.002", description: "Geolocate any IP — country, city, ISP, VPN detection" },
      { path: "/v1/tools/email-verify",      method: "POST", price: "$0.003", description: "Email validation: MX check + disposable domain detection" },
      { path: "/v1/tools/phone-validate",    method: "POST", price: "$0.002", description: "Parse phone numbers to E.164 with country and type" },
      { path: "/v1/tools/currency-convert",  method: "POST", price: "$0.002", description: "Convert between 170+ currencies with live rates" },
      { path: "/v1/tools/timezone-convert",  method: "POST", price: "$0.001", description: "Convert datetime between any two IANA timezones" },
      { path: "/v1/tools/web-search",        method: "POST", price: "$0.010", description: "Real-time web search with AI-synthesized answer" },
      // Tier 2: AI-powered
      { path: "/v1/tools/sentiment-analysis",method: "POST", price: "$0.008", description: "Sentiment + emotion detection (joy, anger, fear…)" },
      { path: "/v1/tools/summarize",         method: "POST", price: "$0.010", description: "Summarize in 5 styles (bullets, tldr, executive…)" },
      { path: "/v1/tools/extract-entities",  method: "POST", price: "$0.008", description: "NER: people, orgs, locations, dates, money" },
      { path: "/v1/tools/language-detect",   method: "POST", price: "$0.003", description: "Detect language with confidence score (100+ languages)" },
      { path: "/v1/tools/pii-detect",        method: "POST", price: "$0.010", description: "Detect and optionally redact PII" },
      { path: "/v1/tools/readability-score", method: "POST", price: "$0.002", description: "Flesch-Kincaid readability and grade level" },
      { path: "/v1/tools/rss-parse",         method: "POST", price: "$0.004", description: "Parse RSS/Atom feeds into structured JSON" },
      // Tier 3: Differentiators
      { path: "/v1/tools/generate-uuid",     method: "POST", price: "$0.001", description: "Generate UUIDs, tokens, and API-key-format strings" },
      { path: "/v1/tools/regex-generate",    method: "POST", price: "$0.008", description: "Generate regex from plain English with explanations" },
      { path: "/v1/tools/diff-text",         method: "POST", price: "$0.002", description: "Structured diff in unified, words, chars, or JSON format" },
      { path: "/v1/tools/whois-lookup",      method: "POST", price: "$0.003", description: "Domain registration, expiry, nameservers via RDAP" },
    ],
    payment: {
      stripe: { url: "https://archtools.dev/pricing" },
      x402: { status: "active", networks: ["base"], token: "USDC" },
    },
    mcp: { server: "arch-tools-mcp", transport: ["stdio", "sse"], discovery: "/v1/tools" },
    llms_txt: `${apiBase}/llms.txt`,
    contact: "https://archtools.dev",
  });
});

// llms.txt — machine-readable tool index for AI coding assistants
// Spec: https://llmstxt.org
app.get("/llms.txt", (_req, res) => {
  const apiBase = publicApiBase();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(`# Arch Tools
> 30 production-ready API tools for developers and AI agents.
> Base URL: ${apiBase}
> Docs: https://archtools.dev
> OpenAPI: ${apiBase}/openapi.json
> MCP: https://arch-tools-mcp.onrender.com/mcp

## Authentication
All tool endpoints require an API key via header:
  Authorization: Bearer YOUR_API_KEY

Get a key at https://archtools.dev/signin

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
POST /v1/tools/search-web           (5 credits)  — Search results (Tavily/Serper/DuckDuckGo fallback)
POST /v1/tools/web-search           (10 credits) — Real-time search with AI-synthesized answer
POST /v1/tools/extract-page         (5 credits)  — Clean text, links, and metadata from any webpage
POST /v1/tools/extract-pdf          (6 credits)  — Extract text from a PDF (requires PDF_EXTRACTOR_URL)
POST /v1/tools/browser-task         (10 credits) — Headless Playwright automation (click/type/extract)
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
Supports $last variable to reference prior step output.

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
Discovery: ${apiBase}/.well-known/x402

## SDKs
Python: pip install archtools
Node:   npm install @archtools/sdk

## Legal
Terms:   ${apiBase}/legal/terms
Privacy: ${apiBase}/legal/privacy
`);
});

// server.json — x402 Bazaar machine-readable discovery
app.get("/server.json", (_req, res) => {
  const apiBase = publicApiBase();
  res.json({
    name: "Arch Tools",
    description: "30 production-ready API tools for developers and AI agents",
    url: apiBase,
    homepage: "https://archtools.dev",
    version: "1.0.0",
    openapi: `${apiBase}/openapi.json`,
    mcp: "https://arch-tools-mcp.onrender.com/mcp",
    llms_txt: `${apiBase}/llms.txt`,
    payment: {
      protocol: "x402",
      network: "base",
      token: "USDC",
      pricing: { unit: "credit", usd_per_credit: 0.009 },
    },
    auth: { type: "apiKey", header: "Authorization", scheme: "Bearer" },
    tags: ["api", "tools", "ai-agents", "mcp", "x402", "usdc", "nlp", "validation", "browser-automation"],
  });
});

// security.txt (responsible disclosure)
// Spec: https://securitytxt.org/
app.get("/.well-known/security.txt", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  const canonical = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "") + "/.well-known/security.txt";
  const exp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365); // 1 year
  const expires = exp.toISOString();
  res.send(
`Contact: security@archtools.dev
Expires: ${expires}
Canonical: ${canonical}
Policy: https://archtools.dev/legal/security
Acknowledgments: https://archtools.dev
Preferred-Languages: en
`
  );
});

// Changelog (simple, premium trust signal)
app.get("/changelog", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(
`Arch Tools — Changelog

v1.0.0
- Agent authentication + API keys
- Credit ledger + Stripe credit packs
- Tool registry + discovery (GET /v1/tools)
- Unified tool invocation (POST /v1/tools/:toolName)
- MCP server support (stdio + SSE)
- Premium docs, SDKs, Postman collection, and legal policies
`
  );
});

// Dashboard (simple, premium)
app.get("/dashboard", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(dashboardHtml);
});

// API info / root — HTML for browsers, JSON for API clients
app.get("/", (req, res) => {
  const accept = req.headers["accept"] || "";
  const wantsHtml = accept.includes("text/html") && !accept.startsWith("application/json");
  if (wantsHtml && landingHtml) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(landingHtml);
  }
  res.json({
    name: "Arch Tools API",
    version: "1.0.0",
    docs: "https://archtools.dev",
    legal: {
      terms: "/legal/terms",
      privacy: "/legal/privacy",
    },
    openapi: "/openapi.json",
    api_docs: "/docs",
    endpoints: {
      health: "GET /health",
      tools: "GET /v1/tools",
      register: "POST /v1/agent/register",
      usage: "GET /v1/agent/usage",
      checkout: "POST /v1/checkout",
      invoke: "POST /v1/tools/:toolName",
    },
  });
});

// Health endpoint — includes DB connectivity check
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const toolCount = await prisma.tool.count({ where: { active: true } });
    const agentCount = await prisma.agent.count();
    res.json({
      ok: true,
      service: "arch-tools-api",
      version: "1.0.0",
      db: "connected",
      tools: toolCount,
      agents: agentCount,
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (e: any) {
    res.status(503).json({ ok: false, service: "arch-tools-api", db: "disconnected", detail: e.message });
  }
});

// ─── Routes ───
app.use(openApiRouter);
app.use(docsRouter);
app.use(postmanRouter);
app.use(legalRouter);
app.use(statusRouter);
app.use(adminRouter);
app.use(limitsRouter);
app.use(toolsRouter);
app.use(authRouter);
app.use(agentRouter);
app.use(publishRouter);
app.use(invokeRouter);
app.use(workflowsRouter);
app.use(stripeRouter);
app.use(dashboardRouter);

// 404 + errors (order matters)
app.use(notFoundHandler);

// Sentry error handler must be AFTER all routes and BEFORE custom error handler.
// See Sentry Express guide and known issues with handler order.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(errorHandler);

// ─── Startup ───
const port = Number(process.env.PORT || 8787);
const server = app.listen(port, async () => {
  logger.info({ port }, "Arch Tools API listening");
  try {
    await prisma.$connect();
    logger.info("Database connected");
  } catch (e) {
    logger.error(e, "DB connect failed — API will start but DB queries will fail");
  }

  try {
    const count = await prisma.tool.count();
    if (count === 0) {
      logger.warn("No tools in database. Run `npm run seed` to seed default tools.");
    } else {
      logger.info({ count }, "Tools loaded from database");
    }
  } catch {}
});

// ─── Graceful Shutdown ───
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down...");
  server.close(() => {
    prisma.$disconnect().then(() => {
      logger.info("Disconnected from database");
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
