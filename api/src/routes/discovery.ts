import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { X402_PRICES } from "../middleware/x402.js";
import { getStatusPageData } from "../middleware/analytics.js";
import { config } from "../config.js";
import { isValidAdminKey } from "../middleware/auth.js";

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

// GET /health — Enhanced health endpoint with dependency status + response time percentiles
router.get("/health", async (_req: Request, res: Response): Promise<void> => {
  const startMs = Date.now();

  // Check DB connection
  let dbStatus: "connected" | "error" = "error";
  let dbLatencyMs = 0;
  let toolCount = 63; // stale-safe fallback; overwritten by prisma.tool.count() below
  let agentCount = 0;
  try {
    const dbStart = Date.now();
    [toolCount, agentCount] = await Promise.all([
      prisma.tool.count(),
      prisma.agent.count(),
    ]);
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = "connected";
  } catch {
    dbStatus = "error";
  }

  // Check Redis connection
  let redisStatus: "connected" | "not_configured" | "error" = "not_configured";
  let redisLatencyMs = 0;
  if (redis) {
    try {
      const redisStart = Date.now();
      await redis.ping();
      redisLatencyMs = Date.now() - redisStart;
      redisStatus = "connected";
    } catch {
      redisStatus = "error";
    }
  }

  // Check x402 facilitator reachability (lightweight HEAD/GET with timeout)
  let facilitatorStatus: "reachable" | "unreachable" | "not_configured" = "not_configured";
  let facilitatorLatencyMs = 0;
  const facilitatorUrl = config.x402.facilitatorUrl;
  if (facilitatorUrl) {
    try {
      const facStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const facRes = await fetch(facilitatorUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "ArchTools-HealthCheck/1.0" },
      });
      clearTimeout(timeout);
      facilitatorLatencyMs = Date.now() - facStart;
      facilitatorStatus = facRes.status < 500 ? "reachable" : "unreachable";
    } catch {
      facilitatorStatus = "unreachable";
    }
  }

  // Get response time percentiles from analytics
  const statusData = getStatusPageData();

  const overallOk = dbStatus === "connected";
  const checkMs = Date.now() - startMs;

  // Public response — minimal, no internal details
  // Detailed health available to admin key holders only
  const adminKey = (_req as import("express").Request & { headers: Record<string, string | string[] | undefined> }).headers["x-admin-key"];
  const isAdmin = isValidAdminKey(typeof adminKey === "string" ? adminKey : undefined);

  if (!isAdmin) {
    res.status(overallOk ? 200 : 503).json({ ok: overallOk });
    return;
  }

  res.status(overallOk ? 200 : 503).json({
    ok: overallOk,
    service: "arch-tools-api",
    version: "1.10.0",
    uptime_seconds: statusData.uptime_seconds,
    tools: toolCount || 64,
    agents: agentCount,
    dependencies: {
      database: { status: dbStatus, latency_ms: dbLatencyMs },
      redis: { status: redisStatus, latency_ms: redisLatencyMs },
      x402_facilitator: { status: facilitatorStatus, latency_ms: facilitatorLatencyMs, url: facilitatorUrl },
    },
    performance: {
      health_check_ms: checkMs,
      p50_response_ms: statusData.p50_response_ms,
      p95_response_ms: statusData.p95_response_ms,
      p99_response_ms: statusData.p99_response_ms,
      avg_response_ms: statusData.avg_response_ms,
    },
  });
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

  // USDC on Solana (canonical CAIP-2 genesis-hash form per x402 v2 spec §11.1 —
  // the "solana:mainnet" alias is non-canonical and only warn-passes validators)
  if (solanaWallet) {
    accepts.push({
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      payTo: solanaWallet,
      token: "USDC",
      description: "USDC on Solana (fast, cheap)",
    });
    activeNetworks.push("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
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
    accepts.push({ scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "native", payTo: solNativeWallet, token: "SOL", description: "Native SOL on Solana" });
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
    description: "The first API platform built for autonomous agent payments. 63 production tools, USDC on Base or Polygon via x402 or Stripe.",
    url: BASE_URL,
    api_base: API_BASE,
    // x402 protocol version served on our 402 challenges (spec-correct v2 —
    // CAIP-2 networks, `amount` fields, PAYMENT-REQUIRED header transport).
    version: "2",
    x402Version: 2,
    // Chain/asset/wallet summary — NOT a spec §5.1.2 PaymentRequirements array
    // (entries here have no per-tool `amount`/`maxTimeoutSeconds`), so it lives
    // under `supportedRails` rather than `accepts` to keep strict v2 consumers
    // from parsing it as PaymentRequirements the version-2 stamp invites them to
    // trust. The authoritative, spec-shaped accepts[] ride on every tool's 402
    // challenge. Safe to reshape: /.well-known/x402 is not spec-governed (no
    // mention in coinbase/x402 specs/) and x402scan's discovery parser dropped it
    // (@agentcash/discovery 1.7.5 SPECIFICATION.md: "Legacy /.well-known/x402 ...
    // no longer parsed" — it discovers via /openapi.json).
    supportedRails: accepts,
    rails_note:
      "supportedRails is a chain/asset/wallet summary for humans and crawlers. Spec-shaped x402 v2 PaymentRequirements (CAIP-2 network, amount, maxTimeoutSeconds) are served in the accepts[] of each tool's 402 challenge.",
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
    // Honesty annotation: usage-metered tools charge MORE than the listed base.
    // `credits` stays the base/minimum (unchanged); `metered` + `credits_note`
    // let clients render "500+ (metered)" instead of implying a flat price.
    const METERED: Record<string, string> = {
      "text-to-speech": "metered by length — 25 base + 8 credits per 100 characters",
      "video-generate": "metered by duration — 140 credits/second (5s = 700, 10s = 1400), 700 minimum",
    };
    const annotated = tools.map((t: { name: string; credits?: number }) => {
      const note = METERED[t.name];
      return note
        ? { ...t, metered: true, credits_note: `${t.credits ?? ""}+ credits — ${note}` }
        : { ...t, metered: false };
    });
    res.json({ ok: true, tools: annotated });
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

// GET /llms-full.txt — complete documentation for AI
router.get("/llms-full.txt", (_req: Request, res: Response): void => {
  const fs = require("fs");
  const path = require("path");
  try {
    const content = fs.readFileSync(path.join(__dirname, "../../public/llms-full.txt"), "utf8");
    res.type("text/plain").send(content);
  } catch {
    res.type("text/plain").send("See https://archtools.dev/llms.txt");
  }
});

// GET /.well-known/agent.json — A2A Agent Card (Google Agent2Agent protocol)
router.get("/.well-known/agent.json", (_req: Request, res: Response): void => {
  const fs = require("fs");
  const path = require("path");
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/.well-known/agent.json"), "utf8"));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(content);
  } catch {
    res.status(404).json({ error: "agent card not found" });
  }
});

// GET /.well-known/agent-card.json — alias for A2A Agent Card
router.get("/.well-known/agent-card.json", (_req: Request, res: Response): void => {
  const fs = require("fs");
  const path = require("path");
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/.well-known/agent.json"), "utf8"));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(content);
  } catch {
    res.status(404).json({ error: "agent card not found" });
  }
});

// GET /.well-known/agents.json — Wildcard AI agents.json spec
router.get("/.well-known/agents.json", (_req: Request, res: Response): void => {
  const fs = require("fs");
  const path = require("path");
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/.well-known/agents.json"), "utf8"));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(content);
  } catch {
    res.status(404).json({ error: "agents.json not found" });
  }
});

// GET /.well-known/mcp/server-card.json — Smithery MCP server card
router.get("/.well-known/mcp/server-card.json", (_req: Request, res: Response): void => {
  const fs = require("fs");
  const path = require("path");
  try {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/.well-known/mcp/server-card.json"), "utf8"));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(content);
  } catch {
    res.status(404).json({ error: "server-card.json not found" });
  }
});

// GET /.well-known/mcp.json — MCP server discovery
router.get("/.well-known/mcp.json", (_req: Request, res: Response): void => {
  try {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "../../public/.well-known/mcp.json");
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "mcp.json not found" });
      return;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    let content: object;
    try {
      content = JSON.parse(raw);
    } catch (parseErr) {
      console.error("[discovery] mcp.json parse error:", parseErr);
      res.status(500).json({ error: "mcp.json parse error" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Type", "application/json");
    res.json(content);
  } catch (err) {
    console.error("[discovery] mcp.json read error:", err);
    res.status(500).json({ error: "internal error reading mcp.json" });
  }
});

// GET /v1/discover — unified discovery endpoint (all tools + pricing + payment in one call)
router.get("/v1/discover", async (_req: Request, res: Response): Promise<void> => {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — `active` exists in prod schema; local client may be stale
    const tools = await prisma.tool.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    const toolList = tools.map((t: { name: string; description: string | null; credits: number | null; category: string | null }) => ({
      name: t.name,
      description: t.description ?? TOOL_DESCRIPTIONS[t.name] ?? "",
      endpoint: `${API_BASE}/v1/tools/${t.name}`,
      method: "POST",
      credits: t.credits ?? 5,
      category: t.category ?? "utility",
    }));
    res.json({
      ok: true,
      name: "Arch Tools",
      description: "63 production-ready API tools for AI agents. Pay with API key or USDC (x402).",
      version: "1.10.0",
      baseUrl: API_BASE,
      tools: toolList,
      totalTools: toolList.length,
      authentication: {
        apiKey: { header: "x-api-key", format: "YOUR_API_KEY" },
        x402: { discovery: `${API_BASE}/.well-known/x402` },
        oauth: { authorize: `${API_BASE}/oauth/authorize`, token: `${API_BASE}/oauth/token` },
      },
      pricing: {
        freeCredits: 100,
        packs: [
          { name: "Starter", credits: 3000, price: "$9" },
          { name: "Pro", credits: 25000, price: "$49" },
          { name: "Business", credits: 125000, price: "$199" },
        ],
      },
      discovery: {
        openapi: `${API_BASE}/openapi.json`,
        llms_txt: `${API_BASE}/llms.txt`,
        llms_full_txt: `${API_BASE}/llms-full.txt`,
        agent_card: `${API_BASE}/.well-known/agent.json`,
        agents_json: `${API_BASE}/.well-known/agents.json`,
        mcp_json: `${API_BASE}/.well-known/mcp.json`,
        ai_plugin: `${API_BASE}/.well-known/ai-plugin.json`,
        x402: `${API_BASE}/.well-known/x402`,
        schemas: {
          openai: `${API_BASE}/schemas/openai-tools.json`,
          anthropic: `${API_BASE}/schemas/anthropic-tools.json`,
          gemini: `${API_BASE}/schemas/gemini-tools.json`,
        },
      },
      mcp: {
        sse: "https://archtools.dev/mcp/sse",
        http: "https://archtools.dev/mcp/mcp",
        registry: "io.github.Deesmo/arch-tools-mcp",
      },
    });
  } catch {
    // Fallback with static tool list
    const toolList = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
      name,
      description,
      endpoint: `${API_BASE}/v1/tools/${name}`,
      method: "POST",
      credits: 5,
      category: "utility",
    }));
    res.json({
      ok: true,
      name: "Arch Tools",
      description: "63 production-ready API tools for AI agents.",
      version: "1.10.0",
      baseUrl: API_BASE,
      tools: toolList,
      totalTools: toolList.length,
    });
  }
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
  "extract-pdf": "Extract text from a PDF (URL or base64; max 5MB / 50 pages per call)",
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
};

const LLMS_TXT = `# Arch Tools
> The first API platform built for autonomous agent payments.
> 63 production-ready tools. One key. USDC on Base or Polygon via x402 or Stripe.
> Base URL: ${API_BASE}
> Docs: ${BASE_URL}
> OpenAPI: ${API_BASE}/openapi.json
> MCP SSE: https://archtools.dev/mcp/sse

## Authentication
All tool endpoints require an API key:
  x-api-key: YOUR_API_KEY

Get a free key (100 credits) at ${BASE_URL}/#register

## x402 Autonomous Payment (no key required)
AI agents can pay per-call with USDC on Base via the x402 protocol.
No API key, no signup, no human credit card needed.
Discovery: ${API_BASE}/.well-known/x402
Protocol: https://x402.org

## Credit System
Tools cost credits per call. Credits never expire. Non-transferable.

  Starter Pack:    3,000 credits — $9     ($0.0030/credit)
  Pro Pack:       25,000 credits — $49    ($0.00196/credit)
  Business Pack: 125,000 credits — $199   ($0.00159/credit)

## All Tools (63 total)

### AI (Claude-powered)
POST /v1/tools/ai-generate          (20+ credits, scales w/ max_tokens) — Text generation via Claude Sonnet
POST /v1/tools/ocr-extract          (12 credits) — Extract text from images (URL or base64)
POST /v1/tools/sentiment-analysis   (8 credits)  — Sentiment + 6 emotions (joy, anger, sadness…)
POST /v1/tools/summarize            (10 credits) — paragraph, bullets, tldr, headline, executive styles
POST /v1/tools/extract-entities     (8 credits)  — NER: people, orgs, locations, dates, money
POST /v1/tools/language-detect      (3 credits)  — 100+ languages with confidence score
POST /v1/tools/regex-generate       (8 credits)  — Natural language → validated regex with tests
POST /v1/tools/pii-detect           (10 credits) — Detect and optionally redact PII
POST /v1/tools/image-generate       (30 credits) — Generate SVG images from text prompts
POST /v1/tools/workflow-agent       (25 credits) — Multi-step autonomous AI agent pipeline
POST /v1/tools/ai-oracle            (25 credits) — Premium reasoning with structured analysis and confidence levels
POST /v1/tools/session-message      (20+ credits, scales w/ session model) — Send a message in an existing conversation session
POST /v1/tools/research-report      (40 credits) — Generate a structured research report on any topic
POST /v1/tools/fact-check           (14 credits) — Verify claims against real-time web sources
POST /v1/tools/semantic-search      (8 credits)  — Neural/semantic web search via Exa AI

### Media & Audio
POST /v1/tools/text-to-speech       (25+ credits, metered by length) — Convert text to natural-sounding audio via ElevenLabs
POST /v1/tools/transcribe-audio     (25 credits) — Transcribe audio files to text via OpenAI Whisper
POST /v1/tools/video-generate       (700+ credits, scales w/ duration) — AI video generation from text prompts via Runway Gen-3
POST /v1/tools/design-create        (50 credits) — Generate images from text prompts via DALL-E 3
POST /v1/tools/image-remove-bg      (350 credits) — Remove background from any image via RemoveBG

### Social & Communication
POST /v1/tools/email-send           (3 credits)  — Send transactional emails via Resend
POST /v1/tools/email-find           (110 credits)  — Find email address for a person at a company via Hunter.io

### Web
POST /v1/tools/web-scrape           (5 credits)  — Scrape any public URL with optional CSS selector
POST /v1/tools/search-web           (5 credits)  — Search results (DuckDuckGo)
POST /v1/tools/web-search           (14 credits) — Real-time search with AI-synthesized answer
POST /v1/tools/extract-page         (5 credits)  — Clean text, links, and metadata from any webpage
POST /v1/tools/extract-pdf          (6 credits)  — Extract text from a PDF (URL or base64; max 5MB / 50 pages)
POST /v1/tools/browser-task         (10 credits) — Headless browser automation via Playwright
POST /v1/tools/rss-parse            (4 credits)  — Parse RSS or Atom feeds into structured JSON
POST /v1/tools/screenshot-capture   (10 credits) — Screenshot any URL
POST /v1/tools/html-to-markdown     (3 credits)  — Convert HTML to clean Markdown
POST /v1/tools/url-shorten          (1 credit)   — Shorten any URL
POST /v1/tools/webhook-send         (2 credits)  — Send HTTP webhooks with payload
POST /v1/tools/news-search          (12 credits)  — Search real-time news articles by keyword

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

### Domain & Validation
POST /v1/tools/domain-check         (2 credits)  — Check if a domain is available via RDAP
POST /v1/tools/check-domain         (2 credits)  — Domain availability check (alias)
POST /v1/tools/email-verify         (3 credits)  — MX check + disposable domain detection
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
SSE endpoint: https://archtools.dev/mcp/sse
Registry: io.github.Deesmo/arch-tools-mcp
Compatible with: Claude Desktop, Cursor, Windsurf, any MCP client

## Legal
Credits are non-transferable, non-refundable, tied to one API key.
Terms:   ${BASE_URL}/terms.html
Privacy: ${BASE_URL}/privacy.html
`;

const OPENAPI_STUB = {
  openapi: "3.0.3",
  info: { title: "Arch Tools API", version: "1.10.0", description: "Production-ready API tools for developers and AI agents. Dual payment rails: credits + x402 USDC micropayments.", contact: { name: "Arch Tools", url: BASE_URL } },
  servers: [{ url: API_BASE }],
  tags: [{ name: "Tools" }, { name: "Agents" }, { name: "Billing" }],
  components: { securitySchemes: { apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" } } },
};

// Fallback per-tool credit prices, served only when the DB is unreachable.
// MUST mirror the deductCredits charges in routes/tools/index.ts (metered tools
// list their base/minimum) — enforced in CI by scripts/check-price-drift.mjs,
// which also fails if any TOOL_DESCRIPTIONS key is missing here.
const FALLBACK_CREDITS: Record<string, number> = {
  "validate-data": 1,
  "generate-hash": 1,
  "qr-code": 2,
  "convert-format": 2,
  "transform-text": 3,
  "extract-metadata": 3,
  "web-scrape": 5,
  "extract-page": 5,
  "search-web": 5,
  "web-search": 14,
  "rss-parse": 4,
  "ip-lookup": 2,
  "whois-lookup": 3,
  "email-verify": 3,
  "phone-validate": 2,
  "currency-convert": 2,
  "timezone-convert": 1,
  "generate-uuid": 1,
  "diff-text": 2,
  "readability-score": 2,
  "language-detect": 3,
  "sentiment-analysis": 8,
  "summarize": 10,
  "extract-entities": 8,
  "regex-generate": 8,
  "pii-detect": 10,
  "ai-generate": 20,
  "ocr-extract": 12,
  "browser-task": 10,
  "screenshot-capture": 10,
  "html-to-markdown": 3,
  "url-shorten": 1,
  "webhook-send": 2,
  "jsonpath-query": 1,
  "barcode-generate": 2,
  "image-generate": 30,
  "workflow-agent": 25,
  "crypto-price": 1,
  "crypto-ohlcv": 2,
  "crypto-market-cap": 1,
  "crypto-fear-greed": 1,
  "crypto-sentiment": 2,
  "crypto-news": 2,
  "token-lookup": 1,
  "text-to-speech": 25,
  "transcribe-audio": 25,
  "email-send": 3,
  "design-create": 50,
  "domain-check": 2,
  "extract-pdf": 6,
  "ai-oracle": 25,
  "session-create": 5,
  "session-message": 20,
  "news-search": 12,
  "research-report": 40,
  "fact-check": 14,
  "video-generate": 700,
  "image-remove-bg": 350,
  "email-find": 110,
  "semantic-search": 8,
};

const FALLBACK_TOOLS = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
  name,
  description,
  credits: FALLBACK_CREDITS[name] ?? 5,
  category: ["ai-generate","ocr-extract","sentiment-analysis","summarize","extract-entities","regex-generate","pii-detect","web-search","language-detect","ai-oracle","session-create","session-message","research-report","fact-check","semantic-search","workflow-agent"].includes(name) ? "ai" : ["web-scrape","search-web","extract-page","browser-task","rss-parse","news-search"].includes(name) ? "web" : ["video-generate","design-create","image-remove-bg","text-to-speech","transcribe-audio","image-generate","generate-image"].includes(name) ? "media" : ["email-send","email-find"].includes(name) ? "communication" : ["crypto-price","crypto-market-cap","crypto-ohlcv","crypto-sentiment","crypto-news","crypto-fear-greed","token-lookup"].includes(name) ? "crypto" : "utility",
  active: true,
  endpoint: `/v1/tools/${name}`,
  method: "POST",
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [],
}));

export default router;
