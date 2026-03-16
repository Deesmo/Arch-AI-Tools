import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { X402_PRICES } from "../middleware/x402.js";

const router = Router();

const BASE_URL = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";
const API_BASE = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";
const NETWORK = process.env.X402_NETWORK ?? "base";

// ─── OAuth 2.1 Authorization Server Metadata (RFC 8414) ──────────────────────
router.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response): void => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    scopes_supported: ["tools:read", "tools:execute"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${BASE_URL}/docs`,
  });
});

// ─── OAuth Protected Resource Metadata (RFC 9728) ────────────────────────────
router.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response): void => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    scopes_supported: ["tools:read", "tools:execute"],
    bearer_methods_supported: ["header"],
  });
});

// GET /health
router.get("/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [toolCount, agentCount] = await Promise.all([
      prisma.tool.count(),
      prisma.agent.count(),
    ]);
    res.json({ ok: true, service: "arch-tools-api", version: "1.10.0", db: "connected", tools: toolCount || 58, agents: agentCount });
  } catch {
    res.json({ ok: true, service: "arch-tools-api", version: "1.10.0", db: "error" });
  }
});

// GET /.well-known/x402 — x402 discovery (all supported chains)
router.get("/.well-known/x402", (_req: Request, res: Response): void => {
  const evmWallet = process.env.WALLET_ADDRESS ?? "";
  const solanaWallet = process.env.SOLANA_WALLET_ADDRESS ?? "";
  const nobleWallet = process.env.NOBLE_WALLET_ADDRESS ?? "";
  const algorandWallet = process.env.ALGORAND_WALLET_ADDRESS ?? "";
  const stellarWallet = process.env.STELLAR_WALLET_ADDRESS ?? "";
  const stellarMemo = process.env.STELLAR_WALLET_MEMO ?? "";
  const suiWallet = process.env.SUI_WALLET_ADDRESS ?? "";
  const polkadotWallet = process.env.POLKADOT_WALLET_ADDRESS ?? "";
  const aptosWallet = process.env.APTOS_WALLET_ADDRESS ?? "";
  const usdtWallet = process.env.USDT_ETH_WALLET_ADDRESS ?? "";
  const ethWallet = process.env.ETH_WALLET_ADDRESS ?? "";
  const bnbWallet = process.env.BNB_WALLET_ADDRESS ?? "";
  const nearWallet = process.env.NEAR_WALLET_ADDRESS ?? "";
  const solNativeWallet = process.env.SOL_NATIVE_WALLET_ADDRESS ?? "";
  const taoWallet = process.env.TAO_WALLET_ADDRESS ?? "";
  const uniWallet = process.env.UNI_WALLET_ADDRESS ?? "";

  const USDC_CONTRACTS: Record<string, string> = {
    base:      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    ethereum:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    arbitrum:  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    polygon:   "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    optimism:  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    unichain:  "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    monad:     "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  };
  const USDT_CONTRACTS: Record<string, string> = {
    ethereum:  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    arbitrum:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    polygon:   "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    optimism:  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    base:      "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  };

  // Build accepts array from live wallet config
  const accepts: object[] = [];
  const activeNetworks: string[] = [];

  // USDC on EVM chains (Base, Ethereum, Arbitrum, Polygon, Optimism, Avalanche, Unichain, Monad)
  if (evmWallet) {
    const evmUsdcChains: Array<{ network: string; chain: string; description: string }> = [
      { network: "eip155:8453",  chain: "base",      description: "USDC on Coinbase Base (fast, ~$0.01 gas)" },
      { network: "eip155:1",     chain: "ethereum",  description: "USDC on Ethereum mainnet" },
      { network: "eip155:42161", chain: "arbitrum",  description: "USDC on Arbitrum (fast L2)" },
      { network: "eip155:137",   chain: "polygon",   description: "USDC on Polygon" },
      { network: "eip155:10",    chain: "optimism",  description: "USDC on Optimism (fast L2)" },
      { network: "eip155:43114", chain: "avalanche", description: "USDC on Avalanche C-Chain" },
      { network: "eip155:130",   chain: "unichain",  description: "USDC on Unichain (Uniswap L2)" },
      { network: "eip155:143",   chain: "monad",     description: "USDC on Monad (high-perf L1)" },
    ];
    for (const { network, chain, description } of evmUsdcChains) {
      accepts.push({ scheme: "exact", network, asset: USDC_CONTRACTS[chain], payTo: evmWallet, token: "USDC", description });
      activeNetworks.push(network);
    }
  }

  // USDC on Solana
  if (solanaWallet) {
    accepts.push({
      scheme: "exact",
      network: "solana:mainnet",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      payTo: solanaWallet,
      token: "USDC",
      description: "USDC on Solana (fast, cheap)",
    });
    activeNetworks.push("solana:mainnet");
  }

  // USDC on Noble/Cosmos
  if (nobleWallet) {
    accepts.push({
      scheme: "exact",
      network: "cosmos:noble-1",
      asset: "uusdc",
      payTo: nobleWallet,
      token: "USDC",
      description: "USDC on Noble/Cosmos (IBC to 50+ Cosmos chains)",
    });
    activeNetworks.push("cosmos:noble-1");
  }

  // USDC on Algorand
  if (algorandWallet) {
    accepts.push({
      scheme: "exact",
      network: "algorand:mainnet",
      asset: "31566704",
      payTo: algorandWallet,
      token: "USDC",
      description: "USDC on Algorand (ASA #31566704)",
    });
    activeNetworks.push("algorand:mainnet");
  }

  // USDC on Stellar
  if (stellarWallet) {
    accepts.push({
      scheme: "exact",
      network: "stellar:pubnet",
      asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      payTo: stellarWallet,
      token: "USDC",
      description: "USDC on Stellar (17-sec settlement)",
      memo: stellarMemo || undefined,
    });
    activeNetworks.push("stellar:pubnet");
  }

  // USDC on Sui
  if (suiWallet) {
    accepts.push({
      scheme: "exact",
      network: "sui:mainnet",
      asset: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      payTo: suiWallet,
      token: "USDC",
      description: "USDC on Sui (Move L1, Circle CCTP)",
    });
    activeNetworks.push("sui:mainnet");
  }

  // USDC on Polkadot Asset Hub
  if (polkadotWallet) {
    accepts.push({
      scheme: "exact",
      network: "polkadot:asset-hub",
      asset: "1337",
      payTo: polkadotWallet,
      token: "USDC",
      description: "USDC on Polkadot Asset Hub (XCM to all parachains)",
    });
    activeNetworks.push("polkadot:asset-hub");
  }

  // USDC on Aptos
  if (aptosWallet) {
    accepts.push({
      scheme: "exact",
      network: "aptos:mainnet",
      asset: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
      payTo: aptosWallet,
      token: "USDC",
      description: "USDC on Aptos (Move L1, native Circle)",
    });
    activeNetworks.push("aptos:mainnet");
  }

  // USDT on EVM chains
  if (usdtWallet) {
    const usdtChains: Array<{ network: string; chain: string }> = [
      { network: "eip155:1",     chain: "ethereum" },
      { network: "eip155:42161", chain: "arbitrum" },
      { network: "eip155:137",   chain: "polygon" },
      { network: "eip155:10",    chain: "optimism" },
      { network: "eip155:43114", chain: "avalanche" },
      { network: "eip155:8453",  chain: "base" },
    ];
    for (const { network, chain } of usdtChains) {
      if (USDT_CONTRACTS[chain]) {
        accepts.push({
          scheme: "exact",
          network,
          asset: USDT_CONTRACTS[chain],
          payTo: usdtWallet,
          token: "USDT",
          description: `USDT on ${chain.charAt(0).toUpperCase() + chain.slice(1)}`,
        });
      }
    }
  }

  // Native ETH (Ethereum + Base)
  if (ethWallet) {
    accepts.push(
      { scheme: "exact", network: "eip155:1",    asset: "0x0000000000000000000000000000000000000000", payTo: ethWallet, token: "ETH", description: "Native ETH on Ethereum" },
      { scheme: "exact", network: "eip155:8453", asset: "0x0000000000000000000000000000000000000000", payTo: ethWallet, token: "ETH", description: "Native ETH on Base (fast, cheap)" },
    );
  }

  // Native BNB
  if (bnbWallet) {
    accepts.push({ scheme: "exact", network: "eip155:56", asset: "0x0000000000000000000000000000000000000000", payTo: bnbWallet, token: "BNB", description: "Native BNB on BNB Chain" });
    activeNetworks.push("eip155:56");
  }

  // Native NEAR
  if (nearWallet) {
    accepts.push({ scheme: "exact", network: "near:mainnet", asset: "near", payTo: nearWallet, token: "NEAR", description: "Native NEAR on NEAR Protocol" });
    activeNetworks.push("near:mainnet");
  }

  // Native SOL
  if (solNativeWallet) {
    accepts.push({ scheme: "exact", network: "solana:mainnet", asset: "native", payTo: solNativeWallet, token: "SOL", description: "Native SOL on Solana" });
  }

  // TAO (Bittensor)
  if (taoWallet) {
    accepts.push({ scheme: "exact", network: "bittensor:finney", asset: "TAO", payTo: taoWallet, token: "TAO", description: "TAO on Bittensor (AI-native blockchain)" });
    activeNetworks.push("bittensor:finney");
  }

  // UNI (Uniswap)
  if (uniWallet) {
    accepts.push({ scheme: "exact", network: "eip155:1", asset: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", payTo: uniWallet, token: "UNI", description: "UNI governance token on Ethereum" });
  }

  const endpoints = Object.entries(X402_PRICES).map(([tool, price]) => ({
    path: `/v1/tools/${tool}`,
    method: "POST",
    price: `$${price}`,
    description: TOOL_DESCRIPTIONS[tool] ?? tool,
  }));

  res.json({
    name: "Arch Tools",
    description: "The first API platform built for autonomous agent payments. 58 production tools, USDC on 15+ chains via x402 or Stripe.",
    url: BASE_URL,
    api_base: API_BASE,
    version: "1",
    accepts,
    endpoints,
    payment: {
      stripe: { url: `${BASE_URL}/pricing` },
      x402: { status: "active", networks: [...new Set(activeNetworks)], token: "USDC/USDT/ETH/BNB/NEAR/SOL/TAO/UNI" },
    },
    mcp: {
      server: "arch-tools-mcp",
      transport: ["stdio", "sse", "streamable-http"],
      discovery: "/v1/tools",
    },
    llms_txt: `${API_BASE}/llms.txt`,
    contact: BASE_URL,
  });
});

// GET /v1/tools — full tool list with schemas
router.get("/v1/tools", async (_req: Request, res: Response): Promise<void> => {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — `active` exists in prod schema; local client may be stale
  const tools = await prisma.tool.findMany({ where: { active: true }, orderBy: { name: "asc" } });
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
  "screenshot-capture": "Capture a screenshot of any URL as a PNG image",
  "html-to-markdown": "Convert HTML content to clean Markdown",
  "url-shorten": "Shorten any URL to a compact link",
  "webhook-send": "Send HTTP webhooks with custom payload and headers",
  "jsonpath-query": "Execute JSONPath queries on any JSON payload",
  "barcode-generate": "Generate Code128 barcodes as SVG",
  "image-generate": "Generate SVG images from text prompts via AI",
  "workflow-agent": "Execute multi-step autonomous AI agent pipeline",
  "crypto-price": "Real-time crypto price, 24h change, market cap, and volume",
  "crypto-ohlcv": "OHLCV candlestick data for technical analysis",
  "crypto-market-cap": "Top N coins by market cap",
  "crypto-fear-greed": "Crypto Fear & Greed Index with historical data",
  "crypto-sentiment": "Community sentiment and social stats for any coin",
  "crypto-news": "Latest crypto news headlines, filterable by symbol",
  "token-lookup": "Search any crypto token by name or ticker",
  "text-to-speech": "Convert text to natural-sounding audio via ElevenLabs (returns base64 MP3)",
  "transcribe-audio": "Transcribe audio files to text via OpenAI Whisper (URL input, 100+ languages)",
  "email-send": "Send transactional emails via Resend — plain text or HTML",
  "design-create": "Generate images from text prompts via DALL-E 3 (1024x1024, 1792x1024, 1024x1792)",
  "domain-check": "Check if a domain is available or registered via RDAP (no key needed)",
  "extract-pdf": "Extract text from a PDF (URL or base64)",
  "ai-oracle": "Premium reasoning with structured analysis and confidence levels",
  "session-create": "Create a managed conversation session",
  "session-message": "Send a message in an existing conversation session",
  "news-search": "Search real-time news articles by keyword",
  "research-report": "Generate a structured research report on any topic",
  "fact-check": "Verify claims against real-time web sources",
  "video-generate": "AI video generation from text prompts via Runway Gen-3",
  "image-remove-bg": "Remove background from any image via RemoveBG",
  "email-find": "Find email address for a person at a company via Hunter.io",
  "semantic-search": "Neural/semantic web search via Exa AI",
  "social-post": "Post a tweet to X/Twitter via API v2",
};

const LLMS_TXT = `# Arch Tools
> The first API platform built for autonomous agent payments.
> 58 production-ready tools. One key. USDC on 15+ chains via x402 or Stripe.
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

## All Tools (58 total)

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
POST /v1/tools/ai-oracle            (25 credits) — Premium reasoning with structured analysis and confidence levels
POST /v1/tools/session-message      (20 credits) — Send a message in an existing conversation session
POST /v1/tools/research-report      (15 credits) — Generate a structured research report on any topic
POST /v1/tools/fact-check           (10 credits) — Verify claims against real-time web sources
POST /v1/tools/semantic-search      (8 credits)  — Neural/semantic web search via Exa AI

### Media
POST /v1/tools/video-generate       (50 credits) — AI video generation from text prompts via Runway Gen-3
POST /v1/tools/image-remove-bg      (10 credits) — Remove background from any image via RemoveBG

### Social
POST /v1/tools/social-post          (5 credits)  — Post a tweet to X/Twitter

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
POST /v1/tools/news-search          (3 credits)  — Search real-time news articles by keyword

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
POST /v1/tools/email-find           (5 credits)  — Find email address for a person at a company via Hunter.io
POST /v1/tools/phone-validate       (2 credits)  — E.164 format, type, country code

### Security
POST /v1/tools/generate-hash        (1 credit)   — sha256, sha512, md5, sha1

### Finance
POST /v1/tools/currency-convert     (2 credits)  — 170+ currencies with live rates

### Utilities
POST /v1/tools/timezone-convert     (1 credit)   — Any IANA timezone pair
POST /v1/tools/generate-uuid        (1 credit)   — v1/v4, random tokens, API-key format
POST /v1/tools/session-create       (5 credits)  — Create a managed conversation session

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
  info: { title: "Arch Tools API", version: "1.10.0", description: "58 production-ready API tools for developers and AI agents. Dual payment rails: Stripe + x402 USDC on 15+ chains.", contact: { name: "Arch Tools", url: BASE_URL } },
  servers: [{ url: API_BASE }],
  tags: [{ name: "Tools" }, { name: "Agents" }, { name: "Billing" }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API Key" } } },
};

const FALLBACK_TOOLS = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
  name,
  description,
  credits: Object.entries({ "ai-generate": 20, "ocr-extract": 10, "sentiment-analysis": 8, "summarize": 10, "extract-entities": 8, "regex-generate": 8, "pii-detect": 10, "web-search": 10, "web-scrape": 5, "search-web": 5, "extract-page": 5, "browser-task": 10, "extract-pdf": 6, "rss-parse": 4, "currency-convert": 2, "email-verify": 3, "phone-validate": 2, "ip-lookup": 2, "whois-lookup": 3, "language-detect": 3, "transform-text": 3, "extract-metadata": 3, "diff-text": 2, "readability-score": 2, "convert-format": 2, "qr-code": 2, "generate-uuid": 1, "timezone-convert": 1, "validate-data": 1, "generate-hash": 1, "text-to-speech": 5, "transcribe-audio": 8, "email-send": 3, "design-create": 15, "domain-check": 2, "ai-oracle": 25, "session-create": 5, "session-message": 20, "news-search": 3, "research-report": 15, "fact-check": 10 }).find(([k]) => k === name)?.[1] ?? 5,
  category: ["ai-generate","ocr-extract","sentiment-analysis","summarize","extract-entities","regex-generate","pii-detect","web-search","language-detect","ai-oracle","session-message","research-report","fact-check"].includes(name) ? "ai" : ["web-scrape","search-web","extract-page","browser-task","rss-parse","news-search"].includes(name) ? "web" : "utility",
  active: true,
  endpoint: `/v1/tools/${name}`,
  method: "POST",
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [],
}));

export default router;
