/**
 * Public Stats API — Vanity metrics for public-facing /stats page
 * No auth required. Returns non-sensitive aggregate data.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { reqId, safeErr } from "../utils/credits.js";
const router = Router();
// Cache stats for 5 minutes to avoid hammering DB
let cachedStats = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
router.get("/", async (_req, res) => {
    try {
        // Return cached if fresh
        if (cachedStats && Date.now() - cachedStats.timestamp < CACHE_TTL_MS) {
            res.json(cachedStats.data);
            return;
        }
        const [totalRequests, totalAgents, totalTools, totalX402, toolCategories] = await Promise.all([
            prisma.apiRequest.count(),
            prisma.agent.count(),
            prisma.tool.count({ where: { active: true } }),
            prisma.x402Payment.count({ where: { status: "settled" } }),
            prisma.tool.groupBy({
                by: ["category"],
                _count: { category: true },
                where: { active: true },
            }),
        ]);
        // Get unique chains from x402 payments
        const chains = await prisma.x402Payment.groupBy({
            by: ["network"],
            _count: { network: true },
        });
        const supportedChains = [
            "Base", "Ethereum", "Arbitrum", "Polygon", "Optimism",
            "Avalanche", "Solana", "Unichain", "Monad",
        ];
        const data = {
            ok: true,
            stats: {
                total_api_calls: totalRequests,
                total_agents: totalAgents,
                total_tools: totalTools,
                total_x402_payments: totalX402,
                chains_supported: supportedChains.length,
                chain_names: supportedChains,
                categories: toolCategories.map(c => ({
                    name: c.category,
                    tools: c._count.category,
                })),
                active_chains: chains.map(c => ({
                    chain: c.network,
                    payments: c._count.network,
                })),
            },
            request_id: reqId(),
        };
        cachedStats = { data, timestamp: Date.now() };
        res.json(data);
    }
    catch (e) {
        console.error("Stats error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
export default router;
//# sourceMappingURL=stats.js.map