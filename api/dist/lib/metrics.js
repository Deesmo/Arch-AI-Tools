const byRoute = Object.create(null);
const byStatus = Object.create(null);
function routeKey(req) {
    // prefer express route path; fallback to originalUrl sans query
    const routePath = req.route?.path;
    const base = routePath ? routePath : req.path;
    return `${req.method} ${base}`;
}
function getMetric(key) {
    let m = byRoute[key];
    if (!m) {
        m = { count: 0, totalMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
        byRoute[key] = m;
    }
    return m;
}
/**
 * Lightweight in-memory metrics suitable for Render + small deployments.
 * For serious production, swap to Prometheus/OpenTelemetry exporter.
 */
export function metricsMiddleware(req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
        const ms = Date.now() - start;
        const key = routeKey(req);
        const m = getMetric(key);
        m.count += 1;
        m.totalMs += ms;
        m.minMs = Math.min(m.minMs, ms);
        m.maxMs = Math.max(m.maxMs, ms);
        const status = String(res.statusCode);
        byStatus[status] = (byStatus[status] || 0) + 1;
    });
    next();
}
export function getMetricsSnapshot() {
    const routes = Object.entries(byRoute)
        .map(([k, v]) => ({
        route: k,
        count: v.count,
        avg_ms: v.count ? Math.round((v.totalMs / v.count) * 10) / 10 : 0,
        min_ms: v.minMs === Number.POSITIVE_INFINITY ? 0 : v.minMs,
        max_ms: v.maxMs,
    }))
        .sort((a, b) => b.count - a.count);
    const statuses = Object.entries(byStatus)
        .map(([status, count]) => ({ status: Number(status), count }))
        .sort((a, b) => b.count - a.count);
    return {
        ok: true,
        service: "arch-tools-api",
        uptime_seconds: Math.floor(process.uptime()),
        routes,
        statuses,
    };
}
//# sourceMappingURL=metrics.js.map