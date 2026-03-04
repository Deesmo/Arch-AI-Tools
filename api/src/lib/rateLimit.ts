import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

// Cache limiter instances so they persist across requests (required for counting to work)
const cache = new Map<string, RateLimitRequestHandler>();

export function planRateConfig(plan: "free" | "pro" | "business") {
  const perMin =
    plan === "business" ? Number(process.env.RATE_LIMIT_BUSINESS || 1200) :
    plan === "pro" ? Number(process.env.RATE_LIMIT_PRO || 240) :
    Number(process.env.RATE_LIMIT_FREE || 60);
  return { limit: perMin, windowMs: 60_000 };
}

export function planLimiter(plan: "free" | "pro" | "business"): RateLimitRequestHandler {
  if (cache.has(plan)) return cache.get(plan)!;

  const { limit: perMin, windowMs } = planRateConfig(plan);

  const limiter = rateLimit({
    windowMs,
    max: perMin,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => req.agentId || req.ip,
  });

  cache.set(plan, limiter);
  return limiter;
}
