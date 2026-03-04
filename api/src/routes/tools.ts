import { Router } from "express";
import { prisma } from "../db.js";
import { requireApiKey } from "../middleware/auth.js";

export const toolsRouter = Router();

/**
 * GET /v1/tools — public tool discovery
 * Agents and developers can browse available tools without auth.
 * Only returns active tools.
 */
toolsRouter.get("/v1/tools", async (_req, res) => {
  const tools = await prisma.tool.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  res.json({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      endpoint: `/v1/tools/${t.name}`,
      method: t.method,
      credits: t.credits,
      category: t.category || null,
      schema: t.schemaJson ?? null,
    })),
  });
});

// Legacy route (backward compat — remove after migration)
toolsRouter.get("/tools", async (_req, res) => {
  const tools = await prisma.tool.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  res.json({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      endpoint: `/v1/tools/${t.name}`,
      method: t.method,
      credits: t.credits,
      schema: t.schemaJson ?? null,
    })),
  });
});

/**
 * GET /v1/tools/me — authenticated discovery with plan context
 */
toolsRouter.get("/v1/tools/me", requireApiKey, async (req: any, res) => {
  const agentPlan = req.agentPlan || "free";
  const tools = await prisma.tool.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  res.json({
    plan: agentPlan,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      endpoint: `/v1/tools/${t.name}`,
      method: t.method,
      credits: t.credits,
      category: t.category || null,
      schema: t.schemaJson ?? null,
    })),
  });
});

/**
 * POST /v1/tools/search — semantic-lite discovery
 * Public endpoint: returns tools that match a task or keywords.
 * Body: { task: string, limit?: number }
 */
toolsRouter.post("/v1/tools/search", async (req, res) => {
  const task = String(req.body?.task || req.body?.query || "").trim();
  const limit = Math.min(Math.max(Number(req.body?.limit) || 8, 1), 20);
  if (!task) return res.status(400).json({ ok: false, error: "missing_task" });

  const q = task.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).slice(0, 12);

  const tools = await prisma.tool.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const scored = tools
    .map((t) => {
      const hay = `${t.name} ${(t.description || "")} ${(t.category || "")}`.toLowerCase();
      let score = 0;
      if (hay.includes(q)) score += 5;
      for (const w of words) {
        if (w.length < 3) continue;
        if (hay.includes(w)) score += 1;
      }
      // Prefer web + automation tools for agent-y tasks
      if (/(search|scrape|extract|browser|workflow|pdf|ocr)/.test(q) && /(web|files|ai)/.test(t.category || "")) score += 1;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ t, score }) => ({
      name: t.name,
      description: t.description,
      endpoint: `/v1/tools/${t.name}`,
      method: t.method,
      credits: t.credits,
      category: t.category || null,
      score,
    }));

  return res.json({ ok: true, task, results: scored });
});
