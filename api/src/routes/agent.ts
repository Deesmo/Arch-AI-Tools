import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { sendWelcomeEmail, sendAdminAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const router = Router();

// POST /v1/agent/register
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const { name, email: rawEmail, plan, password } = req.body as { name?: string; email?: string; plan?: string; password?: string };
  const email = rawEmail?.toLowerCase().trim();
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
        tier: (["free","starter","pro","business"].includes(plan?.replace(/-(?:monthly|annual)$/,"") ?? "") ? plan!.replace(/-(?:monthly|annual)$/,"") : "free") as any,
      },
    });

    // Save password hash if provided
    if (password && password.length >= 8) {
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.agent.update({ where: { id: agent.id }, data: { passwordHash } });
    }

    // ─── Embedded Wallet Auto-Creation (best-effort, non-fatal) ─────────
    let walletAddress: string | null = null;
    try {
      if (config.cdp.apiKeyId && config.cdp.apiKeySecret) {
        const { axiosHooks } = await import("@coinbase/cdp-sdk/auth");
        const axios = (await import("axios")).default;

        const axiosClient = axios.create({
          baseURL: "https://api.cdp.coinbase.com",
        });

        axiosHooks.withAuth(axiosClient, {
          apiKeyId: config.cdp.apiKeyId,
          apiKeySecret: config.cdp.apiKeySecret,
          walletSecret: config.cdp.walletSecret,
        });

        const walletResp = await axiosClient.post("/platform/v2/evm/accounts", {
          name: `user-${agent.id.slice(0, 8)}`,
        });

        const address = walletResp.data?.address;
        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          walletAddress = address;
          await prisma.agent.update({
            where: { id: agent.id },
            data: { walletAddress: address },
          });
          logger.info({ agentId: agent.id, walletAddress: address }, "Embedded wallet created on signup");
        }
      } else {
        logger.debug("CDP keys not configured — skipping auto wallet creation");
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      logger.warn({ agentId: agent.id, error: errMsg }, "Wallet auto-creation failed (non-fatal)");
    }

    res.status(201).json({
      ok: true,
      agent_id: agent.id,
      api_key: apiKey,
      credits: freeCredits,
      wallet_address: walletAddress,
      message: `Welcome! You have ${freeCredits} free credits to get started.`,
      docs: "https://archtools.dev",
      request_id: reqId(),
    });

    // Create referral code for the new user (non-blocking)
    let referralCode: string | undefined;
    try {
      const code = `ARCH-${crypto.randomBytes(4).toString("hex")}`;
      await prisma.referral.create({
        data: {
          referrerId: agent.id,
          code,
          status: "pending",
          rewardCredits: 500,
        },
      });
      referralCode = code;
    } catch {
      // Non-fatal — referral code creation failed
    }

    // Send welcome email (non-blocking — don't delay the response)
    if (email) {
      sendWelcomeEmail(email, agent.id, apiKey, freeCredits, referralCode).catch(() => {});
      // Admin new signup alert
      sendAdminAlert(
        `👤 New Arch Tools signup — ${email}`,
        `New user registered!\n\nEmail: ${email}\nName: ${name ?? "(not provided)"}\nStarting credits: ${freeCredits}\nReferral code: ${referralCode ?? "N/A"}\nAgent ID: ${agent.id}`
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
      purchase_history: await prisma.purchase.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { credits: true, amountCents: true, createdAt: true },
      }).catch(() => []),
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

// ─── POST /v1/agent/keys/rotate ──────────────────────────────────────────────
// Generate a new API key, invalidate the old one. Returns new key ONCE.
router.post("/keys/rotate", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    const crypto = await import("crypto");
    const bcrypt = await import("bcryptjs");
    
    const newKey = `arch_${crypto.default.randomBytes(24).toString("hex")}`;
    const newPrefix = newKey.slice(0, 12);
    const newHash = await bcrypt.default.hash(newKey, 10);

    await prisma.agent.update({
      where: { id: agent.id },
      data: { apiKey: newKey, apiKeyPrefix: newPrefix, apiKeyHash: newHash },
    });

    res.json({
      ok: true,
      message: "API key rotated successfully. Save this key — it won't be shown again.",
      api_key: newKey,
      prefix: newPrefix,
      request_id: reqId(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "server_error", message: safeErr(err), request_id: reqId() });
  }
});

// ─── DELETE /v1/agent/keys/:prefix ───────────────────────────────────────────
// Revoke a specific API key by prefix (for multi-key accounts in future)
router.delete("/keys/:prefix", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  const { prefix } = req.params;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  
  // For now, can only revoke own current key prefix
  if (!agent.apiKey?.startsWith(String(prefix))) {
    res.status(403).json({ ok: false, error: "forbidden", message: "Can only revoke your own key", request_id: reqId() });
    return;
  }

  // Invalidate by setting apiKey to empty — forces re-registration
  await prisma.agent.update({
    where: { id: agent.id },
    data: { apiKey: `revoked_${prefix}`, apiKeyHash: "" },
  }).catch(() => {});

  res.json({ ok: true, message: "API key revoked. Generate a new key via POST /v1/agent/keys/rotate.", request_id: reqId() });
});
