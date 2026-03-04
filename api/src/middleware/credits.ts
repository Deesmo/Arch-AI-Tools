import type { Response, NextFunction } from "express";
import { prisma } from "../db.js";
import type { AuthedRequest } from "./auth.js";
import { fail } from "../lib/http.js";

/**
 * Middleware factory: checks agent has enough credits for this tool call.
 * Attaches tool info to request for downstream debit.
 */
export function requireCredits(toolName: string, credits: number) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const agentId = req.agentId;
    if (!agentId) return fail(req as any, res, 401, "unauthorized", "Missing agent" );

    const balance = await getCreditBalance(agentId);
    if (balance < credits) {
      return fail(req as any, res, 402, "insufficient_credits", undefined, {
        credits_required: credits,
        credits_remaining: balance,
      });
    }

    // Optional per-key daily spend cap (premium/enterprise control)
    const cap = (req as any).dailyCreditCap as number | null | undefined;
    if (cap && cap > 0) {
      const start = new Date();
      start.setHours(0,0,0,0);
      const spent = await prisma.ledgerEntry.aggregate({
        where: { agentId, kind: { in: ["debit", "reversal"] }, createdAt: { gte: start } },
        _sum: { credits: true },
      });
      const usedToday = spent._sum.credits || 0;
      if (usedToday + credits > cap) {
        return fail(req as any, res, 429, "rate_limited", "Daily credit cap exceeded", {
          daily_cap: cap,
          credits_used_today: usedToday,
        });
      }
    }

    (req as any).__arch_tool = { toolName, credits };
    return next();
  };
}

export async function debitCredits(
  agentId: string,
  toolName: string,
  credits: number,
  requestId: string,
  meta?: any
) {
  await prisma.ledgerEntry.create({
    data: {
      agentId,
      kind: "debit",
      credits,
      toolName,
      requestId,
      meta,
    },
  });
}

/**
 * Creates a reversal entry (subtracts credits) without mutating history.
 * Use for refunds/chargebacks/admin adjustments.
 */
export async function reverseCredits(
  agentId: string,
  credits: number,
  reference: string,
  meta?: any
) {
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error("credits must be a positive integer");
  }
  await prisma.ledgerEntry.create({
    data: {
      agentId,
      kind: "reversal",
      credits: Math.floor(credits),
      requestId: reference,
      meta,
    },
  });
}

export async function getCreditBalance(agentId: string): Promise<number> {
  const [grants, debits, credits] = await Promise.all([
    prisma.creditGrant.aggregate({
      where: { agentId },
      _sum: { credits: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { agentId, kind: { in: ["debit", "reversal"] } },
      _sum: { credits: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { agentId, kind: "credit" },
      _sum: { credits: true },
    }),
  ]);

  const grantSum = grants._sum.credits || 0;
  const creditSum = credits._sum.credits || 0;
  const debitSum = debits._sum.credits || 0;

  return Math.max(0, grantSum + creditSum - debitSum);
}
