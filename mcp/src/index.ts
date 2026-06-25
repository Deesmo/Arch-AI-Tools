import "dotenv/config";
import fetch from "node-fetch";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_SCHEMAS } from "./schemas.js";
import express from "express";

const baseUrl = (process.env.ARCH_API_BASE_URL || "https://archtools.dev").replace(/\/$/, "");
const apiKey = process.env.ARCH_API_KEY || "";

// ─── Anonymous demo limits ───────────────────────────────────────────────────
// Anonymous (no client API key) tool calls are served from a small internal
// demo pool and are hard-capped. Real usage requires the caller's own Arch
// Tools API key via `x-api-key` or `Authorization: Bearer` header.
const ANON_DAILY_LIMIT_PER_IP = Number(process.env.MCP_ANON_DAILY_LIMIT_PER_IP || 5);
const ANON_DAILY_LIMIT_GLOBAL = Number(process.env.MCP_ANON_DAILY_LIMIT_GLOBAL || 50);

const anonUsage = new Map<string, number>();
let anonGlobalCount = 0;
let anonUsageDay = "";

function checkAnonAllowance(ip: string): { allowed: boolean; reason?: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== anonUsageDay) {
    anonUsage.clear();
    anonGlobalCount = 0;
    anonUsageDay = today;
  }
  if (anonGlobalCount >= ANON_DAILY_LIMIT_GLOBAL) {
    return { allowed: false, reason: "Anonymous demo pool exhausted for today." };
  }
  const used = anonUsage.get(ip) || 0;
  if (used >= ANON_DAILY_LIMIT_PER_IP) {
    return { allowed: false, reason: `Anonymous demo limit reached (${ANON_DAILY_LIMIT_PER_IP} calls/day).` };
  }
  anonUsage.set(ip, used + 1);
  anonGlobalCount++;
  return { allowed: true };
}

const AUTH_REQUIRED_MESSAGE = JSON.stringify({
  error: "api_key_required",
  message: "Anonymous demo limit reached. Pass your Arch Tools API key via the `x-api-key` header (or `Authorization: Bearer <key>`) to continue. Get a free key with signup credits at https://archtools.dev/signup",
  signup: "https://archtools.dev/signup",
  docs: "https://archtools.dev/docs",
}, null, 2);

// Anonymous demo (no client key) may ONLY call cheap, local-compute tools that
// do not hit paid upstream providers. Anything else requires the caller's own
// API key — this prevents draining the platform ARCH_API_KEY on expensive
// AI/media/search calls via IP rotation (H6).
const ANON_ALLOWED_TOOLS = new Set<string>([
  "generate-hash", "generate-uuid", "qr-code", "barcode-generate",
  "transform-text", "diff-text", "validate-data", "convert-format",
  "jsonpath-query", "timezone-convert", "language-detect", "readability-score",
]);

const ANON_TOOL_BLOCKED_MESSAGE = JSON.stringify({
  error: "api_key_required",
  message: "This tool requires your own Arch Tools API key. Anonymous demo access is limited to free local utilities. Pass `x-api-key` or `Authorization: Bearer <key>`. Get a free key with signup credits at https://archtools.dev/signup",
  signup: "https://archtools.dev/signup",
  docs: "https://archtools.dev/docs",
}, null, 2);

function extractClientKey(req: express.Request): string {
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string" && xKey.trim()) return xKey.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const k = auth.slice(7).trim();
    if (k) return k;
  }
  return "";
}

function clientIp(req: express.Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
const transport = process.env.MCP_TRANSPORT || "stdio"; // "stdio" or "sse"
// Render-safe: prefer PORT when running as a web service
const ssePort = Number(process.env.PORT || process.env.MCP_SSE_PORT || 3001);

// API key validated at runtime in createServer(), not at module load
// This allows Smithery sandbox scanning without credentials

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

let toolCache: ToolDef[] | null = null;
async function getTools(): Promise<ToolDef[]> {
  if (toolCache) return toolCache;
  const res = await fetch(`${baseUrl}/v1/tools`, {
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`Failed to fetch tools: ${res.status}`);
  const data = (await res.json()) as { tools: ToolDef[] };
  toolCache = data.tools;
  return toolCache;
}

async function invokeTool(toolName: string, input: any, keyOverride?: string) {
  const res = await fetch(`${baseUrl}/v1/tools/${toolName}`, {
    method: "POST",
    headers: { "x-api-key": keyOverride || apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error?.message || `Tool error: ${res.status}`);
  }
  const out = await res.json();
  return JSON.stringify(out, null, 2);
}

// ─── Annotation helpers ──────────────────────────────────────────────────────
const WRITE_TOOLS = new Set([
  "send-email", "email-send", "generate-image", "text-to-speech", "browser-task",
  "transcribe-audio", "image-generate", "webhook-send", "design-create",
  "social-post", "video-generate", "image-remove-bg", "session-create", "session-message"
]);
const OPEN_WORLD_TOOLS = new Set([
  "web-scrape", "web-search", "search-web", "rss-parse",
  "crypto-price", "crypto-news", "crypto-market-cap", "crypto-fear-greed",
  "crypto-ohlcv", "crypto-sentiment", "whois-lookup", "check-domain",
  "extract-metadata", "extract-page", "domain-check", "news-search",
  "semantic-search", "email-find", "research-report", "fact-check"
]);

function buildToolEntry(t: ToolDef) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: TOOL_SCHEMAS[t.name] ?? t.inputSchema ?? {
      type: "object" as const,
      properties: {},
      additionalProperties: true
    },
    annotations: {
      readOnlyHint: !WRITE_TOOLS.has(t.name),
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: OPEN_WORLD_TOOLS.has(t.name)
    }
  };
}

// ─── Resources data ──────────────────────────────────────────────────────────
const RESOURCES = [
  {
    uri: "arch://tools/catalog",
    name: "Arch AI Tools Catalog",
    description: "Complete catalog of all 64 available Arch AI Tools with descriptions, categories, and credit costs",
    mimeType: "application/json"
  },
  {
    uri: "arch://docs/quickstart",
    name: "Quick Start Guide",
    description: "Getting started guide for the Arch AI Tools MCP server — authentication, usage, and examples",
    mimeType: "text/markdown"
  }
];

const QUICKSTART_MD = `# Arch AI Tools — Quick Start

Connect to 64 powerful AI tools via MCP.

## Authentication
All tools require an \`x-api-key\` header with your Arch API key.
Get a free key at: https://archtools.dev/signup

## Usage Example
\`\`\`json
{
  "tool": "search-web",
  "input": { "query": "latest AI news" }
}
\`\`\`

## Tool Categories
- **AI**: ai-generate, summarize, sentiment-analysis, web-search, research-report, fact-check
- **Search**: search-web, news-search, rss-parse
- **Crypto**: crypto-price, crypto-market-cap, crypto-fear-greed, crypto-ohlcv
- **Web**: web-scrape, extract-page, screenshot-capture, whois-lookup
- **Utilities**: generate-uuid, generate-hash, qr-code, url-shorten, timezone-convert

Full documentation: https://archtools.dev/docs`;

// ─── Prompts data ────────────────────────────────────────────────────────────
const PROMPTS = [
  {
    name: "research-topic",
    description: "Deep research on any topic — searches multiple sources and synthesizes a structured report with citations",
    arguments: [
      { name: "topic", description: "The topic or question to research", required: true },
      { name: "depth", description: "Research depth: 'standard' or 'deep'", required: false }
    ]
  },
  {
    name: "fact-check-claim",
    description: "Verify whether a claim is true, false, mixed, or unverified — returns verdict with confidence score and evidence",
    arguments: [
      { name: "claim", description: "The claim or statement to fact-check", required: true }
    ]
  },
  {
    name: "analyze-url",
    description: "Comprehensive analysis of a URL — extracts content, metadata, takes screenshot, and summarizes",
    arguments: [
      { name: "url", description: "The URL to analyze", required: true }
    ]
  }
];

function getPromptMessages(name: string, args: Record<string, string>) {
  switch (name) {
    case "research-topic": {
      const topic = args.topic || "[topic]";
      const depth = args.depth || "standard";
      return { description: "Research prompt", messages: [{ role: "user", content: { type: "text", text: `Please research the following topic using the research-report tool and provide a comprehensive report:\n\nTopic: ${topic}\nDepth: ${depth}\n\nUse the research-report tool with query="${topic}" and depth="${depth}".` } }] };
    }
    case "fact-check-claim": {
      const claim = args.claim || "[claim]";
      return { description: "Fact-check prompt", messages: [{ role: "user", content: { type: "text", text: `Please fact-check the following claim using the fact-check tool:\n\nClaim: "${claim}"\n\nUse the fact-check tool and provide the verdict, confidence score, and key evidence.` } }] };
    }
    case "analyze-url": {
      const url = args.url || "[url]";
      return { description: "URL analysis prompt", messages: [{ role: "user", content: { type: "text", text: `Please perform a comprehensive analysis of this URL: ${url}\n\n1. Use extract-page to get the main content\n2. Use extract-metadata to get title, description, OG tags\n3. Use screenshot-capture to capture a visual\n4. Summarize what you found.` } }] };
    }
    default:
      throw new Error("Prompt not found");
  }
}

// ─── Server factory (low-level Server for full schema control) ───────────────
// auth: per-session client API key (empty = anonymous demo) + IP for rate limiting.
async function createServer(auth?: { clientKey: string; ip: string }): Promise<Server> {
  const server = new Server(
    { name: "arch-tools-mcp", version: "1.8.0" },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
    }
  );

  const tools = await getTools();

  // tools/list — returns full inputSchema with required + annotations
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(buildToolEntry)
  }));

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // SSE sessions: enforce auth/demo limits. stdio (auth undefined) uses env key as before.
    if (auth && !auth.clientKey) {
      if (!ANON_ALLOWED_TOOLS.has(request.params.name)) {
        return { content: [{ type: "text" as const, text: ANON_TOOL_BLOCKED_MESSAGE }], isError: true };
      }
      const allowance = checkAnonAllowance(auth.ip);
      if (!allowance.allowed) {
        return { content: [{ type: "text" as const, text: AUTH_REQUIRED_MESSAGE }], isError: true };
      }
    }
    const result = await invokeTool(
      request.params.name,
      request.params.arguments ?? {},
      auth?.clientKey || undefined
    );
    return { content: [{ type: "text" as const, text: result }] };
  });

  // resources/list
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES
  }));

  // resources/read
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "arch://tools/catalog") {
      const toolsRes = await fetch(`${baseUrl}/v1/tools`, { headers: { "x-api-key": apiKey } });
      const toolsData = await toolsRes.json();
      return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(toolsData, null, 2) }] };
    }
    if (uri === "arch://docs/quickstart") {
      return { contents: [{ uri, mimeType: "text/markdown", text: QUICKSTART_MD }] };
    }
    throw new Error("Resource not found");
  });

  // prompts/list
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS
  }));

  // prompts/get
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return getPromptMessages(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, string>
    );
  });

  return server;
}

// ─── Streamable HTTP POST handler (shared by /mcp and /sse POST) ─────────────
async function handleStreamablePost(req: express.Request, res: express.Response): Promise<void> {
  const body = req.body as any;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const send = (data: object) => res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);

  if (!body || body.jsonrpc !== "2.0") {
    send({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
    res.end(); return;
  }

  try {
    const tools = await getTools();

    switch (body.method) {
      case "initialize":
        send({ jsonrpc: "2.0", id: body.id, result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: "arch-tools-mcp", version: "1.8.0" }
        }});
        break;

      case "notifications/initialized":
        break;

      case "tools/list":
        send({ jsonrpc: "2.0", id: body.id, result: {
          tools: tools.map(buildToolEntry)
        }});
        break;

      case "tools/call": {
        const clientKey = extractClientKey(req);
        if (!clientKey) {
          if (!ANON_ALLOWED_TOOLS.has(body.params?.name)) {
            send({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: ANON_TOOL_BLOCKED_MESSAGE }], isError: true } });
            break;
          }
          const allowance = checkAnonAllowance(clientIp(req));
          if (!allowance.allowed) {
            send({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: AUTH_REQUIRED_MESSAGE }], isError: true } });
            break;
          }
        }
        const result = await invokeTool(body.params?.name, body.params?.arguments ?? body.params?.input ?? {}, clientKey || undefined);
        send({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: result }] } });
        break;
      }

      case "resources/list":
        send({ jsonrpc: "2.0", id: body.id, result: { resources: RESOURCES } });
        break;

      case "resources/read": {
        const uri = (body.params as any)?.uri;
        if (uri === "arch://tools/catalog") {
          const toolsRes = await fetch(`${baseUrl}/v1/tools`, { headers: { "x-api-key": apiKey } });
          const toolsData = await toolsRes.json();
          send({ jsonrpc: "2.0", id: body.id, result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(toolsData, null, 2) }] } });
        } else if (uri === "arch://docs/quickstart") {
          send({ jsonrpc: "2.0", id: body.id, result: { contents: [{ uri, mimeType: "text/markdown", text: QUICKSTART_MD }] } });
        } else {
          send({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Resource not found" } });
        }
        break;
      }

      case "prompts/list":
        send({ jsonrpc: "2.0", id: body.id, result: { prompts: PROMPTS } });
        break;

      case "prompts/get": {
        const promptName = (body.params as any)?.name;
        const promptArgs = (body.params as any)?.arguments || {};
        try {
          const result = getPromptMessages(promptName, promptArgs);
          send({ jsonrpc: "2.0", id: body.id, result });
        } catch {
          send({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Prompt not found" } });
        }
        break;
      }

      default:
        send({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
    }
  } catch (err: any) {
    send({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32000, message: err?.message || "Internal error" } });
  }

  res.end();
}

async function main() {
  if (transport === "sse") {
    const app = express();
    app.use(express.json());

    // Per-session store — each SSE connection gets its OWN Server instance.
    const transports = new Map<string, { transport: SSEServerTransport; server: Server }>();

    // ─── SSE transport (legacy / Claude Desktop / Cursor / mcp-remote) ────────

    app.get("/sse", async (req, res) => {
      const sessionServer = await createServer({ clientKey: extractClientKey(req), ip: clientIp(req) });
      const sseTransport = new SSEServerTransport("/messages", res);
      transports.set(sseTransport.sessionId, { transport: sseTransport, server: sessionServer });
      res.on("close", () => transports.delete(sseTransport.sessionId));
      await sessionServer.connect(sseTransport);
    });

    app.post("/sse", handleStreamablePost);

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const session = transports.get(sessionId);
      if (!session) {
        res.status(400).json({ error: "Session not found" });
        return;
      }
      await session.transport.handlePostMessage(req, res);
    });

    // ─── Streamable HTTP transport (Smithery + modern MCP clients) ────────────

    app.get("/mcp", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.write(`event: endpoint\ndata: /mcp\n\n`);
      res.end();
    });

    app.post("/mcp", handleStreamablePost);

    app.options("/mcp", (_req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
      res.status(204).end();
    });

    // ─── Discovery / meta endpoints ──────────────────────────────────────────

    app.get("/.well-known/mcp/server-card.json", async (_req, res) => {
      try {
        const tools = await getTools();
        res.json({
          serverInfo: {
            name: "arch-tools-mcp",
            version: "1.8.0",
            description: `${tools.length} production-ready API tools for AI agents: web scraping, AI generation (Claude/GPT-4/Grok/Gemini), OCR, image generation (DALL-E 3), audio transcription, text-to-speech, crypto data, email, domain check, and more. Pay via Stripe credits or autonomous x402 USDC.`
          },
          authentication: {
            required: false,
            description: "Optional for a small daily demo allowance. For full access pass your Arch Tools API key via `x-api-key` or `Authorization: Bearer <key>`. Free key: https://archtools.dev/signup"
          },
          tools: tools.map(buildToolEntry),
          resources: RESOURCES,
          prompts: PROMPTS
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || "Failed to generate server card" });
      }
    });

    app.get("/health", (_req, res) =>
      res.json({ ok: true, service: "arch-tools-mcp", transport: "sse+streamable", sessions: transports.size })
    );

    app.listen(ssePort, () => {
      console.log(`MCP SSE server running on port ${ssePort}`);
    });
  } else {
    // stdio transport — used by npx / Claude Desktop config
    const server = await createServer();
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  }
}

main().catch(console.error);

// Smithery sandbox export — allows scanning without real credentials
export async function createSandboxServer() {
  // Set a dummy key so createServer doesn't fail during scan
  process.env.ARCH_API_KEY = process.env.ARCH_API_KEY || "sandbox_scan_key";
  return createServer();
}

// Default export for Smithery hosted deployment
export default async function(opts?: { config?: { apiKey?: string; baseUrl?: string }; session?: any; env?: any }) {
  if (opts?.config?.apiKey) process.env.ARCH_API_KEY = opts.config.apiKey;
  if (opts?.config?.baseUrl) process.env.ARCH_API_BASE_URL = opts.config.baseUrl;
  if (opts?.env?.ARCH_API_KEY) process.env.ARCH_API_KEY = opts.env.ARCH_API_KEY;
  return createServer();
}
