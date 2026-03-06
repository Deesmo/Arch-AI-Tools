import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

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
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Missing Authorization: Bearer <api_key> header",
      request_id: req.headers["x-request-id"] ?? crypto.randomUUID(),
    });
    return;
  }

  const apiKey = authHeader.slice(7).trim();
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
    const agent = await prisma.agent.findUnique({ where: { apiKey } });
    if (!agent) {
      res.status(401).json({
        ok: false,
        error: "unauthorized",
        message: "Invalid API key. Register at https://archtools.dev/signup",
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
  const key =
    req.headers["x-admin-key"] ??
    req.headers.authorization?.replace("Bearer ", "") ??
    req.query["key"];

  if (key !== process.env.ADMIN_KEY) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }
  next();
}
