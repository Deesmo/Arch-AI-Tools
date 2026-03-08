"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOW_CREDIT_THRESHOLD = void 0;
exports.sendVerificationEmail = sendVerificationEmail;
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.sendLowCreditAlert = sendLowCreditAlert;
exports.sendPurchaseConfirmation = sendPurchaseConfirmation;
exports.sendMonthlyRefreshEmail = sendMonthlyRefreshEmail;
const logger_1 = require("../lib/logger");
/**
 * Arch Tools — Email Service
 *
 * Providers (in priority order):
 *   1. Resend (RESEND_API_KEY) — recommended, free 3k emails/mo
 *   2. Postmark (POSTMARK_SERVER_TOKEN)
 *   3. Dev fallback — logs link only (safe for local dev)
 *
 * Optional:
 *   EMAIL_FROM — defaults to "Arch Tools <no-reply@archtools.dev>"
 */
const FROM = process.env.EMAIL_FROM || "Arch Tools <no-reply@archtools.dev>";
const SITE = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
// Low credit alert threshold
exports.LOW_CREDIT_THRESHOLD = Number(process.env.LOW_CREDIT_THRESHOLD || 20);
// ─── Core send helper ───
async function sendEmail(to, subject, html, text) {
    if (!to || !to.includes("@")) {
        logger_1.logger.debug({ to }, "Email skipped — invalid address");
        return false;
    }
    // Resend
    if (process.env.RESEND_API_KEY) {
        try {
            const r = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from: FROM, to, subject, html, ...(text ? { text } : {}) }),
            });
            if (!r.ok) {
                const detail = await r.text().catch(() => "");
                logger_1.logger.error({ to, status: r.status, detail }, "Resend email failed");
                return false;
            }
            logger_1.logger.info({ to, subject }, "Email sent (Resend)");
            return true;
        }
        catch (e) {
            logger_1.logger.error({ to, error: e.message }, "Resend email error");
            return false;
        }
    }
    // Postmark
    if (process.env.POSTMARK_SERVER_TOKEN) {
        try {
            const r = await fetch("https://api.postmarkapp.com/email", {
                method: "POST",
                headers: { "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN, "Content-Type": "application/json" },
                body: JSON.stringify({ From: FROM, To: to, Subject: subject, HtmlBody: html, ...(text ? { TextBody: text } : {}), MessageStream: "outbound" }),
            });
            if (!r.ok) {
                const detail = await r.text().catch(() => "");
                logger_1.logger.error({ to, status: r.status, detail }, "Postmark email failed");
                return false;
            }
            logger_1.logger.info({ to, subject }, "Email sent (Postmark)");
            return true;
        }
        catch (e) {
            logger_1.logger.error({ to, error: e.message }, "Postmark email error");
            return false;
        }
    }
    // Dev fallback
    logger_1.logger.warn({ to, subject }, "Email provider not configured — email skipped (set RESEND_API_KEY)");
    return false;
}
// ─── Shared HTML layout ───
function layout(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e5e5}
  .wrap{max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:12px;overflow:hidden}
  .header{background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px 36px}
  .header h1{margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px}
  .header p{margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.7)}
  .body{padding:32px 36px}
  .body p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#ccc}
  .code{background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px 20px;font-family:'Courier New',monospace;font-size:13px;color:#a78bfa;word-break:break-all;margin:0 0 20px}
  .btn{display:inline-block;background:#7c3aed;color:#fff!important;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin:4px 0 20px}
  .stat{display:inline-block;background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:12px 20px;margin:0 8px 8px 0;font-size:13px;color:#a78bfa;font-weight:600}
  .warn{background:#1a0a00;border:1px solid #7c3000;border-radius:8px;padding:16px 20px;margin:0 0 20px;font-size:14px;color:#f97316}
  .footer{padding:20px 36px;border-top:1px solid #1a1a1a;font-size:12px;color:#555;text-align:center}
  .footer a{color:#7c3aed;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>⚡ Arch Tools</h1>
    <p>Production-ready tools for developers &amp; AI agents</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">
    <a href="${SITE}">${SITE}</a> &nbsp;·&nbsp;
    <a href="${SITE}/legal/privacy">Privacy</a> &nbsp;·&nbsp;
    <a href="${SITE}/legal/terms">Terms</a>
  </div>
</div>
</body></html>`;
}
// ─── 1. Email Verification (magic link) ───
// Called by auth.ts after signup
async function sendVerificationEmail(args) {
    const { to, verifyUrl } = args;
    const subject = "Verify your email for Arch Tools";
    const text = `Verify your email to activate your Arch Tools account.\n\nClick this link (valid for 30 minutes):\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`;
    const html = layout(subject, `
    <p>Click the button below to verify your email and activate your Arch Tools API key.</p>
    <a class="btn" href="${verifyUrl}">Verify email →</a>
    <p style="font-size:13px;color:#666">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    <p style="font-size:12px;color:#444;word-break:break-all">Or copy this link: ${verifyUrl}</p>
  `);
    await sendEmail(to, subject, html, text);
    logger_1.logger.info({ to }, "Verification email sent");
}
// ─── 2. Welcome Email ───
async function sendWelcomeEmail(to, agentId, apiKey, creditsGranted) {
    const subject = "Welcome to Arch Tools — Your API key is ready";
    const html = layout(subject, `
    <p>You're all set. Here's your API key — <strong>save it now, it can't be retrieved later.</strong></p>
    <div class="code">${apiKey}</div>
    <p>You've been granted <strong>${creditsGranted} free credits</strong> to get started.</p>
    <div>
      <span class="stat">Agent: ${agentId.slice(0, 12)}…</span>
      <span class="stat">${creditsGranted} credits</span>
      <span class="stat">Free plan</span>
    </div>
    <br>
    <a class="btn" href="${SITE}/docs">View Docs →</a>
    <p style="font-size:13px;color:#666">Credits never expire. When you're ready to scale, grab a pack at <a href="${SITE}/pricing" style="color:#7c3aed">archtools.dev/pricing</a>.</p>
  `);
    await sendEmail(to, subject, html);
}
// ─── 3. Low Credit Alert ───
async function sendLowCreditAlert(to, creditsRemaining, agentId) {
    const subject = `⚠️ Low credits — ${creditsRemaining} remaining on Arch Tools`;
    const html = layout(subject, `
    <div class="warn">⚠️ Your account is running low — <strong>${creditsRemaining} credits remaining</strong>.</div>
    <p>Top up now to keep your pipelines running without interruption.</p>
    <a class="btn" href="${SITE}/pricing">Buy credits →</a>
    <div>
      <span class="stat">Starter — 1,000 cr · $9</span>
      <span class="stat">Pro — 10,000 cr · $49</span>
      <span class="stat">Business — 100,000 cr · $199</span>
    </div>
    <br>
    <p style="font-size:13px;color:#666">Agent: ${agentId.slice(0, 16)}…</p>
  `);
    await sendEmail(to, subject, html);
}
// ─── 4. Purchase Confirmation ───
async function sendPurchaseConfirmation(to, credits, label, newBalance) {
    const subject = `✅ ${credits.toLocaleString()} credits added to your Arch Tools account`;
    const html = layout(subject, `
    <p>Your payment was received and credits have been added to your account.</p>
    <div>
      <span class="stat">Pack: ${label}</span>
      <span class="stat">+${credits.toLocaleString()} credits</span>
      <span class="stat">Balance: ${newBalance.toLocaleString()}</span>
    </div>
    <br>
    <a class="btn" href="${SITE}/dashboard">View Dashboard →</a>
    <p style="font-size:13px;color:#666">Credits never expire. Questions? Reply to this email.</p>
  `);
    await sendEmail(to, subject, html);
}
// ─── 5. Monthly Refresh ───
async function sendMonthlyRefreshEmail(to, credits, newBalance) {
    const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
    const subject = `🔄 Your ${credits} free Arch Tools credits are refreshed for ${month}`;
    const html = layout(subject, `
    <p>Your free monthly credits have been refreshed for <strong>${month}</strong>.</p>
    <div>
      <span class="stat">+${credits} credits added</span>
      <span class="stat">Balance: ${newBalance.toLocaleString()}</span>
    </div>
    <br>
    <a class="btn" href="${SITE}/docs">Start building →</a>
    <p style="font-size:13px;color:#666">Need more? <a href="${SITE}/pricing" style="color:#7c3aed">Upgrade your plan</a> for up to 100,000 credits.</p>
  `);
    await sendEmail(to, subject, html);
}
//# sourceMappingURL=email.js.map