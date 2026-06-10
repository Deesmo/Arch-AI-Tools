/**
 * Email verification gate (2026-06-10 pricing update).
 *
 * New signups receive credits as `pendingCredits` (credits = 0) until they
 * verify their email via GET /v1/verify-email?token=...
 * Existing accounts were backfilled as verified — no clawback.
 */
import crypto from "crypto";
import { prisma } from "./prisma.js";
import { sendVerificationEmail } from "../services/email.js";
import { logger } from "./logger.js";

export const SIGNUP_FREE_CREDITS = parseInt(
  process.env.SIGNUP_FREE_CREDITS ?? "100",
  10
);

const VERIFY_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Common disposable-email domains — block at signup.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com",
  "tempmail.dev", "tempmailo.com", "throwawaymail.com", "yopmail.com",
  "yopmail.net", "getnada.com", "nada.email", "maildrop.cc", "mailnesia.com",
  "trashmail.com", "trashmail.de", "dispostable.com", "fakeinbox.com",
  "mintemail.com", "mohmal.com", "mytemp.email", "tempinbox.com",
  "spamgourmet.com", "mailcatch.com", "inboxkitten.com", "emailondeck.com",
  "burnermail.io", "33mail.com", "spambox.us", "mailsac.com", "tmpmail.org",
  "tmpmail.net", "tmail.ws", "moakt.com", "tempr.email", "discard.email",
  "mail-temp.com", "luxusmail.org", "instaddr.ch", "anonbox.net",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

// ─── Free-credit farming protection (2026-06-10) ─────────────────────────

const SIGNUP_MAX_PER_EMAIL = parseInt(process.env.SIGNUP_MAX_PER_EMAIL ?? "1", 10);
const SIGNUP_MAX_PER_IP_PER_DAY = parseInt(process.env.SIGNUP_MAX_PER_IP_PER_DAY ?? "5", 10);

/**
 * Normalize an email to a canonical identity for grant-eligibility checks:
 * - lowercase + trim
 * - strip +alias from the local part (user+x@d → user@d)
 * - for gmail/googlemail: strip dots in the local part and canonicalize
 *   the domain to gmail.com (u.s.e.r@googlemail → user@gmail.com)
 */
export function normalizeEmailIdentity(email: string): string {
  const lowered = email.toLowerCase().trim();
  const at = lowered.lastIndexOf("@");
  if (at < 0) return lowered;
  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

// Per-IP signup counter (in-process, daily window). Conservative blast-radius
// limiter; resets on deploy/restart which is acceptable for abuse throttling.
const ipSignupCounts = new Map<string, { day: string; count: number }>();

/**
 * Enforce signup/free-grant limits. Returns null if the signup is allowed,
 * or an error descriptor { status, error, message } if it must be blocked.
 * Does NOT block a first legitimate signup.
 */
export async function enforceSignupLimits(
  email: string,
  ip: string | undefined
): Promise<{ status: number; error: string; message: string } | null> {
  // 1. Per-normalized-email cap: collapse +aliases and gmail dot-variants so
  //    user+1@gmail.com and u.s.e.r@gmail.com count as the same identity.
  const normalized = normalizeEmailIdentity(email);
  try {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "Agent"
      WHERE (
        CASE WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com')
          THEN replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') || '@gmail.com'
          ELSE split_part(split_part(lower(email), '@', 1), '+', 1) || '@' || lower(split_part(email, '@', 2))
        END
      ) = ${normalized}`;
    const existingCount = Number(rows[0]?.count ?? 0);
    if (existingCount >= SIGNUP_MAX_PER_EMAIL) {
      return {
        status: 409,
        error: "email_exists",
        message: "An account already exists for this email identity. Use your existing API key or log in.",
      };
    }
  } catch (e) {
    // Fail-open on the normalized check (the exact-email uniqueness check in the
    // route still applies) — log so we can see if the raw query ever breaks.
    logger.warn({ error: String(e) }, "Normalized-email signup check failed (falling back to exact match only)");
  }

  // 2. Per-IP daily signup cap.
  if (ip) {
    const day = new Date().toISOString().slice(0, 10);
    const entry = ipSignupCounts.get(ip);
    const count = entry && entry.day === day ? entry.count : 0;
    if (count >= SIGNUP_MAX_PER_IP_PER_DAY) {
      return {
        status: 429,
        error: "signup_rate_limited",
        message: "Too many signups from this network today. Please try again tomorrow or contact support.",
      };
    }
    ipSignupCounts.set(ip, { day, count: count + 1 });
    // Opportunistic cleanup to bound memory
    if (ipSignupCounts.size > 10000) {
      for (const [k, v] of ipSignupCounts) {
        if (v.day !== day) ipSignupCounts.delete(k);
      }
    }
  }

  return null;
}

/**
 * Set up the verification gate for a freshly-created agent:
 * moves `creditsToGate` into pendingCredits, issues a token, sends the email.
 * Non-fatal on email failure (token can be re-issued via /v1/verify-email/resend).
 */
export async function issueEmailVerification(
  agentId: string,
  email: string,
  creditsToGate: number
): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      credits: 0,
      pendingCredits: creditsToGate,
      emailVerified: false,
      verifyToken: token,
      verifyTokenExpiry: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    },
  });
  const verifyUrl = `https://archtools.dev/v1/agent/verify-email?token=${token}`;
  sendVerificationEmail({ to: email, verifyUrl }).catch((e) => {
    logger.warn({ agentId, error: String(e) }, "Verification email send failed");
  });
}

/**
 * Verify a token. Returns the credits activated, or null if invalid/expired.
 */
export async function verifyEmailToken(token: string): Promise<{ email: string; creditsActivated: number } | null> {
  if (!token || token.length < 32) return null;
  const agent = await prisma.agent.findFirst({
    where: { verifyToken: token },
    select: { id: true, email: true, emailVerified: true, pendingCredits: true, verifyTokenExpiry: true },
  });
  if (!agent) return null;
  if (agent.verifyTokenExpiry && agent.verifyTokenExpiry < new Date()) return null;

  const creditsActivated = agent.pendingCredits;
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      emailVerified: true,
      verifyToken: null,
      verifyTokenExpiry: null,
      pendingCredits: 0,
      credits: { increment: creditsActivated },
    },
  });
  logger.info({ agentId: agent.id, creditsActivated }, "Email verified — credits activated");
  return { email: agent.email, creditsActivated };
}
