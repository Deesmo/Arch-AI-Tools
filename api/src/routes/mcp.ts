/**
 * Native MCP endpoint on the main API (archtools.dev/mcp).
 *
 * WHY THIS EXISTS: the site advertises archtools.dev/mcp but it 404'd — the real
 * MCP server was only on the separate arch-tools-mcp.onrender.com service, which
 * does no OAuth. This handler makes archtools.dev/mcp a real, OAuth-capable remote
 * MCP endpoint for one-click Claude / ChatGPT / Grok connectors.
 *
 * HOW IT STAYS SAFE: it does NOT reimplement auth, scope, or billing. Tool calls
 * are forwarded over localhost to the existing /v1/tools/:name endpoints, which
 * already run the full chain (x402 → requireAuth [accepts at_oauth_ tokens] →
 * requireExecuteScope → deductCredits). The caller's Authorization / x-api-key
 * header is forwarded VERBATIM; the platform ARCH_API_KEY is NEVER injected (that
 * would drain the platform account). The payment code paths are untouched.
 *
 * ONE-CLICK OAUTH: on a tools/call with no credential, this returns HTTP 401 +
 * WWW-Authenticate pointing at the RFC 9728 protected-resource metadata (served by
 * routes/discovery.ts). Per the MCP authorization spec (modelcontextprotocol.io/
 * specification/2025-06-18/basic/authorization) that triggers the client's OAuth
 * flow against archtools.dev's /oauth server. Every tool call requires a credential
 * — /v1/tools independently enforces payment/auth on all tools (a no-credential
 * call returns 402), so this never grants free execution; failing closed here just
 * makes the OAuth handshake trigger cleanly instead of surfacing a 402.
 */
import { Router, Request, Response } from "express";
import { config } from "../config.js";

const router = Router();

const INTERNAL_BASE = `http://127.0.0.1:${process.env.PORT ?? config.port}`;
const PUBLIC_BASE = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
const RESOURCE_METADATA_URL = `${PUBLIC_BASE}/.well-known/oauth-protected-resource`;
const PROTOCOL_VERSION = "2025-06-18";

function callerCredential(req: Request): string {
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string" && xKey.trim()) return xKey.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const k = auth.slice(7).trim();
    if (k) return k;
  }
  return "";
}

// Forward the caller's own credential ONLY — never the platform key.
function forwardAuthHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const cred = callerCredential(req);
  if (cred) h["Authorization"] = `Bearer ${cred}`;
  return h;
}

type ToolDef = { name: string; description?: string; schemaJson?: unknown; credits?: number };
async function fetchTools(): Promise<ToolDef[]> {
  const r = await fetch(`${INTERNAL_BASE}/v1/tools`);
  if (!r.ok) throw new Error(`tools list ${r.status}`);
  const d = (await r.json()) as { tools?: ToolDef[] };
  return d.tools ?? [];
}

function toolEntry(t: ToolDef) {
  return {
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.schemaJson as Record<string, unknown>) ?? { type: "object", properties: {}, additionalProperties: true },
  };
}

// RFC 9728 §5.1 WWW-Authenticate response — tells the MCP client where to find the
// protected-resource metadata so it can start the OAuth flow.
function send401(res: Response, id: unknown): void {
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="tools:read tools:execute"`);
  res.status(401).json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32001, message: "Authorization required. Connect your Arch Tools account to use this tool." },
  });
}

async function handleRpc(req: Request, res: Response): Promise<void> {
  const body = req.body as any;
  if (!body || body.jsonrpc !== "2.0") {
    res.status(400).json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
    return;
  }

  try {
    switch (body.method) {
      case "initialize": {
        // Echo the client's requested protocol version when present (negotiation).
        const clientVer = body.params?.protocolVersion;
        res.json({ jsonrpc: "2.0", id: body.id, result: {
          protocolVersion: typeof clientVer === "string" ? clientVer : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: "arch-tools", version: "2.0.0" },
        }});
        return;
      }
      case "notifications/initialized":
        res.status(202).end();
        return;
      case "ping":
        res.json({ jsonrpc: "2.0", id: body.id, result: {} });
        return;
      case "tools/list": {
        const tools = await fetchTools();
        res.json({ jsonrpc: "2.0", id: body.id, result: { tools: tools.map(toolEntry) } });
        return;
      }
      case "tools/call": {
        const name = body.params?.name;
        const args = body.params?.arguments ?? body.params?.input ?? {};
        const cred = callerCredential(req);
        // No credential → trigger the OAuth handshake. /v1/tools enforces
        // payment/auth on every tool regardless, so this can't grant free calls.
        if (!cred) { send401(res, body.id); return; }
        const upstream = await fetch(`${INTERNAL_BASE}/v1/tools/${encodeURIComponent(name)}`, {
          method: "POST",
          headers: forwardAuthHeaders(req),
          body: JSON.stringify(args),
        });
        // Propagate a real auth failure from the tool endpoint as an MCP 401 so the
        // client re-runs OAuth (e.g. an expired at_oauth_ token).
        if (upstream.status === 401) { send401(res, body.id); return; }
        const text = await upstream.text();
        res.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }], isError: !upstream.ok } });
        return;
      }
      default:
        res.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
    }
  } catch (err: any) {
    res.status(500).json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32000, message: err?.message || "Internal error" } });
  }
}

// Streamable-HTTP (modern clients): POST /mcp with a JSON-RPC body.
router.post("/", handleRpc);
// Legacy SSE alias.
router.post("/sse", handleRpc);
router.post("/messages", handleRpc);

// GET /mcp — a bare probe; return 200 so discovery/health checks pass. Real work
// is POST. (No auth here: connectors probe this before authenticating.)
router.get("/", (_req: Request, res: Response): void => {
  res.json({ ok: true, service: "arch-tools-mcp", protocolVersion: PROTOCOL_VERSION, transport: "streamable-http", endpoint: `${PUBLIC_BASE}/mcp` });
});

router.options("/", (_req: Request, res: Response): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, MCP-Protocol-Version");
  res.status(204).end();
});

export default router;
