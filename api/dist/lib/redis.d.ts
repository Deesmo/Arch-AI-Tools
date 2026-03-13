/**
 * Redis client — used for x402 nonce deduplication and any future caching needs.
 * Requires REDIS_URL env var (e.g. rediss://user:pass@host:6380).
 * If REDIS_URL is not set the client is null and callers must handle gracefully.
 */
import Redis from "ioredis";
declare let redis: Redis | null;
export { redis };
//# sourceMappingURL=redis.d.ts.map