import "dotenv/config";
import fetch from "node-fetch";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
async function main() {
    const server = await createServer();
    if (transport === "sse") {
        const app = express();
        app.use(express.json());
        const transports = new Map();
        app.get("/sse", async (req, res) => {
            const sseTransport = new SSEServerTransport("/messages", res);
            transports.set(sseTransport.sessionId, sseTransport);
            res.on("close", () => transports.delete(sseTransport.sessionId));
            await server.connect(sseTransport);
        });
        // /mcp is an alias for /sse — for Claude Desktop, Cursor, and other MCP clients
        app.get("/mcp", async (req, res) => {
            const sseTransport = new SSEServerTransport("/messages", res);
            transports.set(sseTransport.sessionId, sseTransport);
            res.on("close", () => transports.delete(sseTransport.sessionId));
            await server.connect(sseTransport);
        });
        app.post("/messages", async (req, res) => {
            const sessionId = req.query.sessionId;
            const sseTransport = transports.get(sessionId);
            if (!sseTransport) {
                res.status(400).json({ error: "Session not found" });
                return;
            }
            await sseTransport.handlePostMessage(req, res);
        });
        // Rich health check — includes session count and transport info
        // Smithery server-card — allows scan-free listing
        app.get("/.well-known/mcp/server-card.json", (_req, res) => {
            res.json({
                name: "Arch Tools",
                description: "50 production-ready API tools for AI agents: web scraping, AI generation (Claude/GPT-4/Grok/Gemini), OCR, image generation (DALL-E 3), audio transcription, text-to-speech, crypto data, email, domain check, and more. Pay via Stripe credits or autonomous x402 USDC.",
                version: "1.7.0",
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
                transport: "sse",
                endpoints: {
                    sse: "/sse",
                    messages: "/messages"
                }
            });
        });
        // Streamable HTTP transport — used by Smithery and modern MCP clients (POST-based)
        // Inject Accept header if missing — some clients (Smithery) omit it
        // GET /mcp — server-initiated events stream (required by Streamable HTTP spec)
        app.get("/mcp", (req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("Access-Control-Allow-Origin", "*");
            // Send endpoint event so client knows where to POST
            res.write(`event: endpoint\ndata: /mcp\n\n`);
            req.on("close", () => res.end());
        });
        // Streamable HTTP endpoint — custom implementation bypassing SDK transport Accept header check
        // Handles initialize, tools/list, tools/call for Smithery + modern MCP clients
        app.post("/mcp", async (req, res) => {
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
                                capabilities: { tools: { listChanged: false } },
                                serverInfo: { name: "arch-tools-mcp", version: "1.7.0" }
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
                                    inputSchema: t.inputSchema ?? { type: "object", properties: {}, additionalProperties: true }
                                }))
                            } });
                        break;
                    }
                    case "tools/call": {
                        const result = await invokeTool(body.params?.name, body.params?.arguments ?? body.params?.input ?? {});
                        send({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: result }] } });
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
        });
        app.options("/mcp", (_req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
            res.status(204).end();
        });
        app.get("/health", (_req, res) => res.json({ ok: true, service: "arch-tools-mcp", transport: "sse+streamable", sessions: transports.size }));
        app.listen(ssePort, () => {
            console.log(`MCP SSE server running on port ${ssePort}`);
        });
    }
    else {
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);
    }
}
main().catch(console.error);
//# sourceMappingURL=index.js.map