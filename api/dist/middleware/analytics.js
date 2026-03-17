import { redis } from "../lib/redis.js";
const recentMetrics = [];
const MAX_IN_MEMORY = 10_000;
// Counters for real-time dashboard
let totalCallsCounter = 0;
let totalRevenueUsdcCounter = 0;
// ─── Redis Keys ──────────────────────────────────────────────────────────────
const REDIS_PREFIX = "arch:analytics:";
const COUNTER_TTL = 90 * 24 * 60 * 60; // 90 days
async function incrRedis(key, amount = 1) {
    if (!redis)
        return;
    try {
        await redis.incrby(`${REDIS_PREFIX}${key}`, amount);
        await redis.expire(`${REDIS_PREFIX}${key}`, COUNTER_TTL);
    }
    catch {
        // Non-fatal — Redis counters are best-effort
    }
}
async function getRedisCounter(key) {
    if (!redis)
        return 0;
    try {
        const val = await redis.get(`${REDIS_PREFIX}${key}`);
        return val ? parseInt(val, 10) : 0;
    }
    catch {
        return 0;
    }
}
// ─── Analytics Middleware ─────────────────────────────────────────────────────
export function analyticsMiddleware(req, res, next) {
    const startTime = Date.now();
    // Capture original end to intercept response
    const originalEnd = res.end;
    const originalJson = res.json;
    let responseBody = null;
    // Intercept res.json to capture response size
    res.json = function (body) {
        responseBody = body;
        return originalJson.call(res, body);
    };
    // Intercept res.end to record timing
    res.end = function (...args) {
        const responseMs = Date.now() - startTime;
        const statusCode = res.statusCode;
        // Extract tool name from path
        const toolMatch = req.path.match(/\/v1\/tools\/([a-z0-9-]+)/);
        const toolName = toolMatch?.[1] ?? null;
        // Only track tool calls and API endpoints (skip static files)
        if (toolName || req.path.startsWith("/v1/") || req.path.startsWith("/api/")) {
            const isX402 = !!req.x402Paid;
            const agentId = req.agent?.id ?? null;
            const isAdmin = req.headers["x-admin-key"] || req.headers.authorization?.replace("Bearer ", "") === process.env.ADMIN_KEY;
            const paymentType = isAdmin
                ? "admin"
                : isX402
                    ? "x402"
                    : agentId
                        ? "credits"
                        : "free";
            const entry = {
                endpoint: req.path,
                toolName,
                method: req.method,
                statusCode,
                responseMs,
                timestamp: Date.now(),
                paymentType,
                agentId,
            };
            // Store in memory
            recentMetrics.push(entry);
            if (recentMetrics.length > MAX_IN_MEMORY) {
                recentMetrics.splice(0, recentMetrics.length - MAX_IN_MEMORY);
            }
            totalCallsCounter++;
            // Async Redis counters (fire-and-forget)
            const today = new Date().toISOString().slice(0, 10);
            const hour = new Date().toISOString().slice(0, 13);
            void incrRedis(`calls:total`, 1);
            void incrRedis(`calls:day:${today}`, 1);
            void incrRedis(`calls:hour:${hour}`, 1);
            if (toolName) {
                void incrRedis(`tool:${toolName}:calls`, 1);
                void incrRedis(`tool:${toolName}:day:${today}`, 1);
                void incrRedis(`tool:${toolName}:ms:total`, responseMs);
            }
            if (isX402) {
                void incrRedis(`x402:calls:total`, 1);
                void incrRedis(`x402:calls:day:${today}`, 1);
            }
            if (agentId) {
                void incrRedis(`agent:${agentId}:calls`, 1);
            }
        }
        return originalEnd.apply(res, args);
    };
    next();
}
// ─── Exported Getters for Analytics Routes ───────────────────────────────────
export function getRecentMetrics(limit = 100) {
    return recentMetrics.slice(-limit);
}
export function getMetricsSince(sinceMs) {
    return recentMetrics.filter(m => m.timestamp >= sinceMs);
}
export function getTotalCallsInMemory() {
    return totalCallsCounter;
}
export async function getRedisAnalytics() {
    if (!redis)
        return null;
    const today = new Date().toISOString().slice(0, 10);
    try {
        const [totalCalls, callsToday, x402Total, x402Today] = await Promise.all([
            getRedisCounter("calls:total"),
            getRedisCounter(`calls:day:${today}`),
            getRedisCounter("x402:calls:total"),
            getRedisCounter(`x402:calls:day:${today}`),
        ]);
        return { totalCalls, callsToday, x402CallsTotal: x402Total, x402CallsToday: x402Today };
    }
    catch {
        return null;
    }
}
export async function getToolRedisStats(toolName) {
    if (!redis)
        return null;
    const today = new Date().toISOString().slice(0, 10);
    try {
        const [calls, callsToday, msTotal] = await Promise.all([
            getRedisCounter(`tool:${toolName}:calls`),
            getRedisCounter(`tool:${toolName}:day:${today}`),
            getRedisCounter(`tool:${toolName}:ms:total`),
        ]);
        return {
            totalCalls: calls,
            callsToday,
            avgResponseMs: calls > 0 ? Math.round(msTotal / calls) : 0,
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=analytics.js.map