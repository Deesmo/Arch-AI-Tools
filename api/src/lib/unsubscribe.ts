/**
 * Unsubscribe token — signed, stateless, no auth required (CAN-SPAM one-click).
 *
 * Format: base64url(agentId) + "." + base64url(HMAC-SHA256(payload, secret))
 *
 * Properties:
 *  - Stateless: nothing stored in the DB, so links in already-sent email keep
 *    working forever (CAN-SPAM requires the mechanism to work for at least
 *    30 days after send — no expiry is the safe choice).
 *  - Scope-limited: the token can ONLY opt an account out of marketing email.
 *    It exposes no data and grants no other action, so a leaked token's worst
 *    case is an unwanted unsubscribe.
 *  - Secret: UNSUBSCRIBE_SECRET if set, else JWT_SECRET (already required at
 *    server startup — see routes/auth.ts). Read at call time so one-off jobs
 *    and tests can set env before use.
 */
import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!s) {
    throw new Error("UNSUBSCRIBE_SECRET or JWT_SECRET must be set to sign/verify unsubscribe tokens");
  }
  return s;
}

function mac(payload: string): Buffer {
  return createHmac("sha256", getSecret()).update(payload).digest();
}

/** Create a signed unsubscribe token for an agent id. */
export function signUnsubscribeToken(agentId: string): string {
  if (!agentId) throw new Error("agentId required");
  const payload = Buffer.from(agentId, "utf8").toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}

/**
 * Verify a token and return the agent id it was issued for, or null if the
 * token is missing/malformed/tampered. Constant-time signature comparison.
 */
export function verifyUnsubscribeToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== "string" || token.length > 512) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const agentId = Buffer.from(payload, "base64url").toString("utf8");
    return agentId || null;
  } catch {
    return null;
  }
}

/** Absolute unsubscribe URL for an agent (used in email bodies + headers). */
export function unsubscribeUrl(agentId: string): string {
  const site = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
  return `${site}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(agentId))}`;
}
