import type { Agent } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

export async function findAgentByApiKey(apiKey: string): Promise<Agent | null> {
  const prefix = apiKey.slice(0, 12);
  const candidates = await prisma.agent.findMany({ where: { apiKeyPrefix: prefix } });

  for (const candidate of candidates) {
    if (!candidate.apiKeyHash) continue;
    const match = await bcrypt.compare(apiKey, candidate.apiKeyHash).catch(() => false);
    if (match) return candidate;
  }

  return null;
}
