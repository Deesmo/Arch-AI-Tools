import type { NextFunction, Request, Response } from "express";

/**
 * Sets RateLimit-Policy (and via our header-mirroring also X-RateLimit-Policy).
 * Format: "<limit>;w=<window_seconds>" (commonly used draft format).
 */
export function setRateLimitPolicy(res: Response, limit: number, windowMs: number) {
  const w = Math.max(1, Math.round(windowMs / 1000));
  res.setHeader("RateLimit-Policy", `${limit};w=${w}`);
}

export function rateLimitPolicyMiddleware(limit: number, windowMs: number) {
  return (_req: Request, res: Response, next: NextFunction) => {
    setRateLimitPolicy(res, limit, windowMs);
    next();
  };
}
