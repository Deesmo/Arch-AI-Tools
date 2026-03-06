"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deductCredits = deductCredits;
exports.logError = logError;
exports.reqId = reqId;
const prisma_1 = require("../lib/prisma");
async function deductCredits(req, res, toolName, cost) {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: crypto.randomUUID() });
        return false;
    }
    if (agent.credits < cost) {
        res.status(402).json({
            ok: false,
            error: "insufficient_credits",
            message: `This tool costs ${cost} credits. You have ${agent.credits}. Buy more at https://archtools.dev/pricing`,
            credits_remaining: agent.credits,
            credits_needed: cost,
            request_id: crypto.randomUUID(),
        });
        return false;
    }
    // Deduct credits atomically
    await prisma_1.prisma.agent.update({
        where: { id: agent.id },
        data: {
            credits: { decrement: cost },
            totalCalls: { increment: 1 },
        },
    });
    // Update agent object in-place for use in handler
    agent.credits -= cost;
    // Log the request
    try {
        await prisma_1.prisma.apiRequest.create({
            data: {
                agentId: agent.id,
                toolName,
                creditsUsed: cost,
                status: "SUCCESS",
            },
        });
        // Update daily rollup
        const today = new Date().toISOString().slice(0, 10);
        await prisma_1.prisma.dailyUsage.upsert({
            where: { date_toolName: { date: today, toolName } },
            update: { callCount: { increment: 1 } },
            create: { date: today, toolName, callCount: 1 },
        });
    }
    catch {
        // Non-fatal — don't block the response
    }
    return true;
}
async function logError(agentId, toolName, cost) {
    try {
        await prisma_1.prisma.apiRequest.create({
            data: {
                agentId,
                toolName,
                creditsUsed: cost,
                status: "ERROR",
            },
        });
    }
    catch {
        // Non-fatal
    }
}
function reqId() {
    return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
//# sourceMappingURL=credits.js.map