/**
 * Affiliate Tracking System — v1
 *
 * Extends the existing referral system with affiliate-specific features:
 * - GET /v1/affiliate/link — returns the user's referral/affiliate link
 * - POST /v1/affiliate/track — records referral link clicks (public, no auth)
 * - GET /v1/affiliate/stats — detailed affiliate performance metrics
 *
 * Uses the existing Referral model in Prisma — no migration needed.
 * Click tracking is done via Redis (fast, no schema change) with
 * a fallback to in-memory tracking if Redis is unavailable.
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { logger } from "../lib/logger.js";
import { REFERRAL_REWARD } from "../lib/referralReward.js";
import crypto from "crypto";

const router = Router();

// Public click-tracking is unauthenticated — rate-limit per IP to stop metric
// inflation / spam (R-5).
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { ok: false, error: "rate_limited", message: "Too many requests." },
});

const SITE_URL = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");

// In-memory click tracking fallback (when Redis is unavailable)
const clickStore = new Map<string, { clicks: number; lastClick: string; ips: Set<string> }>();

// ─── GET /v1/affiliate/link ─────────────────────────────────────────────────
// Returns the authenticated user's affiliate/referral link
router.get("/link", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    // Look for existing referral code (unused = the user's shareable code)
    let referral = await prisma.referral.findFirst({
      where: { referrerId: agent.id, referredId: null },
      orderBy: { createdAt: "desc" },
    });

    if (!referral) {
      // Create one
      const code = `ARCH-${crypto.randomBytes(4).toString("hex")}`;
      referral = await prisma.referral.create({
        data: {
          referrerId: agent.id,
          code,
          status: "pending",
          rewardCredits: REFERRAL_REWARD,
        },
      });
    }

    // Get click count from Redis or memory
    let totalClicks = 0;
    let uniqueClicks = 0;
    if (redis) {
      totalClicks = parseInt(await redis.get(`aff:clicks:${referral.code}`) ?? "0", 10);
      uniqueClicks = await redis.scard(`aff:uniq:${referral.code}`);
    } else {
      const mem = clickStore.get(referral.code);
      if (mem) {
        totalClicks = mem.clicks;
        uniqueClicks = mem.ips.size;
      }
    }

    // Count completed referrals
    const completedCount = await prisma.referral.count({
      where: { referrerId: agent.id, status: "completed" },
    });

    res.json({
      ok: true,
      affiliate_code: referral.code,
      affiliate_link: `${SITE_URL}/signup?ref=${referral.code}`,
      reward_per_referral: REFERRAL_REWARD,
      stats: {
        total_clicks: totalClicks,
        unique_clicks: uniqueClicks,
        conversions: completedCount,
        total_earned: completedCount * REFERRAL_REWARD,
      },
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to get affiliate link");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── POST /v1/affiliate/track ───────────────────────────────────────────────
// Records when someone clicks a referral/affiliate link. Public endpoint (no auth).
// Called by the signup page JS when ?ref= param is present.
router.post("/track", trackLimiter, async (req: Request, res: Response): Promise<void> => {
  const { code, referrer_url, user_agent } = req.body ?? {};

  if (!code || typeof code !== "string") {
    res.status(400).json({ ok: false, error: "code_required", message: "Affiliate code is required.", request_id: reqId() });
    return;
  }

  try {
    // Verify the code exists. Case-insensitive: codes are generated with
    // lowercase hex, but links/emails may uppercase them in transit. The old
    // exact-match on an UPPERCASED input never matched a real code, so no
    // click was ever recorded.
    const referral = await prisma.referral.findFirst({
      where: { code: { equals: code.trim(), mode: "insensitive" }, referredId: null },
    });

    if (!referral) {
      // Still return 200 — don't leak whether codes exist
      res.json({ ok: true, tracked: false, request_id: reqId() });
      return;
    }

    // Key metrics by the CANONICAL stored code — /link and /stats read
    // `aff:*:${referral.code}`, so writes must use the same casing.
    const normalizedCode = referral.code;

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";

    // Track click in Redis (preferred) or memory
    if (redis) {
      await Promise.all([
        redis.incr(`aff:clicks:${normalizedCode}`),
        redis.sadd(`aff:uniq:${normalizedCode}`, ip),
        // Store last 100 click events for analytics
        redis.lpush(`aff:events:${normalizedCode}`, JSON.stringify({
          ip: ip.slice(0, -3) + "xxx", // Partially anonymize IP
          referrer_url: referrer_url ?? null,
          user_agent: (user_agent ?? req.headers["user-agent"] ?? "").slice(0, 200),
          timestamp: new Date().toISOString(),
        })),
        redis.ltrim(`aff:events:${normalizedCode}`, 0, 99),
        // Expire after 90 days
        redis.expire(`aff:clicks:${normalizedCode}`, 90 * 86400),
        redis.expire(`aff:uniq:${normalizedCode}`, 90 * 86400),
        redis.expire(`aff:events:${normalizedCode}`, 90 * 86400),
      ]);
    } else {
      // In-memory fallback
      const existing = clickStore.get(normalizedCode) ?? { clicks: 0, lastClick: "", ips: new Set<string>() };
      existing.clicks++;
      existing.lastClick = new Date().toISOString();
      existing.ips.add(ip);
      clickStore.set(normalizedCode, existing);
    }

    logger.info({ code: normalizedCode, ip: ip.slice(0, -3) + "xxx" }, "Affiliate click tracked");

    res.json({ ok: true, tracked: true, request_id: reqId() });
  } catch (e) {
    logger.error({ error: e }, "Failed to track affiliate click");
    // Non-fatal — still return 200 to not break the frontend
    res.json({ ok: true, tracked: false, request_id: reqId() });
  }
});

// ─── GET /v1/affiliate/stats ────────────────────────────────────────────────
// Detailed affiliate performance metrics for the authenticated user
router.get("/stats", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    // Get referral code
    const myReferral = await prisma.referral.findFirst({
      where: { referrerId: agent.id, referredId: null },
      select: { code: true },
    });

    // Get all completed referrals
    const completedReferrals = await prisma.referral.findMany({
      where: { referrerId: agent.id, status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { rewardCredits: true, completedAt: true },
    });

    const totalEarned = completedReferrals.reduce((sum, r) => sum + r.rewardCredits, 0);

    // Click data
    let totalClicks = 0;
    let uniqueClicks = 0;
    let recentEvents: string[] = [];

    if (myReferral?.code) {
      if (redis) {
        totalClicks = parseInt(await redis.get(`aff:clicks:${myReferral.code}`) ?? "0", 10);
        uniqueClicks = await redis.scard(`aff:uniq:${myReferral.code}`);
        recentEvents = await redis.lrange(`aff:events:${myReferral.code}`, 0, 9);
      } else {
        const mem = clickStore.get(myReferral.code);
        if (mem) {
          totalClicks = mem.clicks;
          uniqueClicks = mem.ips.size;
        }
      }
    }

    const conversionRate = totalClicks > 0
      ? ((completedReferrals.length / totalClicks) * 100).toFixed(1)
      : "0.0";

    res.json({
      ok: true,
      affiliate_code: myReferral?.code ?? null,
      affiliate_link: myReferral?.code ? `${SITE_URL}/signup?ref=${myReferral.code}` : null,
      performance: {
        total_clicks: totalClicks,
        unique_clicks: uniqueClicks,
        conversions: completedReferrals.length,
        conversion_rate: `${conversionRate}%`,
        total_credits_earned: totalEarned,
        reward_per_referral: REFERRAL_REWARD,
      },
      recent_conversions: completedReferrals.slice(0, 10).map(r => ({
        credits_earned: r.rewardCredits,
        completed_at: r.completedAt,
      })),
      recent_clicks: recentEvents.map(e => {
        try { return JSON.parse(e); } catch { return null; }
      }).filter(Boolean),
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to get affiliate stats");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
