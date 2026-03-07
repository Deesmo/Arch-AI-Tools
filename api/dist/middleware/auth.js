"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const prisma_1 = require("../lib/prisma");
const crypto_1 = require("crypto");
async function requireAuth(req, res, next) {
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
        let agent = null;
        // OAuth Bearer token (prefix: at_oauth_) — check OAuthToken table first
        if (apiKey.startsWith("at_oauth_")) {
            const oauthToken = await prisma_1.prisma.oAuthToken.findUnique({ where: { accessToken: apiKey } }).catch(() => null);
            if (oauthToken && oauthToken.expiresAt > new Date()) {
                agent = await prisma_1.prisma.agent.findUnique({ where: { id: oauthToken.agentId } });
            }
        }
        else {
            // Standard API key
            agent = await prisma_1.prisma.agent.findUnique({ where: { apiKey } });
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
        await prisma_1.prisma.agent.update({
            where: { id: agent.id },
            data: { lastSeenAt: new Date() },
        });
        next();
    }
    catch (err) {
        console.error("Auth middleware error:", err);
        res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Authentication check failed",
            request_id: crypto.randomUUID(),
        });
    }
}
function requireAdmin(req, res, next) {
    const key = String(req.headers["x-admin-key"] ??
        req.headers.authorization?.replace("Bearer ", "") ??
        req.query["key"] ?? "");
    const expected = process.env.ADMIN_KEY ?? "";
    // Timing-safe comparison to prevent timing attacks
    if (!expected || key.length !== expected.length || !(0, crypto_1.timingSafeEqual)(Buffer.from(key), Buffer.from(expected))) {
        res.status(403).json({ ok: false, error: "forbidden" });
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map