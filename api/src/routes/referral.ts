import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireApiKeyAuth, requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { logger } from "../lib/logger.js";
import crypto from "crypto";

const router = Router();

const REFERRAL_REWARD = parseInt(process.env.REFERRAL_REWARD_CREDITS ?? "500", 10);

// Generate a unique referral code for the user
function generateReferralCode(): string {
  return `ARCH-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── GET /api/v1/referral/code ──────────────────────────────────────────────
// Get (or create) the authenticated user's referral code
router.get("/code", requireAuth, requireApiKeyAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
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
router.post("/apply", requireAuth, requireApiKeyAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  const { code } = req.body ?? {};
  if (!code || typeof code !== "string") {
    res.status(400).json({ ok: false, error: "code_required", message: "Referral code is required.", request_id: reqId() });
    return;
  }

  try {
    // Find the referral code
    const referral = await prisma.referral.findUnique({ where: { code: code.toUpperCase().trim() } });
    if (!referral) {
      res.status(404).json({ ok: false, error: "invalid_code", message: "Invalid referral code.", request_id: reqId() });
      return;
    }

    // Can't refer yourself
    if (referral.referrerId === agent.id) {
      res.status(400).json({ ok: false, error: "self_referral", message: "You cannot use your own referral code.", request_id: reqId() });
      return;
    }

    // Anti-farming: the referred account must have a verified email before any
    // credits are granted. Unverified accounts hold 0 credits anyway.
    const referredAgent = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { emailVerified: true },
    });
    if (!referredAgent?.emailVerified) {
      res.status(403).json({ ok: false, error: "email_not_verified", message: "Verify your email before applying a referral code.", request_id: reqId() });
      return;
    }

    // Check if this user has already used a referral code
    const alreadyReferred = await prisma.referral.findFirst({
      where: { referredId: agent.id, status: "completed" },
    });
    if (alreadyReferred) {
      res.status(400).json({ ok: false, error: "already_referred", message: "You have already used a referral code.", request_id: reqId() });
      return;
    }

    // Atomic single-use guard: the completion record's `code` is deterministic on
    // the referred user id (`referred-<id>`). `Referral.code` is unique, so two
    // concurrent /apply calls cannot both insert — the loser hits P2002 and is
    // treated as already_referred. Crediting happens in the same transaction.
    try {
      await prisma.$transaction([
        prisma.referral.create({
          data: {
            referrerId: referral.referrerId,
            referredId: agent.id,
            code: `referred-${agent.id}`,
            status: "completed",
            rewardCredits: REFERRAL_REWARD,
            completedAt: new Date(),
          },
        }),
        prisma.agent.update({
          where: { id: referral.referrerId },
          data: { credits: { increment: REFERRAL_REWARD } },
        }),
        prisma.agent.update({
          where: { id: agent.id },
          data: { credits: { increment: REFERRAL_REWARD } },
        }),
      ]);
    } catch (txErr) {
      if (txErr && typeof txErr === "object" && (txErr as { code?: string }).code === "P2002") {
        res.status(400).json({ ok: false, error: "already_referred", message: "You have already used a referral code.", request_id: reqId() });
        return;
      }
      throw txErr;
    }

    logger.info({ referrerId: referral.referrerId, referredId: agent.id, reward: REFERRAL_REWARD }, "Referral completed");

    res.json({
      ok: true,
      message: `Referral applied! Both you and the referrer received ${REFERRAL_REWARD} bonus credits.`,
      credits_earned: REFERRAL_REWARD,
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
