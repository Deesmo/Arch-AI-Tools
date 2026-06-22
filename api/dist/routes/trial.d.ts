/**
 * Free Trial System — v1
 *
 * Provides a lightweight trial activation endpoint that creates accounts
 * with a starter credit balance. When credits hit 0, the existing x402
 * payment middleware handles the payment-required flow automatically.
 *
 * The full registration (/v1/agent/register) already gives FREE_MONTHLY_CREDITS
 * (default 1000). This trial endpoint is for quick, minimal onboarding with
 * a configurable trial credit grant (default 250) — ideal for embedded signups, widget
 * integrations, and partner landing pages.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=trial.d.ts.map