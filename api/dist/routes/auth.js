"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signSession = signSession;
exports.verifySession = verifySession;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
// email helper imported when needed
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || "arch-tools-dev-secret-change-in-prod";
const COOKIE_NAME = "arch_session";
const COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
};
function signSession(agentId) {
    return jsonwebtoken_1.default.sign({ sub: agentId }, JWT_SECRET, { expiresIn: "30d" });
}
function verifySession(token) {
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
// ─── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
        res.status(400).json({ ok: false, error: "email_and_password_required" });
        return;
    }
    const agent = await prisma_1.prisma.agent.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!agent) {
        // Timing-safe: still do a bcrypt compare to prevent user enumeration
        await bcryptjs_1.default.compare(password, "$2b$10$invalid.hash.that.never.matches.xxxxxxxxxxx");
        res.status(401).json({ ok: false, error: "invalid_credentials" });
        return;
    }
    if (!agent.passwordHash) {
        // Account exists but was created before passwords — send magic link
        res.status(401).json({
            ok: false,
            error: "no_password_set",
            message: "This account was created before password login was added. Use the link in your original welcome email, or contact support to set a password.",
        });
        return;
    }
    const valid = await bcryptjs_1.default.compare(password, agent.passwordHash);
    if (!valid) {
        res.status(401).json({ ok: false, error: "invalid_credentials" });
        return;
    }
    const token = signSession(agent.id);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    logger_1.logger.info({ agentId: agent.id }, "Agent logged in");
    res.json({ ok: true, redirect: "/dashboard" });
});
// ─── POST /auth/set-password ───────────────────────────────────────────────────
// Used at signup + by existing users who have their API key
router.post("/set-password", async (req, res) => {
    const { api_key, password } = req.body ?? {};
    if (!api_key || !password) {
        res.status(400).json({ ok: false, error: "api_key_and_password_required" });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ ok: false, error: "password_too_short", message: "Password must be at least 8 characters." });
        return;
    }
    const agent = await prisma_1.prisma.agent.findUnique({ where: { apiKey: api_key } });
    if (!agent) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
    }
    const hash = await bcryptjs_1.default.hash(password, 10);
    await prisma_1.prisma.agent.update({ where: { id: agent.id }, data: { passwordHash: hash } });
    // Set session cookie immediately
    const token = signSession(agent.id);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    logger_1.logger.info({ agentId: agent.id }, "Agent set password + logged in");
    res.json({ ok: true, redirect: "/dashboard" });
});
// ─── GET /auth/logout ──────────────────────────────────────────────────────────
router.get("/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.redirect("/");
});
// ─── GET /auth/me ─────────────────────────────────────────────────────────────
// Returns current session agent info (used by dashboard JS)
router.get("/me", async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
        res.status(401).json({ ok: false, error: "not_authenticated" });
        return;
    }
    const payload = verifySession(token);
    if (!payload) {
        res.clearCookie(COOKIE_NAME, { path: "/" });
        res.status(401).json({ ok: false, error: "session_expired" });
        return;
    }
    const agent = await prisma_1.prisma.agent.findUnique({ where: { id: payload.sub } });
    if (!agent) {
        res.clearCookie(COOKIE_NAME, { path: "/" });
        res.status(401).json({ ok: false, error: "agent_not_found" });
        return;
    }
    res.json({
        ok: true,
        agent_id: agent.id,
        email: agent.email,
        api_key: agent.apiKey,
        credits: agent.credits,
        tier: agent.tier,
        created_at: agent.createdAt,
    });
});
exports.default = router;
//# sourceMappingURL=auth.js.map