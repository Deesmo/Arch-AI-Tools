import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { sendPasswordResetEmail } from "../services/email.js";
import { captureEvent, identifyUser } from "../lib/posthog.js";

const router = Router();

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET env var is not set. Refusing to start. Set a strong random secret.");
}
const JWT_SECRET = process.env.JWT_SECRET;

const COOKIE_NAME = "arch_session";
const DUMMY_BCRYPT_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8y4q0h0iI1GtIsfRSAxEPPYUajFBlW";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_JWT = "7d";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: SESSION_TTL_MS,
  path: "/",
};
// Client-readable (non-httpOnly) marker that this browser has an account, so
// pages like /pricing can send an expired-session user to /login instead of
// /signup on a 401. Outlives the session on purpose; never cleared on logout.
const HAS_ACCOUNT_COOKIE = "arch_has_account";
const HAS_ACCOUNT_COOKIE_OPTS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 365 * 24 * 60 * 60 * 1000,
  path: "/",
};

function setSessionCookies(res: Response, agentId: string): void {
  res.cookie(COOKIE_NAME, signSession(agentId), COOKIE_OPTS);
  res.cookie(HAS_ACCOUNT_COOKIE, "1", HAS_ACCOUNT_COOKIE_OPTS);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { ok: false, error: "too_many_attempts", message: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  message: { ok: false, error: "too_many_requests", message: "Too many reset requests. Try again in 5 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Protect token-consuming / credential-setting endpoints from brute force.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, error: "too_many_attempts", message: "Too many attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

export function signSession(agentId: string): string {
  return jwt.sign({ sub: agentId }, JWT_SECRET, { expiresIn: SESSION_TTL_JWT });
}

export function verifySession(token: string): { sub: string } | null {
  try {
    // Pin the algorithm so a token cannot be presented with a different/none alg.
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as { sub: string };
  } catch {
    return null;
  }
}

async function findAgentByApiKey(apiKey: string) {
  // Plaintext keys are no longer stored — prefix lookup + bcrypt compare only.
  const prefix = apiKey.slice(0, 12);
  const candidate = await prisma.agent.findFirst({ where: { apiKeyPrefix: prefix } }).catch(() => null);
  if (candidate?.apiKeyHash) {
    const match = await bcrypt.compare(apiKey, candidate.apiKeyHash).catch(() => false);
    if (match) return candidate;
  }
  return null;
}

router.post("/login-key", loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { api_key } = req.body ?? {};
  if (!api_key || typeof api_key !== "string" || !api_key.startsWith("arch_")) {
    res.status(400).json({ ok: false, error: "invalid_api_key", message: "A valid API key starting with arch_ is required." });
    return;
  }

  const agent = await findAgentByApiKey(api_key);
  if (!agent) {
    res.status(401).json({ ok: false, error: "invalid_api_key", message: "Invalid API key." });
    return;
  }

  setSessionCookies(res, agent.id);
  logger.info({ agentId: agent.id }, "Agent logged in via API key");
  captureEvent(agent.id, "login", { method: "api_key" });
  res.json({ ok: true, redirect: "/dashboard" });
});

router.post("/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    res.status(400).json({ ok: false, error: "email_and_password_required" });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const agent = await prisma.agent.findUnique({ where: { email: normalizedEmail } });
    if (!agent) {
      bcrypt.compareSync(password, DUMMY_BCRYPT_HASH);
      res.status(401).json({ ok: false, error: "invalid_credentials" });
      return;
    }

    if (!agent.passwordHash || typeof agent.passwordHash !== "string") {
      // Don't reveal that the account exists but has no password (enumeration).
      // Run a dummy compare so timing matches the wrong-password path (R-6).
      bcrypt.compareSync(password, DUMMY_BCRYPT_HASH);
      res.status(401).json({ ok: false, error: "invalid_credentials", message: "Invalid email or password." });
      return;
    }

    const valid = bcrypt.compareSync(password, agent.passwordHash);
    if (!valid) {
      res.status(401).json({ ok: false, error: "invalid_credentials", message: "Invalid email or password." });
      return;
    }

    setSessionCookies(res, agent.id);
    logger.info({ agentId: agent.id }, "Agent logged in");
    captureEvent(agent.id, "login", { method: "email_password" });
    res.json({ ok: true, redirect: "/dashboard" });
  } catch (error) {
    logger.error({ error, email }, "Email login failed");
    res.status(500).json({ ok: false, error: "login_failed", message: "Unable to log in right now. Please try again." });
  }
});

router.post("/set-password", sensitiveLimiter, async (req: Request, res: Response): Promise<void> => {
  const { api_key, password } = req.body ?? {};
  if (typeof api_key !== "string" || typeof password !== "string" || !api_key || !password) {
    res.status(400).json({ ok: false, error: "api_key_and_password_required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ ok: false, error: "password_too_short", message: "Password must be at least 8 characters." });
    return;
  }

  try {
    const agent = await findAgentByApiKey(api_key);
    if (!agent) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    await prisma.agent.update({ where: { id: agent.id }, data: { passwordHash: hash } });

    setSessionCookies(res, agent.id);
    logger.info({ agentId: agent.id }, "Agent set password + logged in");
    captureEvent(agent.id, "signup_password_set", { email: agent.email, tier: agent.tier });
    identifyUser(agent.id, { email: agent.email, tier: agent.tier, credits: agent.credits });
    res.json({ ok: true, redirect: "/dashboard" });
  } catch (error) {
    logger.error({ error }, "Set password failed");
    res.status(500).json({ ok: false, error: "set_password_failed", message: "Unable to save your password right now. Please try again." });
  }
});

router.get("/logout", (_req: Request, res: Response): void => {
  res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const });
  res.cookie(COOKIE_NAME, "", { ...COOKIE_OPTS, maxAge: 0 });
  res.redirect("/login");
});

router.get("/me", async (req: Request, res: Response): Promise<void> => {
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
  res.json({
    ok: true,
    agent_id: agent.id,
    email: agent.email,
    credits: agent.credits,
    tier: agent.tier,
    created_at: agent.createdAt,
  });
});

router.get("/api-key", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) { res.status(401).json({ ok: false, error: "not_authenticated" }); return; }
  const payload = verifySession(token);
  if (!payload) { res.status(401).json({ ok: false, error: "session_expired" }); return; }
  const agent = await prisma.agent.findUnique({ where: { id: payload.sub } });
  if (!agent) { res.status(401).json({ ok: false, error: "agent_not_found" }); return; }
  // Plaintext keys are no longer stored — only the prefix can be shown.
  // Full keys are returned exactly once at registration/rotation.
  const masked = agent.apiKeyPrefix ? `${agent.apiKeyPrefix}…` : null;
  res.json({ ok: true, api_key_masked: masked, api_key: null, message: "Full API keys are shown only once at creation. Rotate via POST /v1/agent/keys/rotate if you lost yours." });
});

export default router;

router.post("/forgot-password", forgotLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ ok: false, error: "email_required" });
    return;
  }
  const agent = await prisma.agent.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (agent) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.agent.update({
      where: { id: agent.id },
      data: { resetToken: token, resetTokenExpiry: expiry },
    });
    const resetUrl = `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/auth/reset-password?token=${token}`;
    await sendPasswordResetEmail(agent.email, resetUrl);
  }
  res.json({ ok: true, message: "If an account exists with that email, a reset link has been sent." });
});

router.get("/reset-password", (_req: Request, res: Response): void => {
  // SECURITY: the token is interpolated into inline JS below. Reset tokens are
  // hex (crypto.randomBytes.toString("hex")), so strip everything non-hex to
  // neutralize reflected XSS via a crafted ?token=' + payload.
  const token = String(_req.query.token ?? "").replace(/[^a-fA-F0-9]/g, "").slice(0, 128);
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Arch Tools - Reset Password</title>
  <link rel="icon" href="/arch-icon.svg?v=2" type="image/svg+xml">
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
  <button onclick="doReset()">Set Password -&gt;</button>
</div>
<script>
  async function doReset() {
    var pw = document.getElementById('pw').value;
    var pw2 = document.getElementById('pw2').value;
    var st = document.getElementById('status');
    if (pw.length < 8) { st.style.color='#f87171'; st.textContent='Password must be at least 8 characters.'; return; }
    if (pw !== pw2) { st.style.color='#f87171'; st.textContent='Passwords do not match.'; return; }
    st.style.color='rgba(255,255,255,0.5)'; st.textContent='Setting password...';
    var r = await fetch('/auth/reset-password', {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ token: '${token}', password: pw })
    });
    var d = await r.json();
    if (d.ok) { st.style.color='#34d399'; st.textContent='Password set. Redirecting...'; setTimeout(()=>window.location.href='/dashboard',1200); }
    else { st.style.color='#f87171'; st.textContent = d.message || 'Invalid or expired link. Request a new one.'; }
  }
</script>
</body></html>`);
});

router.post("/reset-password", sensitiveLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body ?? {};
  if (!token || !password) {
    res.status(400).json({ ok: false, error: "token_and_password_required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
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

  const hash = bcrypt.hashSync(password, 10);
  await prisma.agent.update({
    where: { id: agent.id },
    data: { passwordHash: hash, resetToken: null, resetTokenExpiry: null },
  });

  setSessionCookies(res, agent.id);
  logger.info({ agentId: agent.id }, "Agent reset password + logged in");
  res.json({ ok: true, redirect: "/dashboard" });
});
