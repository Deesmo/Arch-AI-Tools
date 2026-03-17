/**
 * x402 Service Directory — v1.0
 *
 * A catalog of all known x402-compatible services. Makes Arch Tools the
 * go-to discovery point for agents looking for x402 APIs.
 *
 * Endpoints:
 *   GET  /api/v1/x402/directory          — Full catalog
 *   GET  /api/v1/x402/directory/search   — Search/filter by category, chain, price
 *   POST /api/v1/x402/directory/submit   — Submit a new service (pending approval)
 *   GET  /api/v1/x402/directory/stats    — Aggregate stats
 *   GET  /api/v1/x402/directory/:id      — Single service detail
 */
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = Router();
// ─── Load directory data ──────────────────────────────────────────────────────
const DATA_PATH = path.join(__dirname, "../data/x402-directory.json");
function loadDirectory() {
    try {
        const raw = fs.readFileSync(DATA_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return {
            services: [],
            pending_submissions: [],
            categories: [],
            meta: { total_services: 0, total_endpoints: 0, total_chains: 0, last_updated: new Date().toISOString(), version: "1.0.0" },
        };
    }
}
function saveDirectory(data) {
    // Update meta counts
    data.meta.total_services = data.services.filter(s => s.status === "active").length;
    data.meta.total_endpoints = data.services.reduce((sum, s) => sum + s.total_endpoints, 0);
    const allChains = new Set(data.services.flatMap(s => s.chains_supported));
    data.meta.total_chains = allChains.size;
    data.meta.last_updated = new Date().toISOString();
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}
// ─── GET /api/v1/x402/directory — Full catalog ───────────────────────────────
router.get("/", (_req, res) => {
    const data = loadDirectory();
    const activeServices = data.services.filter(s => s.status === "active");
    // Sort: featured first, then by total_endpoints desc
    activeServices.sort((a, b) => {
        if (a.featured && !b.featured)
            return -1;
        if (!a.featured && b.featured)
            return 1;
        return b.total_endpoints - a.total_endpoints;
    });
    const allChains = new Set(activeServices.flatMap(s => s.chains_supported));
    const allCategories = new Set(activeServices.flatMap(s => s.categories));
    const totalEndpoints = activeServices.reduce((sum, s) => sum + s.total_endpoints, 0);
    res.json({
        ok: true,
        directory: {
            total_services: activeServices.length,
            total_endpoints: totalEndpoints,
            chains_covered: allChains.size,
            categories_count: allCategories.size,
            chains: [...allChains].sort(),
            categories: [...allCategories].sort(),
            last_updated: data.meta.last_updated,
            version: data.meta.version,
        },
        services: activeServices,
        _links: {
            self: "/api/v1/x402/directory",
            search: "/api/v1/x402/directory/search",
            submit: "/api/v1/x402/directory/submit",
            stats: "/api/v1/x402/directory/stats",
            x402_spec: "https://x402.org",
            x402_docs: "https://docs.x402.org",
        },
    });
});
// ─── GET /api/v1/x402/directory/search — Filter/search ───────────────────────
router.get("/search", (req, res) => {
    const data = loadDirectory();
    let results = data.services.filter(s => s.status === "active");
    // Filter by category
    const category = req.query.category;
    if (category) {
        const cats = category.toLowerCase().split(",").map(c => c.trim());
        results = results.filter(s => s.categories.some(c => cats.includes(c.toLowerCase())));
    }
    // Filter by chain
    const chain = req.query.chain;
    if (chain) {
        const chains = chain.toLowerCase().split(",").map(c => c.trim());
        results = results.filter(s => s.chains_supported.some(c => chains.includes(c.toLowerCase())));
    }
    // Filter by token
    const token = req.query.token;
    if (token) {
        const tokens = token.toUpperCase().split(",").map(t => t.trim());
        results = results.filter(s => s.tokens_supported?.some(t => tokens.includes(t.toUpperCase())));
    }
    // Filter by price range (max price <= threshold)
    const maxPrice = req.query.max_price;
    if (maxPrice) {
        const threshold = parseFloat(maxPrice);
        if (!isNaN(threshold)) {
            results = results.filter(s => {
                const max = parseFloat(s.price_range.max.replace("$", ""));
                return !isNaN(max) && max <= threshold;
            });
        }
    }
    // Filter by verified status
    const verified = req.query.verified;
    if (verified === "true") {
        results = results.filter(s => s.verified);
    }
    // Filter by featured status
    const featured = req.query.featured;
    if (featured === "true") {
        results = results.filter(s => s.featured);
    }
    // Text search (name + description)
    const q = req.query.q;
    if (q) {
        const terms = q.toLowerCase().split(/\s+/);
        results = results.filter(s => {
            const text = `${s.name} ${s.description} ${s.categories.join(" ")}`.toLowerCase();
            return terms.every(term => text.includes(term));
        });
    }
    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const start = (page - 1) * limit;
    const paged = results.slice(start, start + limit);
    res.json({
        ok: true,
        total: results.length,
        page,
        limit,
        pages: Math.ceil(results.length / limit),
        services: paged,
        filters_applied: {
            category: category || null,
            chain: chain || null,
            token: token || null,
            max_price: maxPrice || null,
            verified: verified || null,
            featured: featured || null,
            q: q || null,
        },
    });
});
// ─── GET /api/v1/x402/directory/stats — Aggregate stats ──────────────────────
router.get("/stats", (_req, res) => {
    const data = loadDirectory();
    const active = data.services.filter(s => s.status === "active");
    const chainCounts = {};
    const categoryCounts = {};
    const tokenCounts = {};
    let totalEndpoints = 0;
    let verifiedCount = 0;
    for (const s of active) {
        totalEndpoints += s.total_endpoints;
        if (s.verified)
            verifiedCount++;
        for (const chain of s.chains_supported) {
            chainCounts[chain] = (chainCounts[chain] || 0) + 1;
        }
        for (const cat of s.categories) {
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
        for (const token of s.tokens_supported ?? []) {
            tokenCounts[token] = (tokenCounts[token] || 0) + 1;
        }
    }
    // Sort by count descending
    const sortedChains = Object.entries(chainCounts).sort((a, b) => b[1] - a[1]);
    const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    const sortedTokens = Object.entries(tokenCounts).sort((a, b) => b[1] - a[1]);
    res.json({
        ok: true,
        stats: {
            total_services: active.length,
            total_endpoints: totalEndpoints,
            verified_services: verifiedCount,
            pending_submissions: data.pending_submissions.filter(p => p.status === "pending").length,
            chains: Object.fromEntries(sortedChains),
            categories: Object.fromEntries(sortedCategories),
            tokens: Object.fromEntries(sortedTokens),
            top_chains: sortedChains.slice(0, 5).map(([chain, count]) => ({ chain, services: count })),
            top_categories: sortedCategories.slice(0, 5).map(([category, count]) => ({ category, services: count })),
        },
        last_updated: data.meta.last_updated,
    });
});
// ─── GET /api/v1/x402/directory/sitemap — Service URLs for search engines ────
router.get("/sitemap", (_req, res) => {
    try {
        const data = loadDirectory();
        const services = data.services || [];
        const urls = services
            .filter((s) => s.status === "active" || s.status === "verified")
            .map((s) => ({
            id: s.id,
            name: s.name,
            url: `https://archtools.dev/directory#${s.id}`,
            api_url: s.base_url || s.url || null,
            category: s.category,
            updated: s.updated_at || s.created_at || null,
        }));
        res.json({
            ok: true,
            count: urls.length,
            generated: new Date().toISOString(),
            urls,
        });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: "Failed to generate directory sitemap" });
    }
});
// ─── GET /api/v1/x402/directory/:id — Single service ─────────────────────────
router.get("/:id", (req, res) => {
    const data = loadDirectory();
    const service = data.services.find(s => s.id === req.params.id);
    if (!service) {
        res.status(404).json({ ok: false, error: "service_not_found", message: `No service found with id '${req.params.id}'` });
        return;
    }
    res.json({ ok: true, service });
});
// ─── POST /api/v1/x402/directory/submit — Submit a new service ───────────────
router.post("/submit", (req, res) => {
    const { name, url, description, contact_email, endpoints } = req.body;
    // Validate required fields
    if (!name || typeof name !== "string" || name.trim().length < 2) {
        res.status(400).json({ ok: false, error: "validation_error", message: "name is required (min 2 chars)" });
        return;
    }
    if (!url || typeof url !== "string" || !url.startsWith("http")) {
        res.status(400).json({ ok: false, error: "validation_error", message: "url is required and must be a valid URL" });
        return;
    }
    if (!description || typeof description !== "string" || description.trim().length < 10) {
        res.status(400).json({ ok: false, error: "validation_error", message: "description is required (min 10 chars)" });
        return;
    }
    if (!contact_email || typeof contact_email !== "string" || !contact_email.includes("@")) {
        res.status(400).json({ ok: false, error: "validation_error", message: "contact_email is required and must be a valid email" });
        return;
    }
    const data = loadDirectory();
    // Check for duplicate URL
    const existing = data.services.find(s => s.base_url === url || s.website_url === url);
    if (existing) {
        res.status(409).json({ ok: false, error: "duplicate", message: `A service with this URL already exists: ${existing.name}` });
        return;
    }
    // Check for duplicate pending
    const pendingDup = data.pending_submissions.find(p => p.url === url && p.status === "pending");
    if (pendingDup) {
        res.status(409).json({ ok: false, error: "duplicate", message: "A submission with this URL is already pending review" });
        return;
    }
    const submission = {
        id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        url: url.trim(),
        description: description.trim(),
        contact_email: contact_email.trim().toLowerCase(),
        endpoints: Array.isArray(endpoints) ? endpoints.filter((e) => typeof e === "string") : undefined,
        submitted_at: new Date().toISOString(),
        status: "pending",
    };
    data.pending_submissions.push(submission);
    saveDirectory(data);
    res.status(201).json({
        ok: true,
        message: "Submission received! Your service will be reviewed by our team and added to the directory once approved.",
        submission_id: submission.id,
        status: "pending",
    });
});
export default router;
//# sourceMappingURL=directory.js.map