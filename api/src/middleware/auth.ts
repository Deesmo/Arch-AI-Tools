import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";
import { hashApiKey } from "../lib/crypto.js";
import { fail } from "../lib/http.js";

export type AuthedRequest = Request & { agentId?: string; agentPlan?: "free"|"pro"|"business"; apiKeyPrefix?: string; apiKeyId?: string; dailyCreditCap?: number|null; scrapeEnabled?: boolean; allowedScrapeDomains?: string|null; };

export async function requireApiKey(req: AuthedRequest, res: Response, next: NextFunction) {
  const auth = req.header("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return fail(req as any, res, 401, "unauthorized", "Missing API key" );

  const rawKey = m[1].trim();
  if (rawKey.length < 20) return fail(req as any, res, 401, "unauthorized", "Invalid API key" );

  const keyHash = hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { agent: true }
  });

  if (!apiKey || apiKey.revokedAt) return fail(req as any, res, 401, "unauthorized", "Invalid API key" );

  req.agentId = apiKey.agentId;
  req.agentPlan = apiKey.agent.plan as any;

  req.apiKeyPrefix = apiKey.prefix;
  req.apiKeyId = apiKey.id;
  req.dailyCreditCap = apiKey.dailyCreditCap ?? null;
  req.scrapeEnabled = apiKey.scrapeEnabled ?? true;
  req.allowedScrapeDomains = apiKey.allowedScrapeDomains ?? null;

  // Optional key restrictions
  const origin = (req.headers.origin || "") as string;
  if (apiKey.allowedOrigins && origin) {
    const allowed = apiKey.allowedOrigins.split(",").map(s=>s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) {
      return fail(req as any, res, 403, "forbidden", "Origin not allowed for this API key");
    }
  }
  if (apiKey.allowedIps) {
    const allowedIps = apiKey.allowedIps.split(",").map(s=>s.trim()).filter(Boolean);
    if (allowedIps.length && !allowedIps.includes(req.ip ?? "")) {
      return fail(req as any, res, 403, "forbidden", "IP not allowed for this API key");
    }
  }

  return next();
}

export function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  const k = req.header("X-Admin-Key") || "";
  if (!process.env.ADMIN_KEY || k !== process.env.ADMIN_KEY) {
    return fail(req as any, res, 401, "forbidden", "Invalid admin key" );
  }
  return next();
}
