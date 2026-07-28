/**
 * Referral reward engine — the single place referral credits are granted.
 *
 * Flow (what the site advertises must match this exactly):
 *   1. Every account gets a shareable code (ARCH-xxxxxxxx) at signup.
 *   2. A referred user signs up, verifies their email, then calls
 *      POST /v1/referral/apply with the code.
 *   3. BOTH sides receive REFERRAL_REWARD credits in one transaction.
 *
 * Abuse guards (checked in order):
 *   - invalid_code        unknown code. Lookup is CASE-INSENSITIVE and
 *                         restricted to shareable rows (referredId = null):
 *                         codes are generated with lowercase hex but the old
 *                         route uppercased input before an exact-match lookup,
 *                         which made every legitimate code unusable — and the
 *                         null filter stops internal `referred-<id>` completion
 *                         records from being replayed as codes.
 *   - self_referral       your own code, or a code whose owner shares your
 *                         normalized email identity (gmail dots/+aliases
 *                         collapse) — blocks +alias self-farming.
 *   - email_not_verified  the referred account must verify email first.
 *   - already_referred    one referral bonus per account, enforced atomically
 *                         via the unique `referred-<id>` completion row.
 *   - referral_daily_cap  at most REFERRAL_DAILY_CAP rewarded referrals per
 *                         referrer per rolling 24h. Counted from the existing
 *                         Referral table (persisted — survives restarts, no
 *                         schema migration needed). Re-checked inside the
 *                         reward transaction under the referrer's row lock so
 *                         concurrent applies cannot race past the cap.
 */
import { prisma } from "./prisma.js";
import { normalizeEmailIdentity } from "./verification.js";

export const REFERRAL_REWARD = parseInt(process.env.REFERRAL_REWARD_CREDITS ?? "500", 10);
export const REFERRAL_DAILY_CAP = Math.max(
  1,
  parseInt(process.env.REFERRAL_DAILY_CAP ?? "10", 10) || 10
);

export type ApplyReferralError =
  | "invalid_code"
  | "self_referral"
  | "email_not_verified"
  | "already_referred"
  | "referral_daily_cap";

export type ApplyReferralResult =
  | { ok: true; reward: number; referrerId: string }
  | { ok: false; status: number; error: ApplyReferralError; message: string };

const DAILY_CAP_RESULT: ApplyReferralResult = {
  ok: false,
  status: 429,
  error: "referral_daily_cap",
  message: "This referral code has reached its daily reward limit. Try again tomorrow.",
};

// Internal sentinel: thrown inside the reward transaction to roll it back when
// the in-transaction cap re-check fails under concurrency.
class DailyCapExceeded extends Error {}

export async function applyReferralCode(agentId: string, rawCode: string): Promise<ApplyReferralResult> {
  const code = rawCode.trim();

  const referral = await prisma.referral.findFirst({
    where: { code: { equals: code, mode: "insensitive" }, referredId: null },
  });
  if (!referral) {
    return { ok: false, status: 404, error: "invalid_code", message: "Invalid referral code." };
  }

  if (referral.referrerId === agentId) {
    return { ok: false, status: 400, error: "self_referral", message: "You cannot use your own referral code." };
  }

  const [referred, referrer] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId }, select: { emailVerified: true, email: true } }),
    prisma.agent.findUnique({ where: { id: referral.referrerId }, select: { email: true } }),
  ]);

  // Anti-farming: the referred account must have a verified email before any
  // credits are granted. Unverified accounts hold almost no credits anyway.
  if (!referred?.emailVerified) {
    return { ok: false, status: 403, error: "email_not_verified", message: "Verify your email before applying a referral code." };
  }

  // Alias-farming guard: same normalized identity = same person, even when the
  // raw addresses differ (user+a@gmail.com vs u.ser@gmail.com).
  if (
    referred.email && referrer?.email &&
    normalizeEmailIdentity(referred.email) === normalizeEmailIdentity(referrer.email)
  ) {
    return { ok: false, status: 400, error: "self_referral", message: "The referrer and referred accounts must belong to different people." };
  }

  const alreadyReferred = await prisma.referral.findFirst({
    where: { referredId: agentId, status: "completed" },
  });
  if (alreadyReferred) {
    return { ok: false, status: 400, error: "already_referred", message: "You have already used a referral code." };
  }

  // Per-referrer rolling-24h reward cap. This pre-check fails fast without
  // taking locks; the authoritative re-check runs inside the transaction below.
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rewardedToday = await prisma.referral.count({
    where: { referrerId: referral.referrerId, status: "completed", completedAt: { gte: windowStart } },
  });
  if (rewardedToday >= REFERRAL_DAILY_CAP) {
    return DAILY_CAP_RESULT;
  }

  // Atomic single-use guard: the completion record's `code` is deterministic on
  // the referred user id (`referred-<id>`). `Referral.code` is unique, so two
  // concurrent applies cannot both insert — the loser hits P2002 and is treated
  // as already_referred. Crediting happens in the same transaction.
  try {
    await prisma.$transaction(async (tx) => {
      // Cap re-check under the referrer's row lock: crediting the referrer
      // first locks their Agent row, serializing concurrent applies for the
      // same referrer, so this count always sees prior committed rewards —
      // the lock-free pre-check alone could race past REFERRAL_DAILY_CAP.
      await tx.agent.update({
        where: { id: referral.referrerId },
        data: { credits: { increment: REFERRAL_REWARD } },
      });
      const rewardedInWindow = await tx.referral.count({
        where: { referrerId: referral.referrerId, status: "completed", completedAt: { gte: windowStart } },
      });
      if (rewardedInWindow >= REFERRAL_DAILY_CAP) {
        throw new DailyCapExceeded();
      }
      await tx.referral.create({
        data: {
          referrerId: referral.referrerId,
          referredId: agentId,
          code: `referred-${agentId}`,
          status: "completed",
          rewardCredits: REFERRAL_REWARD,
          completedAt: new Date(),
        },
      });
      await tx.agent.update({
        where: { id: agentId },
        data: { credits: { increment: REFERRAL_REWARD } },
      });
    });
  } catch (txErr) {
    if (txErr instanceof DailyCapExceeded) {
      return DAILY_CAP_RESULT;
    }
    if (txErr && typeof txErr === "object" && (txErr as { code?: string }).code === "P2002") {
      return { ok: false, status: 400, error: "already_referred", message: "You have already used a referral code." };
    }
    throw txErr;
  }

  return { ok: true, reward: REFERRAL_REWARD, referrerId: referral.referrerId };
}
