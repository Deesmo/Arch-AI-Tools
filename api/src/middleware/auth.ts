import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

export interface AuthedRequest extends Request {
  agent?: {
    id: string;
    apiKey: string;
    email: string;
    credits: number;
    tier: string;
    totalCalls: number;
  };
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
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Missing Authorization: Bearer <api_key> header or x-api-key header",
      request_id: req.headers["x-request-id"] ?? crypto.randomUUID(),
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

    // OAuth Bearer token (prefix: at_oauth_) — check OAuthToken table first
    if (apiKey.startsWith("at_oauth_")) {
      const oauthToken = await prisma.oAuthToken.findUnique({ where: { accessToken: apiKey } }).catch(() => null);
      if (oauthToken && oauthToken.expiresAt > new Date()) {
        agent = await prisma.agent.findUnique({ where: { id: oauthToken.agentId } });
      }
    } else {
      // Standard API key — plaintext keys are no longer stored. Lookup by the
      // first 12-char prefix (fast indexed scan), then bcrypt.compare the full key.
      const prefix = apiKey.slice(0, 12);
      const candidate = await prisma.agent.findFirst({ where: { apiKeyPrefix: prefix } });
      if (candidate?.apiKeyHash) {
        const match = await bcrypt.compare(apiKey, candidate.apiKeyHash);
        agent = match ? candidate : null;
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

  const expected = process.env.ADMIN_KEY ?? "";
  // Timing-safe comparison to prevent timing attacks
  if (!expected || key.length !== expected.length || !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  next();
}
