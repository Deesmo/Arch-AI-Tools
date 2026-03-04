import { Router } from "express";
import { prisma } from "../db.js";
import { requireApiKey } from "../middleware/auth.js";
import { getCreditBalance, debitCredits } from "../middleware/credits.js";
import * as builtin from "../tools/builtin.js";
import { v4 as uuidv4 } from "uuid";
import { ok, fail } from "../lib/http.js";
import { logger } from "../lib/logger.js";
export const workflowsRouter = Router();
// Multi-step workflow runner: execute up to N tools sequentially.
// Each step can reference prior output via "$last" template variable.
const MAX_STEPS = Number(process.env.WORKFLOW_MAX_STEPS || 8);
function safeToolName(name) {
    return String(name || "").trim().toLowerCase();
}
async function dispatch(toolName, body) {
    switch (toolName) {
        // ── Core 8 ──
        case "validate-data": return builtin.validateData(body);
        case "generate-hash": return builtin.generateHash(body);
        case "qr-code": return builtin.qrCode(body);
        case "convert-format": return builtin.convertFormat(body);
        case "transform-text": return builtin.transformText(body);
        case "extract-metadata": return builtin.extractMetadata(body);
        case "web-scrape": return builtin.webScrape(body);
        case "ai-generate": return builtin.aiGenerate(body);
        // ── Web/Browser ──
        case "search-web": return builtin.searchWeb(body);
        case "extract-page": return builtin.extractPage(body);
        case "extract-pdf": return builtin.extractPdf(body);
        case "browser-task": return builtin.browserTask(body);
        // ── Tier 1: High-demand ──
        case "ocr-extract": return builtin.ocrExtract(body);
        case "ip-lookup": return builtin.ipLookup(body);
        case "email-verify": return builtin.emailVerify(body);
        case "phone-validate": return builtin.phoneValidate(body);
        case "currency-convert": return builtin.currencyConvert(body);
        case "timezone-convert": return builtin.timezoneConvert(body);
        case "web-search": return builtin.webSearch(body);
        // ── Tier 2: AI-powered ──
        case "sentiment-analysis": return builtin.sentimentAnalysis(body);
        case "summarize": return builtin.summarize(body);
        case "extract-entities": return builtin.extractEntities(body);
        case "language-detect": return builtin.languageDetect(body);
        case "pii-detect": return builtin.piiDetect(body);
        case "readability-score": return builtin.readabilityScore(body);
        case "rss-parse": return builtin.rssParse(body);
        // ── Tier 3: Differentiators ──
        case "generate-uuid": return builtin.generateUuid(body);
        case "regex-generate": return builtin.regexGenerate(body);
        case "diff-text": return builtin.diffText(body);
        case "whois-lookup": return builtin.whoisLookup(body);
        default:
            return { ok: false, error: "unsupported_tool_in_workflow", tool: toolName };
    }
}
/**
 * POST /v1/workflows/run
 * Body: { steps: Array<{ tool: string, input?: any }> }
 *
 * Supports $last templating: reference prior step output in string fields.
 * Example: { tool: "summarize", input: { text: "$last" } }
 */
workflowsRouter.post("/v1/workflows/run", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : null;
    if (!steps)
        return fail(req, res, 400, "invalid_request", "Missing steps[]");
    if (steps.length === 0)
        return fail(req, res, 400, "invalid_request", "steps[] cannot be empty");
    if (steps.length > MAX_STEPS)
        return fail(req, res, 400, "invalid_request", `Max ${MAX_STEPS} steps`);
    const toolNames = steps.map((s) => safeToolName(s.tool));
    if (toolNames.some((t) => !t))
        return fail(req, res, 400, "invalid_request", "Each step must include tool");
    const toolRows = await prisma.tool.findMany({ where: { name: { in: toolNames }, active: true } });
    const toolMap = new Map(toolRows.map((t) => [t.name, t]));
    for (const t of toolNames) {
        if (!toolMap.has(t))
            return fail(req, res, 404, "tool_not_found", `Tool not found or inactive: ${t}`);
    }
    const totalCost = toolNames.reduce((sum, t) => sum + (toolMap.get(t).credits || 0), 0);
    const balance = await getCreditBalance(agentId);
    if (balance < totalCost) {
        return fail(req, res, 402, "insufficient_credits", "Not enough credits to run workflow", {
            credits_required: totalCost,
            credits_remaining: balance,
        });
    }
    const workflowId = req.requestId || uuidv4();
    const startedAt = Date.now();
    const outputs = [];
    let context = { last: null, outputs: [] };
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i] || {};
        const toolName = safeToolName(step.tool);
        const tool = toolMap.get(toolName);
        // Simple $last templating in string fields
        const input = step.input ?? step.payload ?? {};
        const resolved = JSON.parse(JSON.stringify(input, (_k, v) => {
            if (typeof v === "string" && v.includes("$last")) {
                return v.replaceAll("$last", typeof context.last === "string" ? context.last : JSON.stringify(context.last));
            }
            return v;
        }));
        const stepId = `${workflowId}:${i + 1}:${toolName}`;
        const stepStart = Date.now();
        try {
            const result = await dispatch(toolName, resolved);
            outputs.push({ step: i + 1, tool: toolName, credits: tool.credits, latency_ms: Date.now() - stepStart, result });
            context.last = result;
            context.outputs.push(result);
            await debitCredits(agentId, toolName, tool.credits, stepId, {
                workflow_id: workflowId,
                step: i + 1,
                latency_ms: Date.now() - stepStart,
            });
        }
        catch (e) {
            logger.error({ workflowId, tool: toolName, step: i + 1, error: e.message }, "Workflow step failed");
            return fail(req, res, 500, "workflow_failed", "Workflow step failed", {
                workflow_id: workflowId,
                step: i + 1,
                tool: toolName,
            });
        }
    }
    const after = await getCreditBalance(agentId);
    return ok(res, {
        workflow_id: workflowId,
        steps: outputs,
        credits_used: totalCost,
        credits_remaining: after,
        latency_ms: Date.now() - startedAt,
    });
});
//# sourceMappingURL=workflows.js.map