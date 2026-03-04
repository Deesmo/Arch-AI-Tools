/**
 * Cloudflare Turnstile CAPTCHA verification
 *
 * Setup (free — no puzzle UX for users):
 *   1. Go to dash.cloudflare.com → Turnstile → Add site
 *   2. Domain: archtools.dev
 *   3. Widget type: "Invisible" (zero friction for devs using the API directly)
 *      or "Managed" if you add a web signup form later
 *   4. Copy Site Key → use in frontend / docs signup form
 *   5. Copy Secret Key → set as TURNSTILE_SECRET_KEY env var on Render
 *
 * If TURNSTILE_SECRET_KEY is not set, verification is skipped (dev mode).
 * This lets you test registration locally without a captcha token.
 *
 * Frontend integration:
 *   <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script>
 *   <div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>
 *   // Token lands in cf-turnstile-response hidden field or via callback
 */

import { logger } from "./logger.js";

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || "";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  error?: string;
}

/**
 * Verifies a Turnstile token submitted by the client.
 * Returns { success: true } if valid, or { success: false, error } if not.
 *
 * Pass the visitor's IP for extra validation (optional but recommended).
 */
export async function verifyTurnstile(token: string, ip?: string): Promise<TurnstileResult> {
  // Dev mode: skip if secret not configured
  if (!TURNSTILE_SECRET) {
    logger.debug("Turnstile skipped — TURNSTILE_SECRET_KEY not set (dev mode)");
    return { success: true };
  }

  if (!token || typeof token !== "string" || token.length < 10) {
    return { success: false, error: "missing_captcha_token" };
  }

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });

    const resp = await fetch(TURNSTILE_URL, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const data = (await resp.json()) as any;

    if (!data.success) {
      logger.warn({ codes: data["error-codes"] }, "Turnstile verification failed");
      return { success: false, error: "captcha_failed" };
    }

    return { success: true };
  } catch (e: any) {
    // If Turnstile is down, fail open (don't block signups)
    logger.error({ error: e.message }, "Turnstile API error — failing open");
    return { success: true };
  }
}
