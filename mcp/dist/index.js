import "dotenv/config";
import fetch from "node-fetch";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOL_SCHEMAS } from "./schemas.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
const baseUrl = (process.env.ARCH_API_BASE_URL || "https://archtools.dev").replace(/\/$/, "");
const apiKey = process.env.ARCH_API_KEY || "";
const transport = process.env.MCP_TRANSPORT || "stdio"; // "stdio" or "sse"
// Render-safe: prefer PORT when running as a web service
const ssePort = Number(process.env.PORT || process.env.MCP_SSE_PORT || 3001);
if (!apiKey)
    throw new Error("Missing ARCH_API_KEY");
let toolCache = null;
async function getTools() {
    if (toolCache)
        return toolCache;
    const res = await fetch(`${baseUrl}/v1/tools`, {
        headers: { "x-api-key": apiKey },
    });
    if (!res.ok)
        throw new Error(`Failed to fetch tools: ${res.status}`);
    const data = (await res.json());
    toolCache = data.tools;
    return toolCache;
}
async function invokeTool(toolName, input) {
    const res = await fetch(`${baseUrl}/v1/tools/${toolName}`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Tool error: ${res.status}`);
    }
    const out = await res.json();
    return JSON.stringify(out, null, 2);
}
async function createServer() {
    const server = new McpServer({
        name: "arch-tools-mcp",
        version: "1.0.0",
    });
    const tools = await getTools();
    for (const t of tools) {
        server.tool(t.name, t.description, { input: z.any().optional() }, async ({ input }) => {
            const out = await invokeTool(t.name, input);
            return { content: [{ type: "text", text: out }] };
        });
    }
    return server;
}
// ─── Streamable HTTP POST handler (shared by /mcp and /sse POST) ─────────────
// mcp-remote and modern clients try POST first; this handles the JSON-RPC layer
// directly without the SDK transport so we control the Accept header behaviour.
async function handleStreamablePost(req, res) {
    const body = req.body;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const send = (data) => res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
    if (!body || body.jsonrpc !== "2.0") {
        send({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
        res.end();
        return;
    }
    try {
        switch (body.method) {
            case "initialize":
                send({ jsonrpc: "2.0", id: body.id, result: {
                        protocolVersion: "2024-11-05",
                        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
                        serverInfo: { name: "arch-tools-mcp", version: "1.8.0" }
                    } });
                break;
            case "notifications/initialized":
                // No response needed — just ack
                break;
            case "tools/list": {
                const tools = await getTools();
                send({ jsonrpc: "2.0", id: body.id, result: {
                        tools: tools.map((t) => ({
                            name: t.name,
                            description: t.description,
                            inputSchema: TOOL_SCHEMAS[t.name] ?? t.inputSchema ?? {
                                type: "object",
                                properties: {},
                                additionalProperties: true
                            },
                            annotations: {
                                readOnlyHint: !["send-email", "generate-image", "text-to-speech", "browser-task", "transcribe-audio", "image-generate", "webhook-send"].includes(t.name),
                                destructiveHint: false,
                                idempotentHint: true,
                                openWorldHint: ["web-scrape", "web-search", "search-web", "rss-parse", "crypto-price", "crypto-news", "crypto-market-cap", "crypto-fear-greed", "crypto-ohlcv", "crypto-sentiment", "whois-lookup", "check-domain", "extract-metadata", "extract-page"].includes(t.name)
                            }
                        }))
                    } });
                break;
            }
            case "tools/call": {
                const result = await invokeTool(body.params?.name, body.params?.arguments ?? body.params?.input ?? {});
                send({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: result }] } });
                break;
            }
            case "resources/list":
                send({ jsonrpc: "2.0", id: body.id, result: { resources: [
                            {
                                uri: "arch://tools/catalog",
                                name: "Arch AI Tools Catalog",
                                description: "Complete catalog of all 53 available Arch AI Tools with descriptions, categories, and credit costs",
                                mimeType: "application/json"
                            },
                            {
                                uri: "arch://docs/quickstart",
                                name: "Quick Start Guide",
                                description: "Getting started guide for the Arch AI Tools MCP server — authentication, usage, and examples",
                                mimeType: "text/markdown"
                            }
                        ] } });
                break;
            case "resources/read": {
                const uri = body.params?.uri;
                if (uri === "arch://tools/catalog") {
                    try {
                        const toolsRes = await fetch(`${baseUrl}/v1/tools`, { headers: { "x-api-key": apiKey } });
                        const toolsData = await toolsRes.json();
                        send({ jsonrpc: "2.0", id: body.id, result: { contents: [{
                                        uri, mimeType: "application/json",
                                        text: JSON.stringify(toolsData, null, 2)
                                    }] } });
                    }
                    catch (e) {
                        send({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: e?.message || "Failed to fetch catalog" } });
                    }
                }
                else if (uri === "arch://docs/quickstart") {
                    send({ jsonrpc: "2.0", id: body.id, result: { contents: [{
                                    uri, mimeType: "text/markdown",
                                    text: `# Arch AI Tools — Quick Start\n\nConnect to 53 powerful AI tools via MCP.\n\n## Authentication\nAll tools require an \`x-api-key\` header with your Arch API key.\nGet a free key at: https://archtools.dev/signup\n\n## Usage Example\n\`\`\`json\n{\n  "tool": "search-web",\n  "input": { "query": "latest AI news" }\n}\n\`\`\`\n\n## Tool Categories\n- **AI**: ai-generate, summarize, sentiment-analysis, web-search, research-report, fact-check\n- **Search**: search-web, news-search, rss-parse\n- **Crypto**: crypto-price, crypto-market-cap, crypto-fear-greed, crypto-ohlcv\n- **Web**: web-scrape, extract-page, screenshot-capture, whois-lookup\n- **Utilities**: generate-uuid, generate-hash, qr-code, url-shorten, timezone-convert\n\nFull documentation: https://archtools.dev/docs`
                                }] } });
                }
                else {
                    send({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Resource not found" } });
                }
                break;
            }
            case "prompts/list":
                send({ jsonrpc: "2.0", id: body.id, result: { prompts: [
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
                        ] } });
                break;
            case "prompts/get": {
                const promptName = body.params?.name;
                const promptArgs = body.params?.arguments || {};
                if (promptName === "research-topic") {
                    const topic = promptArgs.topic || "[topic]";
                    const depth = promptArgs.depth || "standard";
                    send({ jsonrpc: "2.0", id: body.id, result: { description: "Research prompt", messages: [{
                                    role: "user", content: { type: "text", text: `Please research the following topic using the research-report tool and provide a comprehensive report:\n\nTopic: ${topic}\nDepth: ${depth}\n\nUse the research-report tool with query="${topic}" and depth="${depth}".` }
                                }] } });
                }
                else if (promptName === "fact-check-claim") {
                    const claim = promptArgs.claim || "[claim]";
                    send({ jsonrpc: "2.0", id: body.id, result: { description: "Fact-check prompt", messages: [{
                                    role: "user", content: { type: "text", text: `Please fact-check the following claim using the fact-check tool:\n\nClaim: "${claim}"\n\nUse the fact-check tool and provide the verdict, confidence score, and key evidence.` }
                                }] } });
                }
                else if (promptName === "analyze-url") {
                    const url = promptArgs.url || "[url]";
                    send({ jsonrpc: "2.0", id: body.id, result: { description: "URL analysis prompt", messages: [{
                                    role: "user", content: { type: "text", text: `Please perform a comprehensive analysis of this URL: ${url}\n\n1. Use extract-page to get the main content\n2. Use extract-metadata to get title, description, OG tags\n3. Use screenshot-capture to capture a visual\n4. Summarize what you found.` }
                                }] } });
                }
                else {
                    send({ jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Prompt not found" } });
                }
                break;
            }
            default:
                send({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
        }
    }
    catch (err) {
        send({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32000, message: err?.message || "Internal error" } });
    }
    res.end();
}
async function main() {
    if (transport === "sse") {
        const app = express();
        app.use(express.json());
        // Per-session store — each SSE connection gets its OWN McpServer instance.
        // Reusing a single server across connections causes the SDK to confuse
        // transports and return 502 errors to real clients.
        const transports = new Map();
        // ─── SSE transport (legacy / Claude Desktop / Cursor / mcp-remote) ────────
        // GET /sse — opens the SSE stream; sends endpoint event so the client knows
        // where to POST messages.  Each connection gets a fresh McpServer instance.
        app.get("/sse", async (_req, res) => {
            const sessionServer = await createServer();
            const sseTransport = new SSEServerTransport("/messages", res);
            transports.set(sseTransport.sessionId, { transport: sseTransport, server: sessionServer });
            res.on("close", () => transports.delete(sseTransport.sessionId));
            await sessionServer.connect(sseTransport);
        });
        // POST /sse — mcp-remote tries POST first before falling back to GET/SSE.
        // Handle it as Streamable HTTP so mcp-remote works without any fallback dance.
        app.post("/sse", handleStreamablePost);
        // POST /messages — receives JSON-RPC from SSE clients
        app.post("/messages", async (req, res) => {
            const sessionId = req.query.sessionId;
            const session = transports.get(sessionId);
            if (!session) {
                res.status(400).json({ error: "Session not found" });
                return;
            }
            await session.transport.handlePostMessage(req, res);
        });
        // ─── Streamable HTTP transport (Smithery + modern MCP clients) ────────────
        // GET /mcp — server-initiated events stream required by Streamable HTTP spec.
        // NOTE: only ONE app.get("/mcp") is registered here — the previous codebase
        // had a duplicate that shadowed this handler entirely.
        app.get("/mcp", (req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("Access-Control-Allow-Origin", "*");
            // Send endpoint event so the client knows where to POST
            res.write(`event: endpoint\ndata: /mcp\n\n`);
            req.on("close", () => res.end());
        });
        // POST /mcp — Streamable HTTP endpoint; handles initialize / tools/list / tools/call
        app.post("/mcp", handleStreamablePost);
        app.options("/mcp", (_req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
            res.status(204).end();
        });
        // ─── Discovery / meta endpoints ──────────────────────────────────────────
        // Smithery server-card — allows scan-free listing
        app.get("/.well-known/mcp/server-card.json", (_req, res) => {
            res.json({
                name: "Arch Tools",
                description: "50 production-ready API tools for AI agents: web scraping, AI generation (Claude/GPT-4/Grok/Gemini), OCR, image generation (DALL-E 3), audio transcription, text-to-speech, crypto data, email, domain check, and more. Pay via Stripe credits or autonomous x402 USDC.",
                version: "1.8.0",
                homepage: "https://archtools.dev",
                repository: "https://github.com/Deesmo/Arch-AI-Tools",
                auth: {
                    type: "api_key",
                    paramName: "ARCH_API_KEY",
                    in: "header",
                    headerName: "x-api-key",
                    signupUrl: "https://archtools.dev/signup"
                },
                tools_count: 50,
                transport: "sse+streamable",
                endpoints: {
                    sse: "/sse",
                    messages: "/messages",
                    mcp: "/mcp"
                }
            });
        });
        // Rich health check — includes session count and transport info
        app.get("/health", (_req, res) => res.json({ ok: true, service: "arch-tools-mcp", transport: "sse+streamable", sessions: transports.size }));
        app.listen(ssePort, () => {
            console.log(`MCP SSE server running on port ${ssePort}`);
        });
    }
    else {
        // stdio transport — used by npx / Claude Desktop config
        const server = await createServer();
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);
    }
}
main().catch(console.error);
//# sourceMappingURL=index.js.map