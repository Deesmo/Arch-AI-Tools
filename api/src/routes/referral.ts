import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { requireAccountAuth } from "../middleware/requireAccountAuth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { logger } from "../lib/logger.js";
import { applyReferralCode, REFERRAL_REWARD } from "../lib/referralReward.js";
import crypto from "crypto";

const router = Router();

// Generate a unique referral code for the user
function generateReferralCode(): string {
  return `ARCH-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── GET /api/v1/referral/code ──────────────────────────────────────────────
// Get (or create) the authenticated user's referral code
router.get("/code", requireAuth, requireAccountAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    // Check if user already has a referral code (as referrer with no referred yet = their code)
    let referral = await prisma.referral.findFirst({
      where: { referrerId: agent.id, referredId: null },
      orderBy: { createdAt: "desc" },
    });

    if (!referral) {
      // Create a new referral code for this user
      const code = generateReferralCode();
      referral = await prisma.referral.create({
        data: {
          referrerId: agent.id,
          code,
          status: "pending",
          rewardCredits: REFERRAL_REWARD,
        },
      });
    }

    const siteUrl = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");

    res.json({
      ok: true,
      code: referral.code,
      referral_link: `${siteUrl}/signup?ref=${referral.code}`,
      reward_credits: REFERRAL_REWARD,
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to get referral code");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── POST /api/v1/referral/apply ────────────────────────────────────────────
// Apply a referral code during/after signup. Rewards BOTH users.
router.post("/apply", requireAuth, requireAccountAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  const { code } = req.body ?? {};
  if (!code || typeof code !== "string") {
    res.status(400).json({ ok: false, error: "code_required", message: "Referral code is required.", request_id: reqId() });
    return;
  }

  try {
    // All validation + reward-granting lives in lib/referralReward.ts (tested
    // in api/tests/referral-reward.test.mjs).
    const result = await applyReferralCode(agent.id, code);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.error, message: result.message, request_id: reqId() });
      return;
    }

    logger.info({ referrerId: result.referrerId, referredId: agent.id, reward: result.reward }, "Referral completed");

    res.json({
      ok: true,
      message: `Referral applied! Both you and the referrer received ${result.reward} bonus credits.`,
      credits_earned: result.reward,
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to apply referral code");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/referral/stats ─────────────────────────────────────────────
// See your referral stats and earned credits
router.get("/stats", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    const completedReferrals = await prisma.referral.findMany({
      where: { referrerId: agent.id, status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { rewardCredits: true, completedAt: true },
    });

    const totalEarned = completedReferrals.reduce((sum, r) => sum + r.rewardCredits, 0);

    // Get user's referral code
    const myCode = await prisma.referral.findFirst({
      where: { referrerId: agent.id, referredId: null },
      select: { code: true },
    });

    res.json({
      ok: true,
      referral_code: myCode?.code ?? null,
      total_referrals: completedReferrals.length,
      total_credits_earned: totalEarned,
      reward_per_referral: REFERRAL_REWARD,
      referrals: completedReferrals.map(r => ({
        credits_earned: r.rewardCredits,
        completed_at: r.completedAt,
      })),
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to get referral stats");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/referral/leaderboard ───────────────────────────────────────
// Public leaderboard of top referrers
router.get("/leaderboard", async (_req: Request, res: Response): Promise<void> => {
  try {
    const leaders = await prisma.$queryRaw<{ referrer_id: string; name: string; total: number }[]>`
      SELECT r.referrer_id, COALESCE(a.name, CONCAT(LEFT(a.email, 3), '***')) as name, COUNT(*)::int as total
      FROM "Referral" r
      JOIN "Agent" a ON a.id = r.referrer_id
      WHERE r.status = 'completed'
      GROUP BY r.referrer_id, a.name, a.email
      ORDER BY total DESC
      LIMIT 10
    `;

    res.json({
      ok: true,
      leaderboard: leaders.map((l, i) => ({
        rank: i + 1,
        name: l.name,
        referrals: l.total,
        credits_earned: l.total * REFERRAL_REWARD,
      })),
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to get referral leaderboard");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
