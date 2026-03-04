/**
 * Sets RateLimit-Policy (and via our header-mirroring also X-RateLimit-Policy).
 * Format: "<limit>;w=<window_seconds>" (commonly used draft format).
 */
export function setRateLimitPolicy(res, limit, windowMs) {
    const w = Math.max(1, Math.round(windowMs / 1000));
    res.setHeader("RateLimit-Policy", `${limit};w=${w}`);
}
export function rateLimitPolicyMiddleware(limit, windowMs) {
    return (_req, res, next) => {
        setRateLimitPolicy(res, limit, windowMs);
        next();
    };
}
//# sourceMappingURL=ratelimitPolicy.js.map