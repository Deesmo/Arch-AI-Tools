import { redis } from "../lib/redis.js";
const recentMetrics = [];
const MAX_IN_MEMORY = 10_000;
// Counters for real-time dashboard
let totalCallsCounter = 0;
let totalRevenueUsdcCounter = 0;
// Track rate limit hits per agent (sliding 1-hour window)
const rateLimitHits = new Map();
// Track hourly call volumes per agent for spike detection
const hourlyVolumes = new Map();
// Active alerts
const activeAlerts = [];
const MAX_ALERTS = 500;
// Agents already flagged (avoid spam)
const flaggedAgents = new Map(); // agentId → last flagged timestamp
const FLAG_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown between duplicate alerts
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
            // ─── Usage Alerts Checks ─────────────────────────────────────
            if (agentId) {
                // Track rate limit violations (429 status)
                if (statusCode === 429) {
                    trackRateLimitHit(agentId);
                }
                // Track hourly volume for spike detection
                trackHourlyVolume(agentId);
            }
        }
        return originalEnd.apply(res, args);
    };
    next();
}
// ─── Usage Alert Tracking Functions ──────────────────────────────────────────
function trackRateLimitHit(agentId) {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    // Get or create hit list
    let hits = rateLimitHits.get(agentId) ?? [];
    // Prune old hits
    hits = hits.filter(t => t > oneHourAgo);
    hits.push(now);
    rateLimitHits.set(agentId, hits);
    // 3+ rate limit hits in an hour → flag for outreach
    if (hits.length >= 3) {
        addAlert({
            type: "rate_limit_repeat",
            agentId,
            message: `Agent ${agentId.slice(0, 8)}... hit rate limits ${hits.length} times in the last hour. Consider outreach for tier upgrade.`,
            severity: hits.length >= 10 ? "critical" : "warning",
            metadata: { hitCount: hits.length, windowMinutes: 60 },
        });
    }
}
function trackHourlyVolume(agentId) {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    let timestamps = hourlyVolumes.get(agentId) ?? [];
    timestamps = timestamps.filter(t => t > oneHourAgo);
    timestamps.push(now);
    hourlyVolumes.set(agentId, timestamps);
    // Calculate average hourly volume from recent metrics for this agent
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const agentMetrics24h = recentMetrics.filter(m => m.agentId === agentId && m.timestamp > twentyFourHoursAgo);
    const avgHourlyVolume = agentMetrics24h.length / 24;
    // If current hour volume is 10x the 24h average → traffic spike
    if (avgHourlyVolume > 5 && timestamps.length > avgHourlyVolume * 10) {
        addAlert({
            type: "traffic_spike",
            agentId,
            message: `Agent ${agentId.slice(0, 8)}... traffic spike: ${timestamps.length} calls/hr vs ${Math.round(avgHourlyVolume)} avg. Investigate for abuse or upsell opportunity.`,
            severity: "critical",
            metadata: {
                currentHourCalls: timestamps.length,
                averageHourlyCalls: Math.round(avgHourlyVolume),
                multiplier: Math.round(timestamps.length / avgHourlyVolume),
            },
        });
    }
}
/**
 * Check if an agent is near their credit limit.
 * Called externally (e.g., from credit deduction logic).
 */
export function checkCreditThreshold(agentId, creditsRemaining, totalCredits) {
    if (totalCredits <= 0)
        return;
    const usagePercent = ((totalCredits - creditsRemaining) / totalCredits) * 100;
    if (usagePercent >= 80) {
        addAlert({
            type: "low_credits",
            agentId,
            message: `Agent ${agentId.slice(0, 8)}... has used ${Math.round(usagePercent)}% of credits (${creditsRemaining} remaining). Send low-credit warning.`,
            severity: usagePercent >= 95 ? "critical" : "warning",
            metadata: {
                creditsRemaining,
                totalCredits,
                usagePercent: Math.round(usagePercent),
            },
        });
    }
}
function addAlert(params) {
    const now = Date.now();
    const lastFlagged = flaggedAgents.get(`${params.agentId}:${params.type}`);
    // Cooldown: don't spam the same alert type for the same agent
    if (lastFlagged && now - lastFlagged < FLAG_COOLDOWN_MS)
        return;
    const alert = {
        id: crypto.randomUUID(),
        timestamp: now,
        acknowledged: false,
        ...params,
    };
    activeAlerts.push(alert);
    if (activeAlerts.length > MAX_ALERTS) {
        activeAlerts.splice(0, activeAlerts.length - MAX_ALERTS);
    }
    flaggedAgents.set(`${params.agentId}:${params.type}`, now);
    // Also push to Redis if available (for persistence across restarts)
    if (redis) {
        void redis.lpush("arch:alerts:recent", JSON.stringify(alert)).catch(() => { });
        void redis.ltrim("arch:alerts:recent", 0, MAX_ALERTS - 1).catch(() => { });
    }
    console.log(`[ALERT] ${params.severity.toUpperCase()}: ${params.message}`);
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
// ─── Usage Alerts Getters ────────────────────────────────────────────────────
export function getActiveAlerts(limit = 50) {
    return activeAlerts
        .filter(a => !a.acknowledged)
        .slice(-limit)
        .reverse();
}
export function getAllAlerts(limit = 100) {
    return activeAlerts.slice(-limit).reverse();
}
export function acknowledgeAlert(alertId) {
    const alert = activeAlerts.find(a => a.id === alertId);
    if (alert) {
        alert.acknowledged = true;
        return true;
    }
    return false;
}
export function getAlertStats() {
    const byType = {};
    const bySeverity = {};
    let unacknowledged = 0;
    for (const alert of activeAlerts) {
        byType[alert.type] = (byType[alert.type] ?? 0) + 1;
        bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
        if (!alert.acknowledged)
            unacknowledged++;
    }
    return { total: activeAlerts.length, unacknowledged, byType, bySeverity };
}
export function getRateLimitViolators() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const result = [];
    for (const [agentId, hits] of rateLimitHits) {
        const recentHits = hits.filter(t => t > oneHourAgo);
        if (recentHits.length >= 3) {
            result.push({ agentId, hits: recentHits.length });
        }
    }
    return result.sort((a, b) => b.hits - a.hits);
}
// ─── Status Page Data ────────────────────────────────────────────────────────
// Track server start time for uptime calculation
export const SERVER_START_TIME = Date.now();
export function getStatusPageData() {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const recent = recentMetrics.filter(m => m.timestamp > twentyFourHoursAgo);
    const responseTimes = recent.map(m => m.responseMs).sort((a, b) => a - b);
    const totalCalls = recent.length;
    const errors = recent.filter(m => m.statusCode >= 400).length;
    const uniqueAgents = new Set(recent.filter(m => m.agentId).map(m => m.agentId)).size;
    const activeEndpoints = new Set(recent.map(m => m.endpoint)).size;
    const percentile = (arr, p) => {
        if (arr.length === 0)
            return 0;
        const idx = Math.ceil(arr.length * (p / 100)) - 1;
        return arr[Math.max(0, idx)];
    };
    return {
        uptime_seconds: Math.floor((now - SERVER_START_TIME) / 1000),
        avg_response_ms: totalCalls > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / totalCalls) : 0,
        p50_response_ms: percentile(responseTimes, 50),
        p95_response_ms: percentile(responseTimes, 95),
        p99_response_ms: percentile(responseTimes, 99),
        total_calls_24h: totalCalls,
        unique_agents_24h: uniqueAgents,
        error_rate_24h: totalCalls > 0 ? Math.round((errors / totalCalls) * 10000) / 100 : 0,
        active_endpoints: activeEndpoints,
    };
}
//# sourceMappingURL=analytics.js.map