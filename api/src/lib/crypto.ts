import crypto from "crypto";

function checksum6(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 6);
}

/**
 * Creates a new API key.
 * Format (preferred):
 *   arch_{live|test}_{random}_{chk}
 * Example:
 *   arch_live_AbC...xyz_a1b2c3
 *
 * Backward compatible: the auth layer validates by hash, so existing keys (e.g. at_sk_*) continue to work.
 */
export function newApiKey(): { raw: string; prefix: string; hash: string } {
  const mode =
    (process.env.ARCH_KEY_MODE && String(process.env.ARCH_KEY_MODE).toLowerCase()) ||
    (process.env.NODE_ENV === "production" ? "live" : "test");

  const random = crypto.randomBytes(32).toString("base64url");
  const base = `arch_${mode}_${random}`;
  const chk = checksum6(base);
  const raw = `${base}_${chk}`;

  // store a longer prefix so logs can disambiguate keys quickly
  const prefix = raw.slice(0, 22); // e.g. "arch_live_Ab3xYz9q..."

  const hash = hashApiKey(raw);
  return { raw, prefix, hash };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
