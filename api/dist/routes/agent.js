"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const credits_1 = require("../utils/credits");
const email_1 = require("../services/email");
const crypto_1 = __importDefault(require("crypto"));
const router = (0, express_1.Router)();
// POST /v1/agent/register
router.post("/register", async (req, res) => {
    const { name, email } = req.body;
    if (!email) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "email is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid email format", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        // Check if already registered
        const existing = await prisma_1.prisma.agent.findUnique({ where: { email } });
        if (existing) {
            res.status(409).json({
                ok: false,
                error: "email_exists",
                message: "Email already registered. Use your existing API key.",
                request_id: (0, credits_1.reqId)(),
            });
            return;
        }
        const apiKey = `arch_${crypto_1.default.randomBytes(24).toString("hex")}`;
        const freeCredits = parseInt(process.env.FREE_MONTHLY_CREDITS ?? "100", 10);
        const agent = await prisma_1.prisma.agent.create({
            data: {
                apiKey,
                email,
                name: name ?? "",
                credits: freeCredits,
                tier: "free",
            },
        });
        res.status(201).json({
            ok: true,
            agent_id: agent.id,
            api_key: apiKey,
            credits: freeCredits,
            message: `Welcome! You have ${freeCredits} free credits to get started.`,
            docs: "https://archtools.dev",
            request_id: (0, credits_1.reqId)(),
        });
        // Send welcome email (non-blocking — don't delay the response)
        if (email) {
            (0, email_1.sendWelcomeEmail)(email, agent.id, apiKey, freeCredits).catch(() => { });
        }
    }
    catch (e) {
        console.error("Register error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: (0, credits_1.safeErr)(e), request_id: (0, credits_1.reqId)() });
    }
});
// GET /v1/agent/usage
router.get("/usage", auth_1.requireAuth, async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const today = new Date().toISOString().slice(0, 10);
        const [callsToday, recentActivity] = await Promise.all([
            prisma_1.prisma.apiRequest.count({ where: { agentId: agent.id, createdAt: { gte: new Date(today) } } }),
            prisma_1.prisma.apiRequest.findMany({
                where: { agentId: agent.id },
                orderBy: { createdAt: "desc" },
                take: 10,
                select: { toolName: true, creditsUsed: true, status: true, createdAt: true },
            }),
        ]);
        res.json({
            ok: true,
            agent_id: agent.id,
            credits_remaining: agent.credits,
            calls_today: callsToday,
            total_calls: agent.totalCalls,
            tier: agent.tier,
            recent_activity: recentActivity,
            buy_credits: "https://archtools.dev/pricing",
            request_id: (0, credits_1.reqId)(),
        });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "internal_error", message: (0, credits_1.safeErr)(e), request_id: (0, credits_1.reqId)() });
    }
});
// GET /v1/agent/balance
router.get("/balance", auth_1.requireAuth, async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const fresh = await prisma_1.prisma.agent.findUnique({
            where: { id: agent.id },
            select: { credits: true, tier: true, totalCalls: true, email: true },
        });
        res.json({
            ok: true,
            credits: fresh?.credits ?? agent.credits,
            tier: fresh?.tier ?? agent.tier,
            total_calls: fresh?.totalCalls ?? agent.totalCalls,
            email: fresh?.email ?? agent.email,
            buy_credits: "https://archtools.dev/#pricing",
            request_id: (0, credits_1.reqId)(),
        });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "internal_error", message: (0, credits_1.safeErr)(e), request_id: (0, credits_1.reqId)() });
    }
});
exports.default = router;
//# sourceMappingURL=agent.js.map