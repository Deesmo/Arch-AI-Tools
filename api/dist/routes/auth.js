import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { sendPasswordResetEmail } from "../services/email.js";
const router = Router();
// Security: fail hard at startup if JWT_SECRET is not set — never use a hardcoded fallback.
// This applies in ALL environments; a missing secret is always a configuration error.
if (!process.env.JWT_SECRET) {
    throw new Error("FATAL: JWT_SECRET env var is not set. Refusing to start. Set a strong random secret.");
}
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "arch_session";
// Security: JWT expiry and cookie maxAge are intentionally set to the SAME value (7 days).
// Mismatched expiry (e.g. 30d JWT + 72h cookie) allows stolen tokens to remain valid
// long after the user's browser session has expired.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const SESSION_TTL_JWT = "7d"; // must match SESSION_TTL_MS
const COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
};
// C-2 FIX: Rate limit login attempts — 5 per 15 min per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    message: { ok: false, error: "too_many_attempts", message: "Too many login attempts. Try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
// Also rate-limit forgot-password — 3 requests per email per 5 min (handled per IP here)
const forgotLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: { ok: false, error: "too_many_requests", message: "Too many reset requests. Try again in 5 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
export function signSession(agentId) {
    return jwt.sign({ sub: agentId }, JWT_SECRET, { expiresIn: SESSION_TTL_JWT });
}
export function verifySession(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
// ─── POST /auth/login-key ───────────────────────────────────────────────────────
// API Key login: validate key, set session cookie, redirect to dashboard. No password needed.
router.post("/login-key", loginLimiter, async (req, res) => {
    const { api_key } = req.body ?? {};
    if (!api_key || typeof api_key !== "string" || !api_key.startsWith("arch_")) {
        res.status(400).json({ ok: false, error: "invalid_api_key", message: "A valid API key starting with arch_ is required." });
        return;
    }
    const agent = await prisma.agent.findUnique({ where: { apiKey: api_key } });
    if (!agent) {
        res.status(401).json({ ok: false, error: "invalid_api_key", message: "Invalid API key." });
        return;
    }
    const token = signSession(agent.id);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    logger.info({ agentId: agent.id }, "Agent logged in via API key");
    res.json({ ok: true, redirect: "/dashboard" });
});
// ─── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
        res.status(400).json({ ok: false, error: "email_and_password_required" });
        return;
    }
    const agent = await prisma.agent.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!agent) {
        // Timing-safe: still do a bcrypt compare to prevent user enumeration
        await bcrypt.compare(password, "$2b$10$invalid.hash.that.never.matches.xxxxxxxxxxx");
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
    const valid = await bcrypt.compare(password, agent.passwordHash);
    if (!valid) {
        res.status(401).json({ ok: false, error: "invalid_credentials" });
        return;
    }
    const token = signSession(agent.id);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    logger.info({ agentId: agent.id }, "Agent logged in");
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
    const agent = await prisma.agent.findUnique({ where: { apiKey: api_key } });
    if (!agent) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
    }
    const hash = await bcrypt.hash(password, 10);
    await prisma.agent.update({ where: { id: agent.id }, data: { passwordHash: hash } });
    // Set session cookie immediately
    const token = signSession(agent.id);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    logger.info({ agentId: agent.id }, "Agent set password + logged in");
    res.json({ ok: true, redirect: "/dashboard" });
});
// ─── GET /auth/logout ──────────────────────────────────────────────────────────
router.get("/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    res.redirect("/login");
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
    const agent = await prisma.agent.findUnique({ where: { id: payload.sub } });
    if (!agent) {
        res.clearCookie(COOKIE_NAME, { path: "/" });
        res.status(401).json({ ok: false, error: "agent_not_found" });
        return;
    }
    // C-3 FIX: Never return api_key from /auth/me — serve only on explicit /auth/api-key request
    res.json({
        ok: true,
        agent_id: agent.id,
        email: agent.email,
        credits: agent.credits,
        tier: agent.tier,
        created_at: agent.createdAt,
    });
});
// ─── GET /auth/api-key ────────────────────────────────────────────────────────
// Returns the API key only on explicit request (user clicked "Show Key" etc.)
router.get("/api-key", async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
        res.status(401).json({ ok: false, error: "not_authenticated" });
        return;
    }
    const payload = verifySession(token);
    if (!payload) {
        res.status(401).json({ ok: false, error: "session_expired" });
        return;
    }
    const agent = await prisma.agent.findUnique({ where: { id: payload.sub } });
    if (!agent) {
        res.status(401).json({ ok: false, error: "agent_not_found" });
        return;
    }
    // Return masked key by default; caller can request reveal
    const masked = agent.apiKey.substring(0, 8) + "●".repeat(agent.apiKey.length - 12) + agent.apiKey.slice(-4);
    res.json({ ok: true, api_key_masked: masked, api_key: agent.apiKey });
});
export default router;
// ─── POST /auth/forgot-password ───────────────────────────────────────────────
router.post("/forgot-password", forgotLimiter, async (req, res) => {
    const { email } = req.body ?? {};
    if (!email) {
        res.status(400).json({ ok: false, error: "email_required" });
        return;
    }
    // Always return 200 to prevent user enumeration
    const agent = await prisma.agent.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (agent) {
        const token = crypto.randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await prisma.agent.update({
            where: { id: agent.id },
            data: { resetToken: token, resetTokenExpiry: expiry },
        });
        const resetUrl = `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/auth/reset-password?token=${token}`;
        await sendPasswordResetEmail(agent.email, resetUrl);
    }
    res.json({ ok: true, message: "If an account exists with that email, a reset link has been sent." });
});
// ─── GET /auth/reset-password ─────────────────────────────────────────────────
router.get("/reset-password", (_req, res) => {
    const token = _req.query.token ?? "";
    res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Arch Tools — Reset Password</title>
  <link rel="icon" href="/arch-icon.svg" type="image/svg+xml">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Syne,sans-serif;background:#07061A;color:rgba(255,255,255,0.9);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
    .card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:36px 32px;width:100%;max-width:400px;}
    h1{font-size:22px;font-weight:800;margin-bottom:6px;}
    p{font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:24px;}
    input{width:100%;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#fff;padding:0 14px;font-family:inherit;font-size:14px;outline:none;margin-bottom:12px;}
    button{width:100%;height:48px;border-radius:12px;border:0;background:linear-gradient(135deg,#FF9010,#FF2896);color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;}
    .status{font-size:13px;min-height:18px;margin-bottom:10px;}
  </style>
</head>
<body>
<div class="card">
  <h1>Set new password</h1>
  <p>Enter your new password below.</p>
  <input type="password" id="pw" placeholder="New password (min 8 chars)" autocomplete="new-password"/>
  <input type="password" id="pw2" placeholder="Confirm password" autocomplete="new-password"/>
  <div class="status" id="status"></div>
  <button onclick="doReset()">Set Password →</button>
</div>
<script>
  async function doReset() {
    var pw = document.getElementById('pw').value;
    var pw2 = document.getElementById('pw2').value;
    var st = document.getElementById('status');
    if (pw.length < 8) { st.style.color='#f87171'; st.textContent='Password must be at least 8 characters.'; return; }
    if (pw !== pw2) { st.style.color='#f87171'; st.textContent='Passwords do not match.'; return; }
    st.style.color='rgba(255,255,255,0.5)'; st.textContent='Setting password…';
    var r = await fetch('/auth/reset-password', {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ token: '${token}', password: pw })
    });
    var d = await r.json();
    if (d.ok) { st.style.color='#34d399'; st.textContent='✓ Password set! Redirecting…'; setTimeout(()=>window.location.href='/dashboard',1200); }
    else { st.style.color='#f87171'; st.textContent = d.message || 'Invalid or expired link. Request a new one.'; }
  }
</script>
</body></html>`);
});
// ─── POST /auth/reset-password ────────────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
        res.status(400).json({ ok: false, error: "token_and_password_required" });
        return;
    }
    if (password.length < 8) {
        res.status(400).json({ ok: false, error: "password_too_short", message: "Password must be at least 8 characters." });
        return;
    }
    const agent = await prisma.agent.findFirst({
        where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    });
    if (!agent) {
        res.status(400).json({ ok: false, error: "invalid_or_expired_token", message: "This reset link has expired or is invalid. Please request a new one." });
        return;
    }
    const hash = await bcrypt.hash(password, 10);
    await prisma.agent.update({
        where: { id: agent.id },
        data: { passwordHash: hash, resetToken: null, resetTokenExpiry: null },
    });
    // Log the user in
    const sessionToken = signSession(agent.id);
    res.cookie(COOKIE_NAME, sessionToken, COOKIE_OPTS);
    logger.info({ agentId: agent.id }, "Agent reset password + logged in");
    res.json({ ok: true, redirect: "/dashboard" });
});
//# sourceMappingURL=auth.js.map