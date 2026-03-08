"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const crypto_1 = __importStar(require("crypto"));
const router = (0, express_1.Router)();
// HTML escape to prevent XSS injection in consent page
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
const CONSENT_PAGE = (clientName, scope, clientId, redirectUri, state, error) => {
    const safeClient = esc(clientName), safeScope = esc(scope), safeClientId = esc(clientId), safeRedirect = esc(redirectUri), safeState = esc(state);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to ${clientName} — Arch Tools</title>
  <link rel="icon" type="image/svg+xml" href="/arch-icon.svg">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:#07061A;color:#E0DFF5;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{background:rgba(12,11,34,0.9);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:40px;max-width:440px;width:100%;}
    .logo{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:32px;}
    .logo-arch{font-family:'Fira Code','Courier New',monospace;font-size:18px;font-weight:700;}
    .logo-arch span{color:#8844FF;}
    .connector-arrow{color:#6B6A8A;font-size:20px;margin:0 4px;}
    .logo-client{font-size:18px;font-weight:700;color:#E0DFF5;}
    h1{font-size:22px;font-weight:700;text-align:center;margin-bottom:8px;}
    .subtitle{color:#8B8AA8;font-size:14px;text-align:center;margin-bottom:32px;}
    .scope-box{background:rgba(136,68,255,0.07);border:1px solid rgba(136,68,255,0.2);border-radius:10px;padding:16px;margin-bottom:24px;}
    .scope-title{font-size:11px;font-family:monospace;color:#8844FF;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;}
    .scope-item{display:flex;align-items:center;gap:8px;font-size:13px;color:#C0BFDB;margin-bottom:6px;}
    .scope-dot{width:6px;height:6px;border-radius:50%;background:#34d399;flex-shrink:0;}
    label{display:block;font-size:13px;color:#8B8AA8;margin-bottom:6px;font-family:monospace;}
    input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px 14px;color:#E0DFF5;font-size:14px;margin-bottom:16px;outline:none;transition:border-color 0.15s;}
    input:focus{border-color:#8844FF;}
    .btn-approve{width:100%;background:#8844FF;color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;transition:opacity 0.15s;}
    .btn-approve:hover{opacity:0.88;}
    .btn-deny{width:100%;background:transparent;color:#6B6A8A;border:1px solid rgba(255,255,255,0.08);padding:12px;border-radius:10px;font-size:14px;cursor:pointer;transition:color 0.15s;}
    .btn-deny:hover{color:#E0DFF5;}
    .error{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:12px;color:#f87171;font-size:13px;margin-bottom:16px;text-align:center;}
    .footer-note{text-align:center;font-size:12px;color:#6B6A8A;margin-top:20px;}
    .footer-note a{color:#8844FF;text-decoration:none;}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <span class="logo-arch">Arch<span>Tools</span></span>
      <span class="connector-arrow">↔</span>
      <span class="logo-client">${safeClient}</span>
    </div>
    <h1>Connect your account</h1>
    <p class="subtitle">${safeClient} is requesting access to your Arch Tools account.</p>
    <div class="scope-box">
      <div class="scope-title">Permissions requested</div>
      ${safeScope.includes("tools:read") ? '<div class="scope-item"><span class="scope-dot"></span>View available tools and your usage</div>' : ""}
      ${safeScope.includes("tools:execute") ? '<div class="scope-item"><span class="scope-dot"></span>Execute tools using your credits</div>' : ""}
    </div>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${safeClientId}">
      <input type="hidden" name="redirect_uri" value="${safeRedirect}">
      <input type="hidden" name="scope" value="${safeScope}">
      <input type="hidden" name="state" value="${safeState}">
      <label for="email">Your Arch Tools email</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" required autocomplete="email">
      <label for="apiKey">Your API key</label>
      <input type="password" id="apiKey" name="apiKey" placeholder="at_..." required autocomplete="current-password">
      <button type="submit" class="btn-approve">Authorize → Connect to ${safeClient}</button>
    </form>
    <form method="GET" action="${safeRedirect}">
      <input type="hidden" name="error" value="access_denied">
      <input type="hidden" name="state" value="${safeState}">
      <button type="submit" class="btn-deny">Cancel</button>
    </form>
    <p class="footer-note">By authorizing, you agree to Arch Tools <a href="/terms.html">Terms of Service</a>.</p>
  </div>
</body>
</html>`;
};
// ─── GET /oauth/authorize ─────────────────────────────────────────────────────
router.get("/authorize", async (req, res) => {
    const { client_id, redirect_uri, response_type, scope = "tools:read tools:execute", state = "" } = req.query;
    if (!client_id || !redirect_uri || response_type !== "code") {
        res.status(400).json({ ok: false, error: "invalid_request", message: "client_id, redirect_uri, and response_type=code are required" });
        return;
    }
    const client = await prisma_1.prisma.oAuthClient.findUnique({ where: { clientId: client_id } }).catch(() => null);
    if (!client) {
        res.status(400).json({ ok: false, error: "invalid_client", message: "Unknown client_id" });
        return;
    }
    if (!client.redirectUris.includes(redirect_uri)) {
        res.status(400).json({ ok: false, error: "invalid_redirect_uri", message: "redirect_uri not registered for this client" });
        return;
    }
    res.type("text/html").send(CONSENT_PAGE(client.name, scope, client_id, redirect_uri, state));
});
// ─── POST /oauth/authorize (consent form submit) ──────────────────────────────
router.post("/authorize", async (req, res) => {
    const { client_id, redirect_uri, scope, state, email, apiKey } = req.body;
    const client = await prisma_1.prisma.oAuthClient.findUnique({ where: { clientId: client_id } }).catch(() => null);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
        res.status(400).json({ ok: false, error: "invalid_client" });
        return;
    }
    // Verify agent credentials
    const agent = await prisma_1.prisma.agent.findFirst({ where: { email, apiKey } }).catch(() => null);
    if (!agent) {
        res.type("text/html").send(CONSENT_PAGE(client.name, scope, client_id, redirect_uri, state, "Invalid email or API key. Check your credentials at archtools.dev."));
        return;
    }
    // Generate auth code
    const code = crypto_1.default.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await prisma_1.prisma.oAuthAuthCode.create({
        data: { id: crypto_1.default.randomUUID(), code, clientId: client_id, agentId: agent.id, scope, redirectUri: redirect_uri, expiresAt },
    });
    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state)
        url.searchParams.set("state", state);
    res.redirect(302, url.toString());
});
// ─── POST /oauth/token ────────────────────────────────────────────────────────
router.post("/token", async (req, res) => {
    const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token } = req.body;
    const client = await prisma_1.prisma.oAuthClient.findUnique({ where: { clientId: client_id } }).catch(() => null);
    const secretsMatch = !!client && client.clientSecret.length === (client_secret ?? "").length &&
        (0, crypto_1.timingSafeEqual)(Buffer.from(client.clientSecret), Buffer.from(client_secret ?? ""));
    if (!client || !secretsMatch) {
        res.status(401).json({ error: "invalid_client" });
        return;
    }
    // ── Authorization Code flow ──
    if (grant_type === "authorization_code") {
        if (!code || !redirect_uri) {
            res.status(400).json({ error: "invalid_request" });
            return;
        }
        const authCode = await prisma_1.prisma.oAuthAuthCode.findUnique({ where: { code } }).catch(() => null);
        if (!authCode || authCode.used || authCode.expiresAt < new Date() || authCode.clientId !== client_id || authCode.redirectUri !== redirect_uri) {
            res.status(400).json({ error: "invalid_grant" });
            return;
        }
        // Mark code as used
        await prisma_1.prisma.oAuthAuthCode.update({ where: { code }, data: { used: true } });
        const accessToken = `at_oauth_${crypto_1.default.randomBytes(32).toString("base64url")}`;
        const refreshTok = `rt_oauth_${crypto_1.default.randomBytes(32).toString("base64url")}`;
        const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour
        await prisma_1.prisma.oAuthToken.create({
            data: { id: crypto_1.default.randomUUID(), accessToken, refreshToken: refreshTok, clientId: client_id, agentId: authCode.agentId, scope: authCode.scope, expiresAt },
        });
        res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshTok, scope: authCode.scope });
        return;
    }
    // ── Refresh Token flow ──
    if (grant_type === "refresh_token") {
        if (!refresh_token) {
            res.status(400).json({ error: "invalid_request" });
            return;
        }
        const oldToken = await prisma_1.prisma.oAuthToken.findUnique({ where: { refreshToken: refresh_token } }).catch(() => null);
        if (!oldToken || oldToken.clientId !== client_id || oldToken.expiresAt < new Date()) {
            res.status(400).json({ error: "invalid_grant" });
            return;
        }
        // Rotate tokens
        const accessToken = `at_oauth_${crypto_1.default.randomBytes(32).toString("base64url")}`;
        const newRefresh = `rt_oauth_${crypto_1.default.randomBytes(32).toString("base64url")}`;
        const expiresAt = new Date(Date.now() + 3600 * 1000);
        await prisma_1.prisma.oAuthToken.delete({ where: { id: oldToken.id } });
        await prisma_1.prisma.oAuthToken.create({
            data: { id: crypto_1.default.randomUUID(), accessToken, refreshToken: newRefresh, clientId: client_id, agentId: oldToken.agentId, scope: oldToken.scope, expiresAt },
        });
        res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: newRefresh, scope: oldToken.scope });
        return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
});
exports.default = router;
//# sourceMappingURL=oauth.js.map