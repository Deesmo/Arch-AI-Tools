import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { timingSafeEqual } from "crypto";

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
      // Standard API key
      // TODO: Migrate to hashed keys. See SECURITY.md for migration plan.
      agent = await prisma.agent.findUnique({ where: { apiKey } });
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

    req.agent = {
      id: agent.id,
      apiKey: agent.apiKey,
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
  const key = String(
    req.headers["x-admin-key"] ??
    req.headers.authorization?.replace("Bearer ", "") ??
    req.query["key"] ?? ""
  );

  const expected = process.env.ADMIN_KEY ?? "";
  // Timing-safe comparison to prevent timing attacks
  if (!expected || key.length !== expected.length || !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  next();
}
