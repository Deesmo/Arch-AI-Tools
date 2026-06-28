import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { isOAuthRefreshTokenExpired, oauthAccessExpiresAt } from "../lib/oauthTokens.js";
import crypto, { timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

const router = Router();

// Only these OAuth scopes are recognized. Anything else is dropped so a client
// cannot persist arbitrary scope strings.
const ALLOWED_SCOPES = ["tools:read", "tools:execute"];
function sanitizeScope(raw: string | undefined): string {
  const requested = String(raw ?? "").split(/\s+/).filter((s) => ALLOWED_SCOPES.includes(s));
  return requested.length ? Array.from(new Set(requested)).join(" ") : "tools:read";
}

// HTML escape to prevent XSS injection in consent page
function esc(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
}

const CONSENT_PAGE = (clientName: string, scope: string, clientId: string, redirectUri: string, state: string, codeChallenge: string, codeChallengeMethod: string, error?: string) => {
const safeClient = esc(clientName), safeScope = esc(scope), safeClientId = esc(clientId), safeRedirect = esc(redirectUri), safeState = esc(state);
const safeCodeChallenge = esc(codeChallenge), safeCodeChallengeMethod = esc(codeChallengeMethod);
return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to ${clientName} — Arch Tools</title>
  <link rel="icon" type="image/svg+xml" href="/arch-icon.svg?v=2">
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
      <input type="hidden" name="code_challenge" value="${safeCodeChallenge}">
      <input type="hidden" name="code_challenge_method" value="${safeCodeChallengeMethod}">
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
router.get("/authorize", async (req: Request, res: Response): Promise<void> => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope = "tools:read tools:execute",
    state = "",
    code_challenge = "",
    code_challenge_method = "",
  } = req.query as Record<string, string>;

  if (!client_id || !redirect_uri || response_type !== "code") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "client_id, redirect_uri, and response_type=code are required" });
    return;
  }

  // Validate PKCE params if provided
  if (code_challenge && code_challenge_method !== "S256") {
    res.status(400).json({ ok: false, error: "invalid_request", message: "code_challenge_method must be S256" });
    return;
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: client_id } }).catch(() => null);
  if (!client) { res.status(400).json({ ok: false, error: "invalid_client", message: "Unknown client_id" }); return; }
  if (!client.redirectUris.includes(redirect_uri)) {
    res.status(400).json({ ok: false, error: "invalid_redirect_uri", message: "redirect_uri not registered for this client" });
    return;
  }

  res.type("text/html").send(CONSENT_PAGE(client.name, scope, client_id, redirect_uri, state, code_challenge, code_challenge_method));
});

// ─── POST /oauth/authorize (consent form submit) ──────────────────────────────
router.post("/authorize", async (req: Request, res: Response): Promise<void> => {
  const {
    client_id,
    redirect_uri,
    scope,
    state,
    email,
    apiKey,
    code_challenge = "",
    code_challenge_method = "",
  } = req.body as Record<string, string>;

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: client_id } }).catch(() => null);
  if (!client || !client.redirectUris.includes(redirect_uri)) {
    res.status(400).json({ ok: false, error: "invalid_client" });
    return;
  }

  // Verify agent credentials — plaintext keys are no longer stored, bcrypt only.
  const normalizedEmail = String(email ?? "").toLowerCase().trim();
  const agent = await prisma.agent.findUnique({ where: { email: normalizedEmail } }).catch(() => null);
  const validAgent = agent?.apiKeyHash
    ? await bcrypt.compare(apiKey, agent.apiKeyHash).catch(() => false)
    : false;
  if (!agent || !validAgent) {
    res.type("text/html").send(CONSENT_PAGE(client.name, scope, client_id, redirect_uri, state, code_challenge, code_challenge_method, "Invalid email or API key. Check your credentials at archtools.dev."));
    return;
  }

  // Persist only recognized scopes.
  const grantedScope = sanitizeScope(scope);

  // Generate auth code
  const code = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await prisma.oAuthAuthCode.create({
    data: {
      id: crypto.randomUUID(),
      code,
      clientId: client_id,
      agentId: agent.id,
      scope: grantedScope,
      redirectUri: redirect_uri,
      expiresAt,
      // Store PKCE challenge if provided
      ...(code_challenge ? { codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method || "S256" } : {}),
    },
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(302, url.toString());
});

// ─── POST /oauth/token ────────────────────────────────────────────────────────
router.post("/token", async (req: Request, res: Response): Promise<void> => {
  const {
    grant_type,
    code,
    client_id,
    client_secret,
    redirect_uri,
    refresh_token,
    code_verifier,
  } = req.body as Record<string, string>;

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: client_id } }).catch(() => null);
  if (!client) {
    res.status(401).json({ error: "invalid_client" }); return;
  }

  // Client authentication: public clients (PKCE) skip secret check; confidential clients must match
  const isPublicClient = client.isPublic || client.tokenEndpointAuthMethod === "none" || !client.clientSecret;

  if (!isPublicClient) {
    // Confidential client — require and validate client_secret
    if (!client_secret || !client.clientSecret) {
      res.status(401).json({ error: "invalid_client", error_description: "client_secret required for confidential clients" }); return;
    }
    const secretBuf = Buffer.from(client.clientSecret);
    const providedBuf = Buffer.from(client_secret);
    if (secretBuf.length !== providedBuf.length || !timingSafeEqual(secretBuf, providedBuf)) {
      res.status(401).json({ error: "invalid_client" }); return;
    }
  }

  // ── Authorization Code flow ──
  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri) { res.status(400).json({ error: "invalid_request" }); return; }

    const authCode = await prisma.oAuthAuthCode.findUnique({ where: { code } }).catch(() => null);
    if (!authCode || authCode.used || authCode.expiresAt < new Date() || authCode.clientId !== client_id || authCode.redirectUri !== redirect_uri) {
      res.status(400).json({ error: "invalid_grant" }); return;
    }

    // PKCE verification
    if (authCode.codeChallenge) {
      // Code challenge was stored — code_verifier is REQUIRED
      if (!code_verifier) {
        res.status(400).json({ error: "invalid_grant", error_description: "code_verifier is required when PKCE was used" }); return;
      }
      const expectedChallenge = crypto.createHash("sha256").update(code_verifier).digest("base64url");
      if (expectedChallenge !== authCode.codeChallenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" }); return;
      }
    } else if (isPublicClient) {
      // Public client WITHOUT PKCE — reject (OAuth 2.1 requires PKCE for public clients)
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE is required for public clients" }); return;
    }

    // Atomically mark the code used — only the first redemption wins, so a
    // concurrent double-redemption cannot mint two tokens from one code (O-7).
    const claimed = await prisma.oAuthAuthCode.updateMany({ where: { code, used: false }, data: { used: true } });
    if (claimed.count !== 1) {
      res.status(400).json({ error: "invalid_grant" }); return;
    }

    const accessToken = `at_oauth_${crypto.randomBytes(32).toString("base64url")}`;
    const refreshTok = `rt_oauth_${crypto.randomBytes(32).toString("base64url")}`;
    const expiresAt = oauthAccessExpiresAt(); // 1 hour access token

    await prisma.oAuthToken.create({
      data: { id: crypto.randomUUID(), accessToken, refreshToken: refreshTok, clientId: client_id, agentId: authCode.agentId, scope: authCode.scope, expiresAt },
    });

    res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshTok, scope: authCode.scope });
    return;
  }

  // ── Refresh Token flow ──
  if (grant_type === "refresh_token") {
    if (!refresh_token) { res.status(400).json({ error: "invalid_request" }); return; }

    const oldToken = await prisma.oAuthToken.findUnique({ where: { refreshToken: refresh_token } }).catch(() => null);
    if (!oldToken || oldToken.clientId !== client_id || isOAuthRefreshTokenExpired(oldToken)) { res.status(400).json({ error: "invalid_grant" }); return; }

    // Rotate tokens
    const accessToken = `at_oauth_${crypto.randomBytes(32).toString("base64url")}`;
    const newRefresh = `rt_oauth_${crypto.randomBytes(32).toString("base64url")}`;
    const expiresAt = oauthAccessExpiresAt();

    await prisma.oAuthToken.delete({ where: { id: oldToken.id } });
    await prisma.oAuthToken.create({
      data: { id: crypto.randomUUID(), accessToken, refreshToken: newRefresh, clientId: client_id, agentId: oldToken.agentId, scope: oldToken.scope, expiresAt },
    });

    res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: newRefresh, scope: oldToken.scope });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

// ─── POST /oauth/register — Dynamic Client Registration (RFC 7591) ────────────
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const {
    client_name,
    redirect_uris,
    grant_types,
    token_endpoint_auth_method,
    response_types,
  } = req.body as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    token_endpoint_auth_method?: string;
    response_types?: string[];
  };

  // Validate required fields
  if (!client_name || !redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "client_name and redirect_uris are required" });
    return;
  }

  // Validate redirect URIs — must be https or localhost
  for (const uri of redirect_uris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      res.status(400).json({ error: "invalid_redirect_uri", error_description: `Invalid URI: ${uri}` });
      return;
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uris must use https (or localhost for development)" });
      return;
    }
  }

  // Validate grant_types if provided
  const allowedGrantTypes = ["authorization_code", "refresh_token"];
  const requestedGrantTypes = grant_types ?? ["authorization_code", "refresh_token"];
  for (const gt of requestedGrantTypes) {
    if (!allowedGrantTypes.includes(gt)) {
      res.status(400).json({ error: "invalid_client_metadata", error_description: `Unsupported grant_type: ${gt}` });
      return;
    }
  }

  // Validate token_endpoint_auth_method
  const authMethod = token_endpoint_auth_method ?? "none";
  if (!["none", "client_secret_post"].includes(authMethod)) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "token_endpoint_auth_method must be 'none' or 'client_secret_post'" });
    return;
  }

  const clientId = `arch_${crypto.randomBytes(16).toString("hex")}`;
  const isPublic = authMethod === "none";
  const clientSecret = isPublic ? null : crypto.randomBytes(32).toString("base64url");

  await prisma.oAuthClient.create({
    data: {
      id: crypto.randomUUID(),
      clientId,
      clientSecret: clientSecret ?? null,
      name: client_name,
      redirectUris: redirect_uris,
      grantTypes: requestedGrantTypes,
      tokenEndpointAuthMethod: authMethod,
      isPublic,
    },
  });

  const responseBody: Record<string, unknown> = {
    client_id: clientId,
    client_name,
    redirect_uris,
    grant_types: requestedGrantTypes,
    response_types: response_types ?? ["code"],
    token_endpoint_auth_method: authMethod,
  };

  // Only include client_secret for confidential clients
  if (clientSecret) {
    responseBody.client_secret = clientSecret;
  }

  res.status(201).json(responseBody);
});

export default router;
