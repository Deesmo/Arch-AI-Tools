/**
 * Three-way request status classification (2026-07-26).
 *
 *   SUCCESS       — statusCode < 400: the call did what the caller asked.
 *   CLIENT_ERROR  — 400–499: a caller condition (bad input 400, out of
 *                   credits 402, not found 404, rate limited 429). The
 *                   platform and its providers worked correctly.
 *   ERROR         — >= 500: a real platform/upstream failure.
 *
 * Previously anything >= 400 was recorded as ERROR, which made caller
 * conditions read as "the platform is broken" — some tools showed 50–70%
 * "error" rates while their providers were fully healthy. Consumers that
 * filter status="ERROR" now see genuine platform errors only.
 */

export type RequestStatus = "SUCCESS" | "CLIENT_ERROR" | "ERROR";

/**
 * Classify an HTTP status code into the three-way request status.
 * A missing/invalid code means the request failed before a response was
 * produced — that is a platform failure, so it classifies as ERROR.
 */
export function classifyStatus(statusCode: number | null | undefined): RequestStatus {
  if (statusCode == null || !Number.isFinite(statusCode)) return "ERROR";
  if (statusCode >= 500) return "ERROR";
  if (statusCode >= 400) return "CLIENT_ERROR";
  return "SUCCESS";
}

/** True only for real platform/upstream failures (HTTP >= 500). */
export function isPlatformError(statusCode: number): boolean {
  return statusCode >= 500;
}

/** True for caller conditions (HTTP 400–499). */
export function isClientError(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500;
}
