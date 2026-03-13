/**
 * Redis client — used for x402 nonce deduplication and any future caching needs.
 * Requires REDIS_URL env var (e.g. rediss://user:pass@host:6380).
 * If REDIS_URL is not set the client is null and callers must handle gracefully.
 */
import Redis from "ioredis";
let redis = null;
if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
        lazyConnect: true,
    });
    redis.on("error", (err) => {
        // Log but don't crash — redis is required for x402 nonce dedup but not
        // for the core API (Stripe-only mode works without it).
        console.error("[redis] connection error:", err.message);
    });
}
export { redis };
//# sourceMappingURL=redis.js.map