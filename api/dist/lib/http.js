import { logger } from "./logger.js";
import * as Sentry from "@sentry/node";
import { randomUUID } from "crypto";
export function requestIdMiddleware(req, res, next) {
    const incoming = req.headers["x-request-id"]?.trim();
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    // Map RFC RateLimit-* headers to legacy X-RateLimit-* for better DX.
    const _setHeader = res.setHeader.bind(res);
    res.setHeader = ((name, value) => {
        try {
            const n = String(name);
            if (n.toLowerCase().startsWith("ratelimit-")) {
                const suffix = n.slice("RateLimit-".length);
                _setHeader(`X-RateLimit-${suffix}`, value);
            }
        }
        catch { }
        return _setHeader(name, value);
    });
    next();
}
export function ok(res, body) {
    return res.json({ ok: true, ...(body || {}) });
}
export function fail(req, res, status, code, detail, extra) {
    return res.status(status).json({
        ok: false,
        error: code,
        detail,
        request_id: req.requestId,
        ...(extra || {}),
    });
}
export function notFoundHandler(req, res) {
    return fail(req, res, 404, "not_found");
}
export function errorHandler(err, req, res, _next) {
    logger.error({ request_id: req.requestId, error: err?.message, stack: err?.stack }, "Unhandled error");
    if (process.env.SENTRY_DSN) {
        // Capture to Sentry as a fallback; Sentry's Express error handler should also capture.
        Sentry.captureException(err);
    }
    return fail(req, res, 500, "internal_server_error");
}
//# sourceMappingURL=http.js.map