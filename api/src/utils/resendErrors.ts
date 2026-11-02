/**
 * Map a failed Resend send to the status the email-send caller should get (2026-11-02).
 *
 * Resend's error classes (https://resend.com/docs/api-reference/errors):
 *   400 / 409 / 422 — the request itself is wrong (invalid field, a recipient Resend
 *                     refuses such as example.com, idempotency clash) → the caller's
 *                     input, so a 400 carrying Resend's reason.
 *   429             — Resend quota / rate limit → 429, retry later.
 *   401 / 403 / 5xx — our API key, sending domain or Resend itself → a real platform
 *                     failure, 503 (not 502: Cloudflare replaces origin 502 bodies
 *                     with its own HTML page, hiding this JSON).
 *
 * Every failure used to surface as 502, so callers' bad recipients read as
 * ArchTools outages (all 7 of the customer email-send "server errors" on record).
 */
export interface ResendFailure {
  status: number;
  error: "invalid_request" | "provider_rate_limited" | "send_error";
  message: string;
}

export function mapResendFailure(resendStatus: number, resendMessage?: string): ResendFailure {
  const message = resendMessage || `Resend returned ${resendStatus}`;
  if (resendStatus === 400 || resendStatus === 409 || resendStatus === 422) {
    return { status: 400, error: "invalid_request", message };
  }
  if (resendStatus === 429) {
    return { status: 429, error: "provider_rate_limited", message: "Email provider rate limit reached — retry shortly." };
  }
  return { status: 503, error: "send_error", message };
}
