import { Router } from "express";
import Ajv from "ajv";
import { prisma } from "../db.js";
import { requireApiKey } from "../middleware/auth.js";
import { getCreditBalance, debitCredits } from "../middleware/credits.js";
import { planLimiter, planRateConfig } from "../lib/rateLimit.js";
import { setRateLimitPolicy } from "../lib/ratelimitPolicy.js";
import * as builtin from "../tools/builtin.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../lib/logger.js";
import { fail, ok } from "../lib/http.js";
import { sendLowCreditAlert, LOW_CREDIT_THRESHOLD } from "../services/email.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validatorCache = new Map<string, any>();
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS || 15000);

// ─── LRU cache for deterministic tools ───
// Pure functions where same input always yields same output.
// Cache eliminates DB round-trips in tight agentic loops.
const DETERMINISTIC_TOOLS = new Set([
  "generate-hash", "transform-text", "convert-format", "validate-data",
  "readability-score", "generate-uuid", "diff-text"
]);
const resultCache = new Map<string, { result: any; ts: number }>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

function getCached(key: string) {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { resultCache.delete(key); return null; }
  return entry.result;
}
function setCache(key: string, result: any) {
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest) resultCache.delete(oldest);
  }
  resultCache.set(key, { result, ts: Date.now() });
}

export const invokeRouter = Router();

async function handleInvoke(req: any, res: any, next: any, toolNameParam: string) {
  const toolName = String(toolNameParam || "").toLowerCase();
  const tool = await prisma.tool.findUnique({ where: { name: toolName } });
  if (!tool) return fail(req, res, 404, "tool_not_found");
  if (!tool.active) return fail(req, res, 410, "tool_disabled");

  // Web-scrape domain allowlist controls
  if (toolName === "web-scrape" || toolName === "extract-page" || toolName === "browser-task") {
    if (req.scrapeEnabled === false) {
      return fail(req, res, 403, "scrape_disabled", "Web scraping is disabled for this API key");
    }
    const allow = (req.allowedScrapeDomains || "").split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length) {
      const u = (req.body && req.body.url) ? String(req.body.url) : "";
      try {
        const host = new URL(u).hostname.toLowerCase();
        const allowed = allow.some((d: string) => host === d || host.endsWith("." + d));
        if (!allowed) return fail(req, res, 403, "scrape_domain_not_allowed", "Domain not allowed for this API key");
      } catch {
        return fail(req, res, 400, "invalid_url", "Invalid url");
      }
    }
  }

  // Schema validation
  if (tool.schemaJson && typeof tool.schemaJson === "object") {
    try {
      const cacheKey = `${toolName}:${tool.updatedAt.toISOString()}`;
      let validate = validatorCache.get(cacheKey);
      if (!validate) {
        validate = ajv.compile(tool.schemaJson as object);
        if (validatorCache.size > 250) validatorCache.clear();
        validatorCache.set(cacheKey, validate);
      }
      if (!validate(req.body)) {
        return fail(req, res, 400, "validation_failed", "Request body does not match tool input schema", { errors: validate.errors });
      }
    } catch (e: any) {
      logger.warn({ tool: toolName, error: e.message }, "Schema compilation failed — skipping validation");
    }
  }

  // Rate limit by plan
  const plan = (req.agentPlan || "free") as "free" | "pro" | "business";
  const cfg = planRateConfig(plan);
  setRateLimitPolicy(res, cfg.limit, cfg.windowMs);
  return planLimiter(plan)(req, res, async (err: any) => {
    if (err) return next(err);

    const agentId = req.agentId as string;
    const balanceBefore = await getCreditBalance(agentId);

    // Credit check
    if (balanceBefore < tool.credits) {
      return fail(req, res, 402, "insufficient_credits", undefined, {
        credits_required: tool.credits,
        credits_remaining: balanceBefore,
      });
    }

    // Daily cap check
    const cap = req.dailyCreditCap as number | null | undefined;
    if (cap && cap > 0) {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const spent = await prisma.ledgerEntry.aggregate({
        where: { agentId, kind: { in: ["debit", "reversal"] }, createdAt: { gte: start } },
        _sum: { credits: true },
      });
      const usedToday = spent._sum.credits || 0;
      if (usedToday + tool.credits > cap) {
        return fail(req, res, 429, "rate_limited", "Daily credit cap exceeded", {
          daily_cap: cap, credits_used_today: usedToday,
        });
      }
    }

    const requestId = (req as any).requestId || uuidv4();
    const startMs = Date.now();

    // Check LRU cache for deterministic tools
    let cacheHit = false;
    let result: any;
    if (DETERMINISTIC_TOOLS.has(toolName)) {
      const ck = `${toolName}:${JSON.stringify(req.body)}`;
      const cached = getCached(ck);
      if (cached) { result = cached; cacheHit = true; }
    }

    try {
      if (!cacheHit) {
        result = await withTimeout(dispatchTool(toolName, tool.endpoint, req.body), TOOL_TIMEOUT_MS, "tool_timeout");
        if (DETERMINISTIC_TOOLS.has(toolName)) {
          setCache(`${toolName}:${JSON.stringify(req.body)}`, result);
        }
      }

      const creditsUsed = cacheHit ? 0 : tool.credits;
      const creditsRemaining = Math.max(0, balanceBefore - creditsUsed);

      if (!cacheHit) {
        await debitCredits(agentId, toolName, tool.credits, requestId, {
          endpoint: tool.endpoint,
          latency_ms: Date.now() - startMs,
        });

        // Low credit alert — async, non-blocking
        if (creditsRemaining <= LOW_CREDIT_THRESHOLD && creditsRemaining >= 0) {
          prisma.agent.findUnique({ where: { id: agentId }, select: { email: true } }).then((agent) => {
            if (agent?.email) {
              sendLowCreditAlert(agent.email, creditsRemaining, agentId).catch(() => {});
            }
          }).catch(() => {});
        }
      }

            // DX headers for agents & dashboards
      res.setHeader("X-Credits-Used", String(creditsUsed));
      res.setHeader("X-Credits-Remaining", String(creditsRemaining));
      res.setHeader("X-Tool-Cache-Hit", cacheHit ? "1" : "0");

      const latencyMs = Date.now() - startMs;
      // Enterprise audit log (best-effort; never block the response)
      prisma.apiRequestLog.create({
        data: {
          agentId,
          apiKeyId: (req as any).apiKeyId || null,
          apiKeyPrefix: (req as any).apiKeyPrefix || null,
          toolName,
          endpoint: String(req.originalUrl || req.url || ""),
          method: String(req.method || "POST"),
          status: 200,
          latencyMs,
          creditsUsed,
          creditsRemaining,
          requestId,
          ip: String(req.ip || ""),
          userAgent: String(req.headers?.["user-agent"] || ""),
        },
      }).catch(() => {});

      return ok(res, {
        tool: toolName,
        request_id: requestId,
        credits_used: creditsUsed,
        credits_remaining: creditsRemaining,
        latency_ms: Date.now() - startMs,
        cache_hit: cacheHit,
        result,
      });
    } catch (e: any) {
      logger.error({ tool: toolName, requestId, error: e.message }, "Tool execution failed");
      const latencyMs = Date.now() - startMs;
      const ua = String(req.headers?.["user-agent"] || "");
      const ip = String(req.ip || "");

      if (String(e?.code || e?.message) === "tool_timeout") {
        prisma.apiRequestLog.create({
          data: {
            agentId: (req as any).agentId || null,
            apiKeyId: (req as any).apiKeyId || null,
            apiKeyPrefix: (req as any).apiKeyPrefix || null,
            toolName,
            endpoint: String(req.originalUrl || req.url || ""),
            method: String(req.method || "POST"),
            status: 504,
            latencyMs,
            requestId,
            ip,
            userAgent: ua,
            errorCode: "tool_timeout",
            errorMessage: String(e?.message || "Tool timed out").slice(0, 500),
          },
        }).catch(() => {});

        return fail(req, res, 504, "internal_server_error", "Tool timed out", { tool: toolName, error: "tool_timeout" });
      }

      prisma.apiRequestLog.create({
        data: {
          agentId: (req as any).agentId || null,
          apiKeyId: (req as any).apiKeyId || null,
          apiKeyPrefix: (req as any).apiKeyPrefix || null,
          toolName,
          endpoint: String(req.originalUrl || req.url || ""),
          method: String(req.method || "POST"),
          status: 500,
          latencyMs,
          requestId,
          ip,
          userAgent: ua,
          errorCode: "tool_error",
          errorMessage: String(e?.message || "Tool execution failed").slice(0, 500),
        },
      }).catch(() => {});

      return fail(req, res, 500, "internal_server_error", "Tool execution failed", { tool: toolName });
    }
  });
}

// ─── Public GET demo endpoints (no auth required) ───
invokeRouter.get("/tools/qr-code", async (req, res) => {
  const data = String(req.query.data || req.query.text || "");
  if (!data) return res.status(400).json({ ok: false, error: "missing_data", hint: "Pass ?data=your-text" });
  const result = await builtin.qrCode({ data, format: String(req.query.format || "png") });
  return res.json({ ok: true, result });
});

invokeRouter.get("/tools/hash", async (req, res) => {
  const input = String(req.query.input || req.query.text || "");
  if (!input) return res.status(400).json({ ok: false, error: "missing_input", hint: "Pass ?input=your-text" });
  const result = await builtin.generateHash({ input, algorithm: String(req.query.algorithm || "sha256") });
  return res.json({ ok: true, result });
});

invokeRouter.get("/tools/text-transform", async (req, res) => {
  const text = String(req.query.text || "");
  if (!text) return res.status(400).json({ ok: false, error: "missing_text", hint: "Pass ?text=your-text" });
  const result = await builtin.transformText({ text, mode: String(req.query.mode || "uppercase") });
  return res.json({ ok: true, result });
});

invokeRouter.post("/v1/tools/:toolName", requireApiKey, async (req: any, res, next) => {
  return handleInvoke(req, res, next, req.params.toolName);
});

// Legacy route
invokeRouter.post("/api/tools/:toolName", requireApiKey, async (req: any, res) => {
  return handleInvoke(req, res, () => {}, req.params.toolName);
});

function withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_resolve, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

async function dispatchTool(toolName: string, endpoint: string, body: any) {
  switch (toolName) {
    // ── Core 8 ──
    case "validate-data":      return builtin.validateData(body);
    case "generate-hash":      return builtin.generateHash(body);
    case "qr-code":            return builtin.qrCode(body);
    case "convert-format":     return builtin.convertFormat(body);
    case "transform-text":     return builtin.transformText(body);
    case "extract-metadata":   return builtin.extractMetadata(body);
    case "web-scrape":         return builtin.webScrape(body);
    case "ai-generate":        return builtin.aiGenerate(body);
    // ── Web/Browser (from v9-combined) ──
    case "search-web":         return builtin.searchWeb(body);
    case "extract-page":       return builtin.extractPage(body);
    case "extract-pdf":        return builtin.extractPdf(body);
    case "browser-task":       return builtin.browserTask(body);
    // ── Tier 1: High-demand ──
    case "ocr-extract":        return builtin.ocrExtract(body);
    case "ip-lookup":          return builtin.ipLookup(body);
    case "email-verify":       return builtin.emailVerify(body);
    case "phone-validate":     return builtin.phoneValidate(body);
    case "currency-convert":   return builtin.currencyConvert(body);
    case "timezone-convert":   return builtin.timezoneConvert(body);
    case "web-search":         return builtin.webSearch(body);
    // ── Tier 2: AI-powered ──
    case "sentiment-analysis": return builtin.sentimentAnalysis(body);
    case "summarize":          return builtin.summarize(body);
    case "extract-entities":   return builtin.extractEntities(body);
    case "language-detect":    return builtin.languageDetect(body);
    case "pii-detect":         return builtin.piiDetect(body);
    case "readability-score":  return builtin.readabilityScore(body);
    case "rss-parse":          return builtin.rssParse(body);
    // ── Tier 3: Differentiators ──
    case "generate-uuid":      return builtin.generateUuid(body);
    case "regex-generate":     return builtin.regexGenerate(body);
    case "diff-text":          return builtin.diffText(body);
    case "whois-lookup":          return builtin.whoisLookup(body);
    // ── New 8 (v14) ──
    case "screenshot-capture":     return builtin.screenshotCapture(body);
    case "image-generate":         return builtin.imageGenerate(body);
    case "html-to-markdown":       return builtin.htmlToMarkdown(body);
    case "url-shorten":            return builtin.urlShorten(body);
    case "webhook-send":           return builtin.webhookSend(body);
    case "jsonpath-query":         return builtin.jsonpathQuery(body);
    case "barcode-generate":       return builtin.barcodeGenerate(body);
    default:
      return {
        ok: false,
        error: "external_tool_proxy_not_implemented",
        hint: `Tool '${toolName}' is registered but proxy to '${endpoint}' is not enabled yet.`,
      };
  }
}
