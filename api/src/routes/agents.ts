/**
 * Agent Identity Routes — Lightweight KYA (Know Your Agent)
 *
 * Public endpoints for agent reputation and discovery:
 * - GET  /api/v1/agents/:agentId    — public agent profile
 * - POST /api/v1/agents/register    — register with identity metadata
 * - GET  /api/v1/agents/leaderboard — top agents by reputation/usage
 */

import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireApiKeyAuth, requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import {
  calculateBadge,
  calculateReputationScore,
  updateAgentReputation,
  BADGE_THRESHOLDS,
} from "../services/reputation.js";
import { validateUrl } from "../lib/ssrf.js";
import { SIGNUP_FREE_CREDITS, isDisposableEmail, issueEmailVerification, enforceSignupLimits, recordSignupIp } from "../lib/verification.js";

const router = Router();

// ─── Badge emoji helper ──────────────────────────────────────────────────────
const BADGE_EMOJI: Record<string, string> = {
  diamond: "💎",
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
  none: "",
};

// ─── GET /api/v1/agents/leaderboard ──────────────────────────────────────────
// Public — top agents by reputation, usage, or spend
router.get("/leaderboard", async (req: Request, res: Response): Promise<void> => {
  try {
    const sortBy = (Array.isArray(req.query.sort) ? req.query.sort[0] : req.query.sort) as string ?? "reputation";
    const limit = Math.min(parseInt((Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit) as string) || 25, 100);

    const orderBy = sortBy === "usage"
      ? { totalCalls: "desc" as const }
      : sortBy === "spend"
        ? { totalSpentUsdc: "desc" as const }
        : { reputationScore: "desc" as const };

    const agents = await prisma.agent.findMany({
      where: { isPublic: true, totalCalls: { gt: 0 } },
      orderBy,
      take: limit,
      select: {
        id: true,
        name: true,
        description: true,
        reputationScore: true,
        badge: true,
        totalCalls: true,
        totalSpentUsdc: true,
        tier: true,
        createdAt: true,
      },
    });

    const leaderboard = agents.map((a, i) => ({
      rank: i + 1,
      agent_id: a.id,
      name: a.name || "Anonymous Agent",
      description: a.description || null,
      reputation_score: a.reputationScore,
      badge: a.badge,
      badge_emoji: BADGE_EMOJI[a.badge] ?? "",
      total_calls: a.totalCalls,
      total_spent_usdc: Math.round(a.totalSpentUsdc * 1000) / 1000,
      tier: a.tier,
      member_since: a.createdAt.toISOString(),
    }));

    res.json({
      ok: true,
      sort: sortBy,
      count: leaderboard.length,
      leaderboard,
      badge_thresholds: BADGE_THRESHOLDS,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Leaderboard error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/agents/:agentId ────────────────────────────────────────────
// Public agent profile — reputation, usage, badges
router.get("/:agentId", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        description: true,
        reputationScore: true,
        badge: true,
        totalCalls: true,
        totalSpentUsdc: true,
        tier: true,
        createdAt: true,
        lastSeenAt: true,
        isPublic: true,
        walletAddress: true,
        successCount: true,
        errorCount: true,
      },
    });

    if (!agent) {
      res.status(404).json({
        ok: false,
        error: "not_found",
        message: "Agent not found",
        request_id: reqId(),
      });
      return;
    }

    // If not public, show minimal info
    if (!agent.isPublic) {
      res.json({
        ok: true,
        agent: {
          agent_id: agent.id,
          name: agent.name || "Anonymous Agent",
          reputation_score: agent.reputationScore,
          badge: agent.badge,
          badge_emoji: BADGE_EMOJI[agent.badge] ?? "",
          public: false,
        },
        request_id: reqId(),
      });
      return;
    }

    // Get recent tool usage breakdown
    const toolUsage = await prisma.apiRequest.groupBy({
      by: ["toolName"],
      where: { agentId: agentId as string },
      _count: { toolName: true },
      orderBy: { _count: { toolName: "desc" } },
      take: 10,
    });

    const errorRate = agent.totalCalls > 0
      ? Math.round((agent.errorCount / agent.totalCalls) * 10000) / 100
      : 0;

    res.json({
      ok: true,
      agent: {
        agent_id: agent.id,
        name: agent.name || "Anonymous Agent",
        description: agent.description || null,
        reputation_score: agent.reputationScore,
        badge: agent.badge,
        badge_emoji: BADGE_EMOJI[agent.badge] ?? "",
        total_calls: agent.totalCalls,
        success_rate: agent.totalCalls > 0
          ? Math.round((agent.successCount / agent.totalCalls) * 10000) / 100
          : 100,
        error_rate: errorRate,
        total_spent_usdc: Math.round(agent.totalSpentUsdc * 1000) / 1000,
        wallet_address: agent.walletAddress || null,
        tier: agent.tier,
        member_since: agent.createdAt.toISOString(),
        last_seen: agent.lastSeenAt?.toISOString() || null,
        public: true,
      },
      top_tools: toolUsage.map((t: any) => ({
        tool: t.toolName,
        calls: t._count?.toolName ?? 0,
      })),
      badge_thresholds: BADGE_THRESHOLDS,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Agent profile error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── POST /api/v1/agents/register ────────────────────────────────────────────
// Enhanced registration with identity metadata
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      email: rawEmail,
      description,
      wallet_address,
      callback_url,
      is_public,
    } = req.body as {
      name?: string;
      email?: string;
      description?: string;
      wallet_address?: string;
      callback_url?: string;
      is_public?: boolean;
    };

    const email = rawEmail?.toLowerCase().trim();
    if (!email) {
      res.status(400).json({
        ok: false,
        error: "invalid_request",
        message: "email is required",
        request_id: reqId(),
      });
      return;
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      res.status(400).json({
        ok: false,
        error: "invalid_request",
        message: "Invalid email format",
        request_id: reqId(),
      });
      return;
    }

    if (isDisposableEmail(email)) {
      res.status(400).json({
        ok: false,
        error: "disposable_email",
        message: "Disposable email addresses are not allowed. Please use a real email address.",
        request_id: reqId(),
      });
      return;
    }

    // Validate wallet address if provided (basic hex check)
    if (wallet_address && !/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
      res.status(400).json({
        ok: false,
        error: "invalid_request",
        message: "Invalid wallet address — must be a valid Ethereum address (0x...)",
        request_id: reqId(),
      });
      return;
    }

    // Validate callback URL if provided
    if (callback_url) {
      try {
        const parsed = new URL(callback_url);
        if (parsed.protocol !== "https:") {
          res.status(400).json({
            ok: false,
            error: "invalid_request",
            message: "Invalid callback URL — must use HTTPS",
            request_id: reqId(),
          });
          return;
        }
        await validateUrl(callback_url);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: "invalid_request",
          message: e instanceof Error ? e.message : "Invalid callback URL",
          request_id: reqId(),
        });
        return;
      }
    }

    // Check for existing registration
    const existing = await prisma.agent.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({
        ok: false,
        error: "email_exists",
        message: "Email already registered. Use your existing API key or update your profile.",
        request_id: reqId(),
      });
      return;
    }

    // Anti-farming: normalized-email identity + per-IP daily signup caps
    const limitBlock = await enforceSignupLimits(email, req.ip);
    if (limitBlock) {
      res.status(limitBlock.status).json({ ok: false, error: limitBlock.error, message: limitBlock.message, request_id: reqId() });
      return;
    }

    // Generate API key
    const crypto = await import("crypto");
    const bcrypt = await import("bcryptjs");
    const apiKey = `arch_${crypto.randomBytes(24).toString("hex")}`;
    const apiKeyPrefix = apiKey.slice(0, 12);
    const apiKeyHash = await bcrypt.hash(apiKey, 10);
    const freeCredits = SIGNUP_FREE_CREDITS;

    // Only prefix + hash are persisted — the raw key is returned ONCE below.
    const agent = await prisma.agent.create({
      data: {
        apiKeyPrefix,
        apiKeyHash,
        email,
        name: name ?? "",
        description: description ?? null,
        walletAddress: wallet_address ?? null,
        callbackUrl: callback_url ?? null,
        isPublic: is_public !== false, // default true
        // Start at 0; grant activates on email verification (fail closed).
        credits: 0,
        tier: "free",
        reputationScore: 50,
        badge: "none",
      },
    });
    // Count this IP only now that the account actually exists (F-4).
    recordSignupIp(req.ip);

    // Email verification gate: credits stay pending until email verified.
    // Grant is atomically claimed per normalized identity (SignupIdentity).
    let gatedCredits = 0;
    try {
      gatedCredits = await issueEmailVerification(agent.id, email, freeCredits);
    } catch (e) {
      console.error("Verification setup failed (credits remain 0, user can resend):", e);
    }

    res.status(201).json({
      ok: true,
      agent_id: agent.id,
      api_key: apiKey,
      credits: 0,
      pending_credits: gatedCredits,
      email_verification_required: true,
      reputation_score: 50,
      badge: "none",
      profile_url: `https://archtools.dev/api/v1/agents/${agent.id}`,
      message: `Welcome! Check your email to verify your address — your ${gatedCredits} free credits activate on verification. Your public profile is live.`,
      docs: "https://archtools.dev/agents",
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Agent register error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── PUT /api/v1/agents/profile ──────────────────────────────────────────────
// Update agent profile (authenticated account owner)
router.put("/profile", requireAuth, requireApiKeyAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
    return;
  }

  try {
    const {
      name,
      description,
      wallet_address,
      callback_url,
      is_public,
    } = req.body as {
      name?: string;
      description?: string;
      wallet_address?: string;
      callback_url?: string;
      is_public?: boolean;
    };

    // Validate wallet address if provided
    if (wallet_address !== undefined && wallet_address !== null && !/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
      res.status(400).json({
        ok: false,
        error: "invalid_request",
        message: "Invalid wallet address",
        request_id: reqId(),
      });
      return;
    }

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (wallet_address !== undefined) updateData.walletAddress = wallet_address;
    if (callback_url !== undefined) {
      if (callback_url !== null && callback_url !== "") {
        try {
          const parsed = new URL(callback_url);
          if (parsed.protocol !== "https:") {
            res.status(400).json({
              ok: false,
              error: "invalid_request",
              message: "Invalid callback URL — must use HTTPS",
              request_id: reqId(),
            });
            return;
          }
          await validateUrl(callback_url);
        } catch (e) {
          res.status(400).json({
            ok: false,
            error: "invalid_request",
            message: e instanceof Error ? e.message : "Invalid callback URL",
            request_id: reqId(),
          });
          return;
        }
      }
      updateData.callbackUrl = callback_url;
    }
    if (is_public !== undefined) updateData.isPublic = is_public;

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        description: true,
        walletAddress: true,
        callbackUrl: true,
        isPublic: true,
        reputationScore: true,
        badge: true,
      },
    });

    res.json({
      ok: true,
      agent: {
        agent_id: updated.id,
        name: updated.name,
        description: updated.description,
        wallet_address: updated.walletAddress,
        callback_url: updated.callbackUrl,
        is_public: updated.isPublic,
        reputation_score: updated.reputationScore,
        badge: updated.badge,
      },
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Agent profile update error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
