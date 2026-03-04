import { Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { prisma } from "../db.js";
import { logger } from "../lib/logger.js";
import { newApiKey } from "../lib/crypto.js";
import { requireApiKey } from "../middleware/auth.js";
import { SIGNUP_HTML } from "../assets/signupHtml.js";
import { sendVerificationEmail } from "../services/email.js";
import { verifyTurnstile } from "../lib/captcha.js";
import { isDisposableEmail } from "../lib/disposableEmails.js";
export const authRouter = Router();
function normalizeEmail(raw) {
    const email = String(raw || "").trim().toLowerCase();
    if (!email)
        return null;
    if (email.length > 254)
        return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return null;
    return email;
}
function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
function monthKey(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}
async function ensureMonthlyFreeCredits(agentId) {
    const credits = Number(process.env.FREE_MONTHLY_CREDITS || 100);
    if (!Number.isFinite(credits) || credits <= 0)
        return;
    const key = monthKey(new Date());
    // CreditGrant has a unique constraint (agentId, source, reference)
    // Use reference = monthly_YYYY-MM to ensure once/month.
    await prisma.creditGrant
        .create({
        data: {
            agentId,
            credits: Math.floor(credits),
            source: "monthly_free",
            reference: `monthly_${key}`,
        },
    })
        .catch((_e) => {
        // already granted this month
    });
}
// Premium /signup page
authRouter.get("/signup", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(SIGNUP_HTML);
});
// Rate limit signup to reduce abuse
const signupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: true }, // keep response shape generic
});
/**
 * POST /v1/auth/signup
 * Always returns a generic success response to prevent account enumeration.
 */
authRouter.post("/v1/auth/signup", signupLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    // Always respond 200 with a generic message.
    // We still do server-side work when email is valid.
    res.status(200).json({ ok: true });
    if (!email)
        return;
    // Block disposable/throwaway email domains
    if (isDisposableEmail(email)) {
        logger.warn({ email }, "Signup blocked — disposable email domain");
        return;
    }
    // Verify Turnstile CAPTCHA if configured (no-op in dev when key not set)
    const captchaToken = String(req.body?.captchaToken || req.body?.["cf-turnstile-response"] || "");
    const ip = String((req.headers["x-forwarded-for"] || req.ip || "")).slice(0, 200);
    const captchaResult = await verifyTurnstile(captchaToken, ip);
    if (!captchaResult.success) {
        logger.warn({ email, ip, error: captchaResult.error }, "Signup blocked — captcha failed");
        return;
    }
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    try {
        const user = await prisma.user.upsert({
            where: { email },
            update: {},
            create: { email },
        });
        // Create a single-use token, store only the hash
        const token = crypto.randomBytes(32).toString("base64url");
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes
        await prisma.emailVerification.create({
            data: {
                userId: user.id,
                email,
                tokenHash,
                expiresAt,
                ip,
                userAgent: ua,
            },
        });
        const publicSite = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
        const verifyUrl = `${publicSite}/v1/auth/verify?token=${encodeURIComponent(token)}`;
        await sendVerificationEmail({
            to: email,
            verifyUrl,
        });
        logger.info({ email }, "Signup magic link sent");
    }
    catch (e) {
        logger.error({ err: e?.message, email }, "Signup failed");
    }
});
/**
 * GET /v1/auth/verify?token=...
 * Verifies email, creates default agent + API key (if needed), grants monthly credits.
 */
authRouter.get("/v1/auth/verify", async (req, res) => {
    const token = String(req.query.token || "");
    if (!token)
        return res.status(400).send("Missing token");
    const tokenHash = hashToken(token);
    const record = await prisma.emailVerification.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        include: { user: true },
    });
    if (!record) {
        res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Invalid link</title></head><body style="font-family:system-ui;padding:24px;">` +
            `<h2>Invalid or expired link</h2><p>Please request a new verification link.</p><p><a href="/signup">Go to signup</a></p>` +
            `</body></html>`);
    }
    const email = record.user.email;
    // Mark token used + user verified
    await prisma.$transaction(async (tx) => {
        await tx.emailVerification.update({ where: { id: record.id }, data: { usedAt: new Date() } });
        await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    });
    // Ensure agent exists (1:1 with user)
    let agent = await prisma.agent.findFirst({ where: { userId: record.userId } });
    if (!agent) {
        agent = await prisma.agent.create({
            data: {
                name: email.split("@")[0].slice(0, 80) || "agent",
                email,
                plan: "free",
                userId: record.userId,
            },
        });
    }
    // Create a new API key for the user and show it once.
    const { raw, prefix, hash } = newApiKey();
    await prisma.apiKey.create({ data: { agentId: agent.id, keyHash: hash, prefix } });
    // Grant monthly free credits (only for verified users)
    await ensureMonthlyFreeCredits(agent.id);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arch Tools — Verified</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#0b0f19;--card:rgba(255,255,255,0.06);--border:rgba(255,255,255,0.12);--text:rgba(255,255,255,0.92);--muted:rgba(255,255,255,0.70);--accent:#22d3ee;--accent2:#4f46e5;}
    *{box-sizing:border-box;} body{margin:0;font-family:Inter,system-ui;background:var(--bg);color:var(--text);min-height:100vh;display:grid;place-items:center;padding:26px 16px;}
    .card{width:100%;max-width:720px;background:var(--card);border:1px solid var(--border);border-radius:18px;padding:22px;}
    h1{margin:0 0 6px;font-size:26px;letter-spacing:-0.03em;} p{margin:0 0 14px;color:var(--muted);line-height:1.5;}
    .key{font-family:"JetBrains Mono",ui-monospace,monospace;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;gap:10px;align-items:center;justify-content:space-between;overflow:auto;}
    .k{white-space:nowrap;} button{border:0;border-radius:10px;padding:10px 12px;font-weight:700;cursor:pointer;color:#071018;background:linear-gradient(135deg,var(--accent2),var(--accent));}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;} a.btn{display:inline-block;text-decoration:none;color:var(--text);border:1px solid var(--border);padding:10px 12px;border-radius:10px;}
  </style>
</head>
<body>
  <div class="card">
    <h1>Email verified ✅</h1>
    <p>Your API key was created. Copy it now — for security it won’t be shown again.</p>
    <div class="key">
      <div class="k" id="k">${raw}</div>
      <button onclick="navigator.clipboard.writeText(document.getElementById('k').textContent)">Copy</button>
    </div>
    <p style="margin-top:12px">You also received your monthly free credits (if eligible). You can now call tools using <span style="font-family:JetBrains Mono">Authorization: Bearer</span>.</p>
    <div class="row">
      <a class="btn" href="/docs">View Docs</a>
      <a class="btn" href="/openapi.json">OpenAPI</a>
      <a class="btn" href="/">Home</a>
    </div>
  </div>
</body>
</html>`);
});
/**
 * GET /v1/whoami
 * Requires API key.
 */
authRouter.get("/v1/whoami", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent)
        return res.status(404).json({ error: "agent_not_found" });
    const user = agent.userId ? await prisma.user.findUnique({ where: { id: agent.userId } }) : null;
    res.json({
        agent: { id: agent.id, name: agent.name, plan: agent.plan, email: agent.email },
        user: user ? { id: user.id, email: user.email, email_verified: Boolean(user.emailVerifiedAt) } : null,
    });
});
//# sourceMappingURL=auth.js.map