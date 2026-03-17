import { Router } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = Router();
let mcpServers = [];
try {
    const dataPath = join(__dirname, "../data/mcp-servers.json");
    mcpServers = JSON.parse(readFileSync(dataPath, "utf-8"));
}
catch (err) {
    console.error("Failed to load MCP servers catalog:", err);
}
// In-memory submissions (would be DB in production)
const submissions = [];
// ─── Categories ───────────────────────────────────────────────────────────────
const CATEGORIES = [
    "aggregator", "art", "browser", "cloud", "communication",
    "database", "developer-tools", "filesystem", "finance",
    "knowledge", "location", "marketing", "monitoring",
    "productivity", "search", "security", "utility"
];
// ─── GET /api/v1/mcp/servers — List all MCP servers ──────────────────────────
router.get("/servers", (req, res) => {
    const { category, framework, language, capability, featured, verified, sort, limit, offset } = req.query;
    let filtered = [...mcpServers];
    if (category && typeof category === "string") {
        filtered = filtered.filter(s => s.category === category);
    }
    if (framework && typeof framework === "string") {
        filtered = filtered.filter(s => s.frameworks.includes(framework));
    }
    if (language && typeof language === "string") {
        filtered = filtered.filter(s => s.language === language);
    }
    if (capability && typeof capability === "string") {
        filtered = filtered.filter(s => s.capabilities.includes(capability));
    }
    if (featured === "true") {
        filtered = filtered.filter(s => s.featured);
    }
    if (verified === "true") {
        filtered = filtered.filter(s => s.verified);
    }
    // Sort
    const sortBy = typeof sort === "string" ? sort : "stars";
    if (sortBy === "rating") {
        filtered.sort((a, b) => b.rating - a.rating);
    }
    else if (sortBy === "name") {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
    else if (sortBy === "updated") {
        filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    else {
        filtered.sort((a, b) => b.stars - a.stars);
    }
    // Pagination
    const lim = Math.min(parseInt(String(limit)) || 50, 100);
    const off = parseInt(String(offset)) || 0;
    const paginated = filtered.slice(off, off + lim);
    res.json({
        ok: true,
        total: filtered.length,
        limit: lim,
        offset: off,
        categories: CATEGORIES,
        servers: paginated,
    });
});
// ─── GET /api/v1/mcp/servers/search — Search/filter MCP servers ─────────────
router.get("/servers/search", (req, res) => {
    const { q, category, framework, language } = req.query;
    const query = (typeof q === "string" ? q : "").toLowerCase().trim();
    let filtered = [...mcpServers];
    if (query) {
        filtered = filtered.filter(s => s.name.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query) ||
            s.tags.some(t => t.toLowerCase().includes(query)) ||
            s.author.toLowerCase().includes(query) ||
            s.category.toLowerCase().includes(query));
    }
    if (category && typeof category === "string") {
        filtered = filtered.filter(s => s.category === category);
    }
    if (framework && typeof framework === "string") {
        filtered = filtered.filter(s => s.frameworks.includes(framework));
    }
    if (language && typeof language === "string") {
        filtered = filtered.filter(s => s.language === language);
    }
    // Relevance sort: exact name match first, then stars
    if (query) {
        filtered.sort((a, b) => {
            const aExact = a.name.toLowerCase() === query ? 1 : 0;
            const bExact = b.name.toLowerCase() === query ? 1 : 0;
            if (aExact !== bExact)
                return bExact - aExact;
            return b.stars - a.stars;
        });
    }
    else {
        filtered.sort((a, b) => b.stars - a.stars);
    }
    res.json({
        ok: true,
        query,
        total: filtered.length,
        servers: filtered.slice(0, 50),
    });
});
// ─── POST /api/v1/mcp/servers/submit — Submit a new MCP server ──────────────
router.post("/servers/submit", (req, res) => {
    const { name, description, repository, packageName, category, capabilities, contactEmail } = req.body;
    if (!name || !description || !repository || !contactEmail) {
        res.status(400).json({
            ok: false,
            error: "missing_fields",
            message: "Required: name, description, repository, contactEmail",
        });
        return;
    }
    if (!CATEGORIES.includes(category)) {
        res.status(400).json({
            ok: false,
            error: "invalid_category",
            message: `Category must be one of: ${CATEGORIES.join(", ")}`,
        });
        return;
    }
    const submission = {
        id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        description,
        repository,
        package: packageName || "",
        category,
        capabilities: Array.isArray(capabilities) ? capabilities : [],
        contactEmail,
        submittedAt: new Date().toISOString(),
        status: "pending",
    };
    submissions.push(submission);
    res.status(201).json({
        ok: true,
        message: "Server submitted for review. We'll review it within 48 hours.",
        submissionId: submission.id,
    });
});
// ─── GET /api/v1/mcp/servers/:id — Single server detail ─────────────────────
router.get("/servers/:id", (req, res) => {
    const server = mcpServers.find(s => s.id === req.params.id);
    if (!server) {
        res.status(404).json({
            ok: false,
            error: "not_found",
            message: "MCP server not found",
        });
        return;
    }
    // Find related servers (same category, different id)
    const related = mcpServers
        .filter(s => s.category === server.category && s.id !== server.id)
        .sort((a, b) => b.stars - a.stars)
        .slice(0, 4);
    res.json({
        ok: true,
        server,
        related,
    });
});
// ─── GET /api/v1/mcp/categories — List all categories with counts ───────────
router.get("/categories", (_req, res) => {
    const categoryCounts = {};
    for (const cat of CATEGORIES) {
        categoryCounts[cat] = mcpServers.filter(s => s.category === cat).length;
    }
    res.json({
        ok: true,
        categories: categoryCounts,
        total: mcpServers.length,
    });
});
// ─── GET /api/v1/mcp/stats — Marketplace stats ──────────────────────────────
router.get("/stats", (_req, res) => {
    res.json({
        ok: true,
        totalServers: mcpServers.length,
        verifiedServers: mcpServers.filter(s => s.verified).length,
        featuredServers: mcpServers.filter(s => s.featured).length,
        categories: CATEGORIES.length,
        languages: [...new Set(mcpServers.map(s => s.language))],
        pendingSubmissions: submissions.filter(s => s.status === "pending").length,
    });
});
export default router;
//# sourceMappingURL=mcp-marketplace.js.map