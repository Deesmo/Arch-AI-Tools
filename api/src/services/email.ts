import { logger } from "../lib/logger.js";

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
export const LOW_CREDIT_THRESHOLD = Number(process.env.LOW_CREDIT_THRESHOLD || 20);

// ─── Core send helper ───
async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  if (!to || !to.includes("@")) {
    logger.debug({ to }, "Email skipped — invalid address");
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
        logger.error({ to, status: r.status, detail }, "Resend email failed");
        return false;
      }
      logger.info({ to, subject }, "Email sent (Resend)");
      return true;
    } catch (e: any) {
      logger.error({ to, error: e.message }, "Resend email error");
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
        logger.error({ to, status: r.status, detail }, "Postmark email failed");
        return false;
      }
      logger.info({ to, subject }, "Email sent (Postmark)");
      return true;
    } catch (e: any) {
      logger.error({ to, error: e.message }, "Postmark email error");
      return false;
    }
  }

  // Dev fallback
  logger.warn({ to, subject }, "Email provider not configured — email skipped (set RESEND_API_KEY)");
  return false;
}

// ─── Shared HTML layout ───
function layout(title: string, body: string, accentColor = "#FF9010"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  body{margin:0;padding:0;background:#07061A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#F0EEFF;}
  img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
  .outer{background:#07061A;padding:32px 16px 48px;}
  .wrap{max-width:560px;margin:0 auto;background:#0D0C24;border:1px solid #1C1A3A;border-radius:16px;overflow:hidden;}

  /* HEADER */
  .header{background:linear-gradient(135deg,#FF9010 0%,#FF2896 100%);padding:32px 36px 28px;}
  .header-logo{display:flex;align-items:center;gap:12px;margin-bottom:4px;}
  .logo-text{font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;}
  .header-sub{font-size:13px;color:rgba(255,255,255,0.75);margin:0;}

  /* BODY */
  .content{padding:32px 36px;}
  .content p{margin:0 0 16px;font-size:15px;line-height:1.65;color:#C4BFDF;}
  .content p strong{color:#F0EEFF;}
  .content a{color:#FF9010;text-decoration:none;}

  /* API KEY BOX */
  .key-warning{background:rgba(255,144,16,0.08);border:1px solid rgba(255,144,16,0.3);border-radius:10px;padding:12px 16px;margin-bottom:12px;font-size:13px;color:#FF9010;font-weight:500;}
  .key-warning::before{content:"⚠️  ";}
  .key-box{background:#070617;border:1px solid #2A2850;border-radius:10px;padding:18px 20px;margin-bottom:20px;word-break:break-all;font-family:'Courier New',Courier,monospace;font-size:14px;color:#AA77FF;letter-spacing:0.3px;line-height:1.6;}

  /* STATS ROW */
  .stats{display:flex;gap:10px;margin:0 0 24px;flex-wrap:wrap;}
  .stat{background:#0D0C24;border:1px solid #1C1A3A;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:600;color:#AA77FF;white-space:nowrap;}
  .stat span{display:block;font-size:11px;font-weight:400;color:#8A85B0;margin-bottom:2px;}

  /* BUTTON */
  .btn-wrap{margin:4px 0 24px;}
  .btn{display:inline-block;background:linear-gradient(135deg,#FF9010,#FF2896);color:#fff!important;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:0.1px;}

  /* DIVIDER */
  .divider{border:none;border-top:1px solid #1C1A3A;margin:24px 0;}

  /* ALERT BOX */
  .alert-warn{background:rgba(255,144,16,0.06);border:1px solid rgba(255,144,16,0.25);border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:14px;color:#FF9010;line-height:1.6;}
  .alert-success{background:rgba(52,211,153,0.06);border:1px solid rgba(52,211,153,0.25);border-radius:10px;padding:16px 20px;margin-bottom:20px;font-size:14px;color:#34d399;line-height:1.6;}

  /* ADMIN TABLE */
  .info-table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  .info-table td{padding:10px 14px;font-size:13px;border-bottom:1px solid #1C1A3A;vertical-align:top;}
  .info-table td:first-child{color:#8A85B0;width:38%;font-weight:500;}
  .info-table td:last-child{color:#F0EEFF;font-family:'Courier New',monospace;word-break:break-all;}
  .info-table tr:last-child td{border-bottom:none;}

  /* FOOTER */
  .footer{padding:20px 36px 24px;border-top:1px solid #1C1A3A;text-align:center;}
  .footer p{margin:0;font-size:12px;color:#4A4570;line-height:1.8;}
  .footer a{color:#8A85B0;text-decoration:none;}
  .footer a:hover{color:#FF9010;}

  @media(max-width:560px){
    .content,.header,.footer{padding-left:24px;padding-right:24px;}
    .stats{flex-direction:column;}
    .stat{width:100%;box-sizing:border-box;}
  }
</style>
</head>
<body>
<div class="outer">
<div class="wrap">
  <div class="header">
    <div class="header-logo">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="8" fill="rgba(0,0,0,0.2)"/>
        <path d="M16 6L28 26H4L16 6Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <span class="logo-text">Arch Tools</span>
    </div>
    <p class="header-sub">AI-native API platform · archtools.dev</p>
  </div>
  <div class="content">${body}</div>
  <div class="footer">
    <p>
      <a href="${SITE}">${SITE}</a> &nbsp;·&nbsp;
      <a href="${SITE}/docs.html">Docs</a> &nbsp;·&nbsp;
      <a href="${SITE}/privacy.html">Privacy</a> &nbsp;·&nbsp;
      <a href="${SITE}/terms.html">Terms</a>
    </p>
    <p style="margin-top:8px;">You're receiving this because you signed up at archtools.dev.</p>
  </div>
</div>
</div>
</body>
</html>`;
}

// ─── 1. Email Verification (magic link) ───
export async function sendVerificationEmail(args: { to: string; verifyUrl: string }): Promise<void> {
  const { to, verifyUrl } = args;
  const subject = "Verify your email for Arch Tools";
  const text = `Verify your email to activate your Arch Tools account.\n\nClick this link (valid for 30 minutes):\n${verifyUrl}\n\nIf you did not request this, you can ignore this email.`;
  const html = layout(subject, `
    <p>One quick step to activate your API key — click the button below to verify your email.</p>
    <div class="btn-wrap"><a class="btn" href="${verifyUrl}">Verify my email →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;margin:0;">This link expires in <strong style="color:#F0EEFF;">30 minutes</strong>. If you didn't sign up, you can safely ignore this email.</p>
    <p style="font-size:12px;color:#4A4570;margin-top:12px;word-break:break-all;">Or copy this link:<br>${verifyUrl}</p>
  `);
  await sendEmail(to, subject, html, text);
  logger.info({ to }, "Verification email sent");
}

// ─── 2. Welcome Email ───
export async function sendWelcomeEmail(to: string, agentId: string, apiKey: string, creditsGranted: number, referralCode?: string): Promise<void> {
  const subject = "Welcome to Arch Tools — Your API key is ready";

  const referralSection = referralCode ? `
    <hr class="divider">
    <h3 style="font-size:16px;font-weight:700;color:#F0EEFF;margin-bottom:8px;">🎁 Share & Earn More Credits</h3>
    <p>Give friends <strong>500 free credits</strong> when they sign up with your referral code — and you get <strong>500 credits</strong> too!</p>
    <div class="key-box" style="font-size:16px;text-align:center;letter-spacing:1px;color:#FF9010;">${referralCode}</div>
    <div class="btn-wrap"><a class="btn" href="${SITE}/refer.html" style="background:linear-gradient(135deg,#AA77FF,#FF2896);">Share your referral link →</a></div>
  ` : "";

  const html = layout(subject, `
    <p>You're in. Here's your API key — <strong>copy it now and store it somewhere safe. It cannot be retrieved again.</strong></p>
    <div class="key-warning">Save this key now — it won't be shown again after you close this email.</div>
    <div class="key-box">${apiKey}</div>
    <div class="stats">
      <div class="stat"><span>Credits granted</span>${creditsGranted.toLocaleString()}</div>
      <div class="stat"><span>Plan</span>Free</div>
      <div class="stat"><span>Agent ID</span>${agentId.slice(0, 14)}…</div>
    </div>
    <p>That's <strong>${creditsGranted.toLocaleString()} free credits</strong> to explore all 63 AI tools — enough to really put Arch Tools through its paces.</p>
    <p>Use your key in any HTTP request:</p>
    <div class="key-box" style="font-size:13px;">x-api-key: ${apiKey.slice(0, 12)}…</div>
    <div class="btn-wrap"><a class="btn" href="${SITE}/docs.html">Read the docs →</a></div>
    ${referralSection}
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Credits never expire. When you're ready to scale, grab a credit pack at <a href="${SITE}/#pricing">archtools.dev/pricing</a>.</p>
  `);
  const text = `Welcome to Arch Tools!\n\nYour API key (save this — it can't be retrieved later):\n${apiKey}\n\nCredits granted: ${creditsGranted}\nAgent ID: ${agentId}\n\n${referralCode ? `Your referral code: ${referralCode}\nShare it and you both get 500 bonus credits!\n\n` : ""}Docs: ${SITE}/docs\nPricing: ${SITE}/#pricing`;
  await sendEmail(to, subject, html, text);
}

// ─── 3. Low Credit Alert ───
export async function sendLowCreditAlert(to: string, creditsRemaining: number, agentId: string): Promise<void> {
  const subject = `⚠️ Low credits — ${creditsRemaining} remaining on Arch Tools`;
  const html = layout(subject, `
    <div class="alert-warn"><strong>⚠️ Running low:</strong> You have <strong>${creditsRemaining} credits</strong> remaining. Top up now to keep your pipelines running without interruption.</div>
    <p>Add credits with one click — they never expire and stack on your existing balance.</p>
    <div class="stats">
      <div class="stat"><span>Starter</span>1,000 credits · $9</div>
      <div class="stat"><span>Pro</span>10,000 credits · $49</div>
      <div class="stat"><span>Business</span>100,000 credits · $199</div>
    </div>
    <div class="btn-wrap"><a class="btn" href="${SITE}/#pricing">Top up credits →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Agent: ${agentId.slice(0, 20)}…</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── 4. Purchase Confirmation ───
export async function sendPurchaseConfirmation(to: string, credits: number, label: string, newBalance: number): Promise<void> {
  const subject = `✅ ${credits.toLocaleString()} credits added to your Arch Tools account`;
  const html = layout(subject, `
    <div class="alert-success">✅ Payment received — <strong>${credits.toLocaleString()} credits</strong> have been added to your account instantly.</div>
    <div class="stats">
      <div class="stat"><span>Pack purchased</span>${label}</div>
      <div class="stat"><span>Credits added</span>+${credits.toLocaleString()}</div>
      <div class="stat"><span>New balance</span>${newBalance.toLocaleString()}</div>
    </div>
    <div class="btn-wrap"><a class="btn" href="${SITE}/docs.html">Start building →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Credits never expire. Questions? Reply to this email and we'll get back to you.</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── 5. Admin Alert (new payment / new signup) ───
export async function sendAdminAlert(subject: string, body: string): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (!adminEmail) return;

  // Parse key: value lines into a table for readability
  const rows = body.split("\n")
    .filter(l => l.trim())
    .map(line => {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        return `<tr><td>${key}</td><td>${val}</td></tr>`;
      }
      return `<tr><td colspan="2" style="color:#F0EEFF;">${line}</td></tr>`;
    })
    .join("");

  const html = layout(subject, `
    <p style="font-size:13px;color:#8A85B0;margin-bottom:16px;">Arch Tools · ${new Date().toUTCString()}</p>
    <table class="info-table">${rows}</table>
  `);

  await sendEmail(adminEmail, subject, html);
}

// ─── 6. Monthly Refresh ───
export async function sendMonthlyRefreshEmail(to: string, credits: number, newBalance: number): Promise<void> {
  const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
  const subject = `🔄 Your ${credits} free Arch Tools credits are refreshed for ${month}`;
  const html = layout(subject, `
    <div class="alert-success">🔄 Your free monthly credits have been refreshed for <strong>${month}</strong>.</div>
    <div class="stats">
      <div class="stat"><span>Credits added</span>+${credits.toLocaleString()}</div>
      <div class="stat"><span>New balance</span>${newBalance.toLocaleString()}</div>
    </div>
    <div class="btn-wrap"><a class="btn" href="${SITE}/docs.html">Start building →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Need more credits? <a href="${SITE}/#pricing">Upgrade your plan</a> for up to 100,000 credits per month.</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── 7. Feature Announcement (broadcast) ───
export async function sendFeatureAnnouncement(to: string, opts: {
  headline: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): Promise<boolean> {
  const { headline, body: bodyText, ctaLabel, ctaUrl } = opts;
  const subject = `🚀 ${headline} — Arch Tools`;

  // Convert newlines in body to <br> for HTML
  const htmlBody = bodyText.replace(/\n/g, "<br>");
  const cta = ctaLabel && ctaUrl
    ? `<div class="btn-wrap"><a class="btn" href="${ctaUrl}">${ctaLabel} →</a></div>`
    : "";

  const html = layout(subject, `
    <h2 style="font-size:22px;font-weight:800;margin-bottom:12px;color:#F0EEFF;">${headline}</h2>
    <p>${htmlBody}</p>
    ${cta}
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">You're receiving this because you signed up at archtools.dev. <a href="${SITE}">Visit dashboard →</a></p>
  `);
  const text = `${headline}\n\n${bodyText}\n\n${ctaUrl ? `Learn more: ${ctaUrl}` : `Visit: ${SITE}`}`;
  return sendEmail(to, subject, html, text);
}

// ─── 8. x402 Payment Receipt ───
export async function sendX402PaymentReceipt(to: string, opts: {
  toolName: string;
  amountUsdc: string;
  txHash: string;
  network: string;
}): Promise<void> {
  const { toolName, amountUsdc, txHash, network } = opts;
  const subject = `✅ x402 payment confirmed — ${toolName}`;
  const explorerUrl = network === "base"
    ? `https://basescan.org/tx/${txHash}`
    : `https://etherscan.io/tx/${txHash}`;
  const html = layout(subject, `
    <div class="alert-success">✅ Your x402 payment for <strong>${toolName}</strong> has been verified and settled.</div>
    <table class="info-table">
      <tr><td>Tool</td><td>${toolName}</td></tr>
      <tr><td>Amount</td><td>${amountUsdc} USDC</td></tr>
      <tr><td>Network</td><td>${network}</td></tr>
      <tr><td>Transaction</td><td><a href="${explorerUrl}" style="color:#AA77FF;">${txHash.slice(0, 10)}…${txHash.slice(-8)}</a></td></tr>
    </table>
    <div class="btn-wrap"><a class="btn" href="${explorerUrl}">View on Explorer →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">This receipt confirms a one-time x402 protocol payment. No subscription — pay only when you call.</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── 9. Password Reset ───
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = "Reset your Arch Tools password";
  const html = layout(subject, `
    <h2 style="font-size:20px;font-weight:800;margin-bottom:8px;color:#F0EEFF;">Reset your password</h2>
    <p style="font-size:14px;color:#8A85B0;margin-bottom:24px;">Click the button below to set a new password. This link expires in 1 hour.</p>
    <div class="btn-wrap"><a class="btn" href="${resetUrl}">Reset Password →</a></div>
    <p style="font-size:12px;color:#5A557A;margin-top:20px;">If you didn't request this, ignore this email. Your password won't change.</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── Day-3 Follow-up Email ───────────────────────────────────────────────────
export async function sendDay3FollowupEmail(to: string, agentId: string, creditsRemaining: number): Promise<void> {
  const subject = "Quick tip from Arch Tools — your most-used tools";
  const html = layout(subject, `
    <p>Three days in. Here's a quick tip on getting more out of Arch Tools.</p>
    <p>The tools developers use most:</p>
    <div class="stats">
      <div class="stat"><span>Most popular</span>ai-generate (Claude, GPT, Grok)</div>
      <div class="stat"><span>Fastest</span>generate-hash, generate-uuid</div>
      <div class="stat"><span>Most powerful</span>web-scrape + ai-generate chained</div>
    </div>
    <p>You have <strong>${creditsRemaining} credits</strong> remaining. Run them through the playground to see the full x402 payment flow in action.</p>
    <div class="btn-wrap"><a class="btn" href="${SITE}/playground">Try the x402 Playground →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Agent: ${agentId.slice(0,14)}… · Unsubscribe: reply with "stop"</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── Day-7 Re-engagement Email ───────────────────────────────────────────────
export async function sendDay7ReengagementEmail(to: string, creditsRemaining: number): Promise<void> {
  const subject = "Still building with Arch Tools?";
  const html = layout(subject, `
    <p>A week in. Just checking — are you getting value from Arch Tools?</p>
    <p>If you haven't tried x402 payments yet, here's what they unlock:</p>
    <div class="stats">
      <div class="stat"><span>For agents</span>Pay per-call with USDC, no API key needed</div>
      <div class="stat"><span>Chains</span>Base, Ethereum, Solana, Polygon + 12 more</div>
      <div class="stat"><span>Cost</span>As low as $0.001 per call</div>
    </div>
    <p>You have <strong>${creditsRemaining} credits</strong> left. When they run out, your agents can keep going via x402 without any human intervention.</p>
    <div class="btn-wrap"><a class="btn" href="${SITE}/playground">Test x402 Payments →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Reply "stop" to unsubscribe.</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── 80% Credit Consumption Alert ────────────────────────────────────────────
export async function sendEmail80PctAlert(to: string, creditsRemaining: number, agentId: string): Promise<void> {
  const subject = `⚠️ 80% of your Arch Tools credits used — ${creditsRemaining} remaining`;
  const html = layout(subject, `
    <div class="alert-warn"><strong>⚠️ 80% consumed:</strong> You've used most of your credits. Only <strong>${creditsRemaining}</strong> remain.</div>
    <p>Top up now to avoid interruptions. Your agents will receive a <code>402</code> response when credits hit zero — but they can still pay per-call via x402 USDC.</p>
    <div class="stats">
      <div class="stat"><span>Starter</span>1,000 credits · $9</div>
      <div class="stat"><span>Pro</span>10,000 credits · $49</div>
      <div class="stat"><span>Business</span>100,000 credits · $199</div>
    </div>
    <div class="btn-wrap"><a class="btn" href="${SITE}/pricing">Upgrade now →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Agent: ${agentId.slice(0, 20)}… · Reply "stop" to unsubscribe.</p>
  `);
  await sendEmail(to, subject, html);
}

// ─── Credits Depleted (0 remaining) Alert ────────────────────────────────────
export async function sendCreditsDepletedAlert(to: string, agentId: string): Promise<void> {
  const subject = `🚨 Your Arch Tools credits are depleted — upgrade to continue`;
  const html = layout(subject, `
    <div class="alert-warn"><strong>🚨 Credits depleted:</strong> Your credit balance has hit <strong>0</strong>. API calls will return <code>402 Payment Required</code>.</div>
    <p>Two ways to keep building:</p>
    <div class="stats">
      <div class="stat"><span>Option 1</span>Buy credits at archtools.dev/pricing</div>
      <div class="stat"><span>Option 2</span>Pay per-call with USDC via x402 protocol</div>
    </div>
    <p>Your agents can still make calls — they just need to include an <code>X-Payment</code> header with a signed USDC payment. <a href="${SITE}/x402-guide">Learn about x402 →</a></p>
    <div class="btn-wrap"><a class="btn" href="${SITE}/pricing">Buy credits →</a></div>
    <hr class="divider">
    <p style="font-size:13px;color:#8A85B0;">Agent: ${agentId.slice(0, 20)}… · Reply "stop" to unsubscribe.</p>
  `);
  await sendEmail(to, subject, html);
}
