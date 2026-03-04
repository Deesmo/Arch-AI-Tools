import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { newApiKey } from "../lib/crypto.js";
import { requireApiKey, requireAdminKey } from "../middleware/auth.js";
import { getCreditBalance, reverseCredits } from "../middleware/credits.js";
import { logger } from "../lib/logger.js";
import { rateLimitPolicyMiddleware } from "../lib/ratelimitPolicy.js";
import * as builtin from "../tools/builtin.js";
import { debitCredits } from "../middleware/credits.js";
import { v4 as uuidv4 } from "uuid";
import { ok, fail } from "../lib/http.js";
export const agentRouter = Router();
// Rate limit registration to prevent free credit farming
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per IP per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_registrations", detail: "Max 5 registrations per hour" },
});
/**
 * POST /v1/agent/register
 * Register a new agent. Optionally provide an email address.
 * If email is provided, prevents duplicate registrations and enables
 * future features like credit refresh notifications and password reset.
 */
agentRouter.post("/v1/agent/register", rateLimitPolicyMiddleware(5, 60 * 60 * 1000), registerLimiter, async (req, res) => {
    const { name, email } = req.body || {};
    const agentName = (name && String(name).slice(0, 80)) || "agent";
    // Email validation (optional but recommended)
    let cleanEmail = null;
    if (email) {
        cleanEmail = String(email).trim().toLowerCase().slice(0, 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ error: "invalid_email" });
        }
        // Free credits require verified email accounts.
        // Enforce using the /signup magic-link flow.
        const user = await prisma.user.findUnique({ where: { email: cleanEmail } }).catch(() => null);
        if (!user || !user.emailVerifiedAt) {
            return res.status(403).json({
                error: "email_not_verified",
                detail: "Free credits require a verified email account. Please use https://archtools.dev/signup to verify your email.",
            });
        }
        // Check if email already registered
        const existing = await prisma.agent.findUnique({ where: { email: cleanEmail } });
        if (existing) {
            return res.status(409).json({
                error: "email_already_registered",
                detail: "An agent with this email already exists. Use your existing API key or contact support.",
            });
        }
    }
    // All agents start on free plan. Upgrades happen through Stripe only.
    const agent = await prisma.agent.create({
        data: { name: agentName, email: cleanEmail, plan: "free" },
    });
    const { raw, prefix, hash } = newApiKey();
    await prisma.apiKey.create({
        data: { agentId: agent.id, keyHash: hash, prefix },
    });
    // No free credits are granted here anymore.
    // Verified users receive their monthly free credits via /v1/auth/verify.
    const initial = 0;
    logger.info({ agentId: agent.id, email: cleanEmail }, "New agent registered");
    res.status(201).json({
        agent_id: agent.id,
        plan: agent.plan,
        api_key: raw,
        api_key_prefix: prefix,
        credits_granted: initial,
        note: "Save your API key — it cannot be retrieved later. For free credits, verify your email at /signup.",
    });
});
/**
 * POST /v1/agent/keys — generate additional API keys
 */
agentRouter.post("/v1/agent/keys", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const { label } = req.body || {};
    // Max 5 active keys per agent
    const activeKeys = await prisma.apiKey.count({
        where: { agentId, revokedAt: null },
    });
    if (activeKeys >= 5) {
        return res.status(400).json({ error: "max_keys_reached", detail: "Revoke an existing key first" });
    }
    const { raw, prefix, hash } = newApiKey();
    await prisma.apiKey.create({
        data: {
            agentId,
            keyHash: hash,
            prefix,
            label: label ? String(label).slice(0, 80) : null,
        },
    });
    res.status(201).json({
        api_key: raw,
        api_key_prefix: prefix,
        label: label || null,
        note: "Save your API key — it cannot be retrieved later.",
    });
});
/**
 * DELETE /v1/agent/keys/:prefix — revoke a key by prefix
 */
agentRouter.delete("/v1/agent/keys/:prefix", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const prefix = String(req.params.prefix || "");
    const key = await prisma.apiKey.findFirst({
        where: { agentId, prefix, revokedAt: null },
    });
    if (!key)
        return res.status(404).json({ error: "key_not_found" });
    await prisma.apiKey.update({
        where: { id: key.id },
        data: { revokedAt: new Date() },
    });
    res.json({ ok: true, revoked: prefix });
});
/**
 * PATCH /v1/agent/keys/:prefix — admin-only update of key restrictions
 * Body: { allowed_origins?: string, allowed_ips?: string, daily_credit_cap?: number }
 */
agentRouter.patch("/v1/agent/keys/:prefix", requireAdminKey, async (req, res) => {
    const prefix = String(req.params.prefix || "");
    const { allowed_origins, allowed_ips, daily_credit_cap } = req.body || {};
    const key = await prisma.apiKey.findFirst({ where: { prefix } });
    if (!key)
        return res.status(404).json({ error: "key_not_found" });
    const cap = daily_credit_cap == null ? null : Number(daily_credit_cap);
    if (cap != null && (!Number.isFinite(cap) || cap < 0)) {
        return res.status(400).json({ error: "invalid_daily_credit_cap" });
    }
    const updated = await prisma.apiKey.update({
        where: { id: key.id },
        data: {
            allowedOrigins: allowed_origins ? String(allowed_origins).slice(0, 2000) : null,
            allowedIps: allowed_ips ? String(allowed_ips).slice(0, 2000) : null,
            dailyCreditCap: cap == null ? null : Math.floor(cap),
        },
        select: { prefix: true, allowedOrigins: true, allowedIps: true, dailyCreditCap: true },
    });
    res.json({ ok: true, key: updated });
});
// ─────────────────────────────────────────────────────────────────────────────
// V9: Agent runtime
// POST /v1/agent/execute
// Body: { task: string }
// This is intentionally conservative: small planning heuristic + bounded steps.
// ─────────────────────────────────────────────────────────────────────────────
function scoreTools(task, tools) {
    const q = task.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean).slice(0, 12);
    return tools
        .map((t) => {
        const hay = `${t.name} ${(t.description || "")} ${(t.category || "")}`.toLowerCase();
        let score = 0;
        if (hay.includes(q))
            score += 5;
        for (const w of words) {
            if (w.length < 3)
                continue;
            if (hay.includes(w))
                score += 1;
        }
        // Bias toward web automation for web tasks
        if (/(news|latest|web|site|page|scrape|extract|browser)/.test(q) && /(web|files|ai)/.test(t.category || ""))
            score += 1;
        return { t, score };
    })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.t);
}
async function dispatch(toolName, body) {
    switch (toolName) {
        case "validate-data":
            return builtin.validateData(body);
        case "generate-hash":
            return builtin.generateHash(body);
        case "qr-code":
            return builtin.qrCode(body);
        case "convert-format":
            return builtin.convertFormat(body);
        case "transform-text":
            return builtin.transformText(body);
        case "extract-metadata":
            return builtin.extractMetadata(body);
        case "web-scrape":
            return builtin.webScrape(body);
        case "search-web":
            return builtin.searchWeb(body);
        case "extract-page":
            return builtin.extractPage(body);
        case "extract-pdf":
            return builtin.extractPdf(body);
        case "browser-task":
            return builtin.browserTask(body);
        case "ai-generate":
            return builtin.aiGenerate(body);
        default:
            return { ok: false, error: "unsupported_tool", tool: toolName };
    }
}
agentRouter.post("/v1/agent/execute", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const task = String(req.body?.task || "").trim();
    if (!task)
        return fail(req, res, 400, "invalid_request", "Missing task");
    const requestId = req.requestId || uuidv4();
    const startedAt = Date.now();
    const toolRows = await prisma.tool.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    const ranked = scoreTools(task, toolRows);
    // Simple planning heuristic
    const steps = [];
    const has = (name) => toolRows.some((t) => t.name === name);
    const toolCost = (name) => toolRows.find((t) => t.name === name)?.credits || 0;
    const wantsWeb = /(news|latest|web|website|page|scrape|extract)/i.test(task);
    const wantsSummary = /(summarize|summary|tl;dr)/i.test(task);
    if (wantsWeb && has("search-web")) {
        steps.push({ tool: "search-web", input: { query: task, limit: 5 }, credits: toolCost("search-web") });
    }
    if (wantsWeb && has("extract-page") && /(http:\/\/|https:\/\/)/i.test(task)) {
        // If user already provided a URL in the task, pull it.
        const match = task.match(/https?:\/\/\S+/i);
        if (match)
            steps.push({ tool: "extract-page", input: { url: match[0] }, credits: toolCost("extract-page") });
    }
    if (wantsSummary && has("ai-generate") && process.env.ANTHROPIC_API_KEY) {
        steps.push({
            tool: "ai-generate",
            input: {
                prompt: `You are an expert technical analyst. Summarize the following information for a developer. Be concise but include key bullets and 1-2 actionable takeaways.\n\nTASK: ${task}\n\nINPUT:\n$last`,
                max_tokens: 800,
            },
            credits: toolCost("ai-generate"),
        });
    }
    // Fallback: if we couldn't plan anything, use the top ranked tool.
    if (steps.length === 0 && ranked.length) {
        const t = ranked[0];
        steps.push({ tool: t.name, input: { query: task }, credits: t.credits || 0 });
    }
    // Bound steps
    const bounded = steps.slice(0, 3);
    const totalCost = bounded.reduce((s, x) => s + (x.credits || 0), 0);
    const balance = await getCreditBalance(agentId);
    if (balance < totalCost) {
        return fail(req, res, 402, "insufficient_credits", "Not enough credits to execute task", {
            credits_required: totalCost,
            credits_remaining: balance,
            planned_steps: bounded.map((s) => ({ tool: s.tool, credits: s.credits })),
        });
    }
    const outputs = [];
    let last = null;
    for (let i = 0; i < bounded.length; i++) {
        const step = bounded[i];
        const stepId = `${requestId}:${i + 1}:${step.tool}`;
        const stepStart = Date.now();
        // Replace $last templating
        const resolved = JSON.parse(JSON.stringify(step.input ?? {}, (_k, v) => {
            if (typeof v === "string" && v.includes("$last")) {
                return v.replaceAll("$last", typeof last === "string" ? last : JSON.stringify(last));
            }
            return v;
        }));
        try {
            const result = await dispatch(step.tool, resolved);
            const latencyMs = Date.now() - stepStart;
            outputs.push({ step: i + 1, tool: step.tool, credits: step.credits, latency_ms: latencyMs, result });
            last = result;
            await debitCredits(agentId, step.tool, step.credits, stepId, {
                agent_task: task,
                latency_ms: latencyMs,
            });
            // Best-effort analytics log (won't break execution if table isn't migrated yet)
            try {
                await prisma.apiRequest?.create?.({
                    data: {
                        agentId,
                        tool: step.tool,
                        status: "ok",
                        creditsUsed: step.credits,
                        latencyMs,
                        requestId: stepId,
                        meta: { task },
                    },
                });
            }
            catch { }
        }
        catch (e) {
            const latencyMs = Date.now() - stepStart;
            try {
                await prisma.apiRequest?.create?.({
                    data: {
                        agentId,
                        tool: step.tool,
                        status: "error",
                        creditsUsed: 0,
                        latencyMs,
                        requestId: stepId,
                        meta: { task, error: e.message },
                    },
                });
            }
            catch { }
            logger.error({ agentId, tool: step.tool, error: e.message }, "Agent execution step failed");
            return fail(req, res, 500, "agent_execution_failed", "Agent execution failed", {
                step: i + 1,
                tool: step.tool,
            });
        }
    }
    const remaining = await getCreditBalance(agentId);
    return ok(res, {
        request_id: requestId,
        task,
        planned_steps: bounded.map((s) => ({ tool: s.tool, credits: s.credits })),
        steps: outputs,
        credits_used: totalCost,
        credits_remaining: remaining,
        latency_ms: Date.now() - startedAt,
    });
});
/**
 * POST /v1/agent/:agentId/upgrade — admin-only plan upgrade
 */
agentRouter.post("/v1/agent/:agentId/upgrade", requireAdminKey, async (req, res) => {
    const { agentId } = req.params;
    const { plan } = req.body || {};
    const validPlans = ["free", "pro", "business"];
    if (!validPlans.includes(plan)) {
        return res.status(400).json({ error: "invalid_plan", valid: validPlans });
    }
    try {
        const agent = await prisma.agent.update({
            where: { id: agentId },
            data: { plan },
        });
        logger.info({ agentId, plan }, "Agent plan upgraded");
        res.json({ ok: true, agent_id: agent.id, plan: agent.plan });
    }
    catch (e) {
        return res.status(404).json({ error: "agent_not_found" });
    }
});
/**
 * POST /v1/agent/:agentId/reverse
 * Admin-only: subtract credits without mutating history (refunds/chargebacks/manual adjustments).
 * Body: { credits: number, reference?: string, reason?: string }
 */
agentRouter.post("/v1/agent/:agentId/reverse", requireAdminKey, async (req, res) => {
    const agentId = String(req.params.agentId || "");
    const credits = Number(req.body?.credits);
    const reference = String(req.body?.reference || `admin_reverse_${Date.now()}`);
    const reason = String(req.body?.reason || "admin_adjustment");
    if (!agentId)
        return res.status(400).json({ error: "missing_agent_id" });
    if (!Number.isFinite(credits) || credits <= 0)
        return res.status(400).json({ error: "invalid_credits" });
    await reverseCredits(agentId, Math.floor(credits), reference, { reason });
    const balance = await getCreditBalance(agentId);
    return res.json({ ok: true, agent_id: agentId, reversed: Math.floor(credits), credits_remaining: balance });
});
/**
 * GET /v1/agent/usage — credit balance and call stats
 */
agentRouter.get("/v1/agent/usage", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const [agent, balance, callsToday, totalCalls, recent] = await Promise.all([
        prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, plan: true, email: true, createdAt: true } }),
        getCreditBalance(agentId),
        prisma.ledgerEntry.count({
            where: { agentId, kind: { in: ["debit", "reversal"] }, createdAt: { gte: startOfDay(new Date()) } },
        }),
        prisma.ledgerEntry.count({ where: { agentId, kind: { in: ["debit", "reversal"] } } }),
        prisma.ledgerEntry.findMany({
            where: { agentId },
            orderBy: { createdAt: "desc" },
            take: 25,
        }),
    ]);
    res.json({
        agent: agent ? { name: agent.name, plan: agent.plan, email: agent.email, created: agent.createdAt } : null,
        credits_remaining: balance,
        calls_today: callsToday,
        total_calls: totalCalls,
        recent_activity: recent.map((r) => ({
            kind: r.kind,
            credits: r.credits,
            tool: r.toolName,
            request_id: r.requestId,
            at: r.createdAt,
        })),
    });
});
/**
 * GET /v1/agent/dashboard — enhanced stats for dashboard UI
 */
agentRouter.get("/v1/agent/dashboard", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [agent, balance, keys, dailyUsage, toolBreakdown, totalCalls] = await Promise.all([
        prisma.agent.findUnique({ where: { id: agentId } }),
        getCreditBalance(agentId),
        prisma.apiKey.findMany({
            where: { agentId, revokedAt: null },
            select: { prefix: true, label: true, createdAt: true },
        }),
        // Daily usage for last 30 days
        prisma.$queryRaw `
      SELECT DATE(created_at) as date, COUNT(*)::int as calls, SUM(credits)::int as credits_used
      FROM "LedgerEntry"
      WHERE agent_id = ${agentId} AND kind = 'debit' AND created_at >= ${thirtyDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `,
        // Tool breakdown
        prisma.$queryRaw `
      SELECT tool_name as tool, COUNT(*)::int as calls, SUM(credits)::int as credits_used
      FROM "LedgerEntry"
      WHERE agent_id = ${agentId} AND kind = 'debit' AND tool_name IS NOT NULL
      GROUP BY tool_name
      ORDER BY calls DESC
    `,
        prisma.ledgerEntry.count({ where: { agentId, kind: { in: ["debit", "reversal"] } } }),
    ]);
    res.json({
        agent: agent ? { name: agent.name, plan: agent.plan, email: agent.email, created: agent.createdAt } : null,
        credits_remaining: balance,
        total_calls: totalCalls,
        api_keys: keys,
        daily_usage: dailyUsage,
        tool_breakdown: toolBreakdown,
    });
});
function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
//# sourceMappingURL=agent.js.map