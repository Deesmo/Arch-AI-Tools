import { Router } from "express";
import { prisma } from "../db.js";
import { requireAdminKey } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
export const publishRouter = Router();
/**
 * POST /v1/publish-tool — admin-gated tool registration/update
 */
publishRouter.post("/v1/publish-tool", requireAdminKey, async (req, res) => {
    const { name, description, endpoint, method, credits, schema, category } = req.body || {};
    const cleanName = String(name || "").trim().toLowerCase();
    if (!cleanName.match(/^[a-z0-9\-]{3,64}$/)) {
        return res.status(400).json({ error: "invalid_name", hint: "use 3-64 chars a-z 0-9 and dashes" });
    }
    const cleanEndpoint = String(endpoint || "").trim();
    if (!cleanEndpoint)
        return res.status(400).json({ error: "missing_endpoint" });
    const cleanDesc = String(description || "").trim().slice(0, 300);
    const cleanMethod = String(method || "POST").toUpperCase() === "GET" ? "GET" : "POST";
    const cleanCategory = category ? String(category).trim().slice(0, 40) : null;
    const cost = Number(credits);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) {
        return res.status(400).json({ error: "invalid_credits" });
    }
    const tool = await prisma.tool.upsert({
        where: { name: cleanName },
        update: {
            description: cleanDesc,
            endpoint: cleanEndpoint,
            method: cleanMethod,
            credits: cost,
            schemaJson: schema ?? null,
            category: cleanCategory,
        },
        create: {
            name: cleanName,
            description: cleanDesc,
            endpoint: cleanEndpoint,
            method: cleanMethod,
            credits: cost,
            schemaJson: schema ?? null,
            category: cleanCategory,
        },
    });
    logger.info({ tool: tool.name }, "Tool published/updated");
    res.json({ ok: true, tool });
});
/**
 * DELETE /v1/tools/:name — admin-gated tool deactivation (soft delete)
 */
publishRouter.delete("/v1/tools/:name", requireAdminKey, async (req, res) => {
    const name = String(req.params.name || "").toLowerCase();
    try {
        await prisma.tool.update({
            where: { name },
            data: { active: false },
        });
        res.json({ ok: true, deactivated: name });
    }
    catch {
        return res.status(404).json({ error: "tool_not_found" });
    }
});
//# sourceMappingURL=publish.js.map