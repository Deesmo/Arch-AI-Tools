/**
 * Facilitator-as-a-Service Routes
 *
 * Arch Tools becomes the x402 facilitator for other API providers.
 * Instead of running their own facilitator, providers register with us
 * and we handle payment verification + settlement.
 *
 * Endpoints:
 *   POST /api/v1/facilitator/verify     — Verify an x402 payment
 *   POST /api/v1/facilitator/settle     — Settle a verified payment on-chain
 *   POST /api/v1/facilitator/register   — Register as a provider
 *   GET  /api/v1/facilitator/dashboard  — Provider payment stats
 *   GET  /api/v1/facilitator/networks   — List supported networks
 *   GET  /api/v1/facilitator/health     — Health check
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=facilitator.d.ts.map