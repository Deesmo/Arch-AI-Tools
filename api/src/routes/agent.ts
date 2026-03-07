import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { reqId, safeErr } from "../utils/credits";
import crypto from "crypto";

const router = Router();

// POST /v1/agent/register
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const { name, email } = req.body as { name?: string; email?: string };
  if (!email) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "email is required", request_id: reqId() });
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid email format", request_id: reqId() });
    return;
  }

  try {
    // Check if already registered
    const existing = await prisma.agent.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({
        ok: false,
        error: "email_exists",
        message: "Email already registered. Use your existing API key.",
        request_id: reqId(),
      });
      return;
    }

    const apiKey = `arch_${crypto.randomBytes(24).toString("hex")}`;
    const freeCredits = parseInt(process.env.FREE_MONTHLY_CREDITS ?? "100", 10);

    const agent = await prisma.agent.create({
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
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Register error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// GET /v1/agent/usage
router.get("/usage", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [callsToday, recentActivity] = await Promise.all([
      prisma.apiRequest.count({ where: { agentId: agent.id, createdAt: { gte: new Date(today) } } }),
      prisma.apiRequest.findMany({
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
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// GET /v1/agent/balance
router.get("/balance", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  try {
    const fresh = await prisma.agent.findUnique({
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
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
