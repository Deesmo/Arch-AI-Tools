import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { DISCOVERY_LINKS } from "../utils/discoveryLinks.js";
import { verifySession } from "../lib/session.js";

export interface AuthedRequest extends Request {
  agent?: {
    id: string;
    apiKey: string;
    email: string;
    credits: number;
    tier: string;
    totalCalls: number;
    // OAuth scope string (space-separated) when authenticated via an OAuth
    // access token; undefined for full-access API-key auth.
    scope?: string;
  };
}

interface SessionOptInRequest extends Request {
  allowSessionAuth?: boolean;
}

/**
 * Opt-in for the signed-in dashboard: lets the routes it is mounted on accept
 * the arch_session cookie when no API key is sent. Keys are stored only as a
 * hash, so after sign-in the browser never holds the full key. Mount it on the
 * specific account routes the dashboard calls — never on tool routes.
 */
export function allowSessionAuth(req: Request, _res: Response, next: NextFunction): void {
  (req as SessionOptInRequest).allowSessionAuth = true;
  next();
}

/** The request's Origin is this site (blocks cross-site form posts riding the cookie). */
export function isSameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

async function agentFromSession(req: Request) {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.arch_session;
  if (!token) return null;
  // Reads ride SameSite=lax (no cookie on cross-site fetches); anything that
  // changes state must also come from our own pages.
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) return null;
  const payload = verifySession(token);
  if (!payload) return null;
  return prisma.agent.findUnique({ where: { id: payload.sub } });
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip auth if x402 payment was already verified
  if ((req as any).x402Paid) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const xApiKey = req.headers["x-api-key"] as string | undefined;

  if (!authHeader?.startsWith("Bearer ") && !xApiKey) {
    if ((req as SessionOptInRequest).allowSessionAuth) {
      const sessionAgent = await agentFromSession(req).catch(() => null);
      if (sessionAgent) {
        // A signed-in browser has no API key (only its hash is stored), so
        // apiKey stays empty; scope stays undefined = full account access.
        req.agent = {
          id: sessionAgent.id,
          apiKey: "",
          email: sessionAgent.email,
          credits: sessionAgent.credits,
          tier: sessionAgent.tier,
          totalCalls: sessionAgent.totalCalls,
        };
        next();
        return;
      }
    }

    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Missing Authorization: Bearer <api_key> header or x-api-key header",
      request_id: req.headers["x-request-id"] ?? crypto.randomUUID(),
      // Namespaced discovery hints for agents with no credential yet —
      // additive body field only (no auth-relevant header/shape changes).
      links: DISCOVERY_LINKS,
    });
    return;
  }

  const apiKey = (xApiKey ?? authHeader!.slice(7)).trim();
  if (!apiKey) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Empty API key",
      request_id: crypto.randomUUID(),
    });
    return;
  }

  try {
    let agent = null;
    let oauthScope: string | undefined;

    // OAuth Bearer token (prefix: at_oauth_) — check OAuthToken table first
    if (apiKey.startsWith("at_oauth_")) {
      const oauthToken = await prisma.oAuthToken.findUnique({ where: { accessToken: apiKey } }).catch(() => null);
      if (oauthToken && oauthToken.expiresAt > new Date()) {
        agent = await prisma.agent.findUnique({ where: { id: oauthToken.agentId } });
        oauthScope = oauthToken.scope;
      }
    } else {
      // Standard API key — plaintext keys are no longer stored. Lookup by the
      // first 12-char prefix (fast indexed scan), then bcrypt.compare the full
      // key. Multiple accounts CAN share a 12-char prefix; findFirst would only
      // ever check one, silently locking out every other holder of a colliding
      // prefix. Check ALL candidates so the real key always authenticates.
      const prefix = apiKey.slice(0, 12);
      const candidates = await prisma.agent.findMany({ where: { apiKeyPrefix: prefix } });
      for (const candidate of candidates) {
        if (candidate.apiKeyHash && await bcrypt.compare(apiKey, candidate.apiKeyHash)) {
          agent = candidate;
          break;
        }
      }
    }

    if (!agent) {
      res.status(401).json({
        ok: false,
        error: "unauthorized",
        message: "Invalid API key or OAuth token. Register at https://archtools.dev",
        request_id: crypto.randomUUID(),
      });
      return;
    }

    // Note: the DB no longer stores plaintext keys — req.agent.apiKey carries the
    // caller-presented (and just-verified) credential for internal re-use only.
    req.agent = {
      id: agent.id,
      apiKey,
      email: agent.email,
      credits: agent.credits,
      tier: agent.tier,
      totalCalls: agent.totalCalls,
      scope: oauthScope,
    };

    // Update last seen
    await prisma.agent.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() },
    });

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(500).json({
      ok: false,
      error: "internal_error",
      message: "Authentication check failed",
      request_id: crypto.randomUUID(),
    });
  }
}

/**
 * Key-management gate: requires a real `arch_` API key, not an OAuth access
 * token. `requireAuth` accepts scoped OAuth tokens (prefix `at_oauth_`) and tags
 * them by setting `req.agent.scope` — so without this gate, ANY scoped OAuth
 * token could rotate/revoke the account's API key and receive a fresh,
 * unrestricted `arch_` key (privilege escalation). Mount AFTER `requireAuth`.
 */
export function requireApiKeyAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): void {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Authentication required",
      request_id: crypto.randomUUID(),
    });
    return;
  }

  // OAuth-authenticated principals carry a defined `scope` (set in requireAuth);
  // full-access API keys have `scope === undefined`. Belt-and-suspenders: also
  // reject anything whose credential still bears the OAuth token prefix.
  if (agent.scope !== undefined || agent.apiKey.startsWith("at_oauth_")) {
    res.status(403).json({
      ok: false,
      error: "insufficient_authentication",
      message: "API key authentication is required for account key management",
      request_id: crypto.randomUUID(),
    });
    return;
  }

  next();
}

/**
 * Single source of truth for admin-key validation. Timing-safe, and refuses to
 * authenticate when ADMIN_KEY is unset or left at the insecure default. Used by
 * requireAdmin and the admin-HTML gates so they cannot drift apart.
 */
export function isValidAdminKey(provided: string | undefined | null): boolean {
  const expected = process.env.ADMIN_KEY ?? "";
  if (!expected || expected === "changeme") return false;
  const got = String(provided ?? "");
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Security: admin key must be supplied via Authorization header or x-admin-key header.
  // Query param (?key=...) is intentionally NOT accepted — query params are logged by
  // proxies, load balancers, and access logs, which would expose the admin secret.
  const key = String(
    req.headers["x-admin-key"] ??
    req.headers.authorization?.replace("Bearer ", "") ??
    ""
  );

  if (!isValidAdminKey(key)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  next();
}
