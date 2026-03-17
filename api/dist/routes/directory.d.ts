/**
 * x402 Service Directory — v1.0
 *
 * A catalog of all known x402-compatible services. Makes Arch Tools the
 * go-to discovery point for agents looking for x402 APIs.
 *
 * Endpoints:
 *   GET  /api/v1/x402/directory          — Full catalog
 *   GET  /api/v1/x402/directory/search   — Search/filter by category, chain, price
 *   POST /api/v1/x402/directory/submit   — Submit a new service (pending approval)
 *   GET  /api/v1/x402/directory/stats    — Aggregate stats
 *   GET  /api/v1/x402/directory/:id      — Single service detail
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=directory.d.ts.map