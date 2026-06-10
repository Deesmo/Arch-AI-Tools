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
