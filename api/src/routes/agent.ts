import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { sendWelcomeEmail, sendAdminAlert } from "../services/email.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

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
    // Check if already registered (use raw to handle corrupted records with null apiKey)
    let existing: { id: string } | null = null;
    try {
      existing = await prisma.agent.findUnique({ where: { email } });
    } catch {
      // Corrupted record (e.g. null apiKey) — check via raw SQL
      const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Agent" WHERE email=${email} LIMIT 1`;
      if (rows.length > 0) existing = rows[0];
    }
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
    // Security: store a bcrypt hash of the API key (saltRounds=10) for secure comparison.
    // The first 12 chars are stored as apiKeyPrefix for fast indexed lookup.
    const apiKeyPrefix = apiKey.slice(0, 12);
    const apiKeyHash = await bcrypt.hash(apiKey, 10);
    const freeCredits = parseInt(process.env.FREE_MONTHLY_CREDITS ?? "100", 10);

    const agent = await prisma.agent.create({
      data: {
        apiKey,
        apiKeyPrefix,
        apiKeyHash,
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

    // Send welcome email (non-blocking — don't delay the response)
    if (email) {
      sendWelcomeEmail(email, agent.id, apiKey, freeCredits).catch(() => {});
      // Admin new signup alert
      sendAdminAlert(
        `👤 New Arch Tools signup — ${email}`,
        `New user registered!\n\nEmail: ${email}\nName: ${name ?? "(not provided)"}\nStarting credits: ${freeCredits}\nAgent ID: ${agent.id}`
      ).catch(() => {});
    }
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
