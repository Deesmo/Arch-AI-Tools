import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger.js";
import * as Sentry from "@sentry/node";
import { randomUUID } from "crypto";

export type ApiErrorCode =
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "validation_failed"
  | "tool_not_found"
  | "tool_disabled"
  | "insufficient_credits"
  | "rate_limited"
  | "internal_server_error"
  | "scrape_disabled"
  | "scrape_domain_not_allowed"
  | "invalid_url";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = (req.headers["x-request-id"] as string | undefined)?.trim();
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  (req as any).requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  // Map RFC RateLimit-* headers to legacy X-RateLimit-* for better DX.
  const _setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: any, value: any) => {
    try {
      const n = String(name);
      if (n.toLowerCase().startsWith("ratelimit-")) {
        const suffix = n.slice("RateLimit-".length);
        _setHeader(`X-RateLimit-${suffix}`, value as any);
      }
    } catch {}
    return _setHeader(name as any, value as any);
  }) as any;

  next();
}

export function ok(res: Response, body: Record<string, any>) {
  return res.json({ ok: true, ...(body || {}) });
}

export function fail(
  req: Request,
  res: Response,
  status: number,
  code: ApiErrorCode,
  detail?: string,
  extra?: Record<string, any>
) {
  return res.status(status).json({
    ok: false,
    error: code,
    detail,
    request_id: (req as any).requestId,
    ...(extra || {}),
  });
}

export function notFoundHandler(req: Request, res: Response) {
  return fail(req, res, 404, "not_found");
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  logger.error({ request_id: (req as any).requestId, error: err?.message, stack: err?.stack }, "Unhandled error");
  if (process.env.SENTRY_DSN) {
    // Capture to Sentry as a fallback; Sentry's Express error handler should also capture.
    Sentry.captureException(err);
  }
  return fail(req, res, 500, "internal_server_error");
}
