/**
 * Affiliate Tracking System — v1
 *
 * Extends the existing referral system with affiliate-specific features:
 * - GET /v1/affiliate/link — returns the user's referral/affiliate link
 * - POST /v1/affiliate/track — records referral link clicks (public, no auth)
 * - GET /v1/affiliate/stats — detailed affiliate performance metrics
 *
 * Uses the existing Referral model in Prisma — no migration needed.
 * Click tracking is done via Redis (fast, no schema change) with
 * a fallback to in-memory tracking if Redis is unavailable.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=affiliate.d.ts.map