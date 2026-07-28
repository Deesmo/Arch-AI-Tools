/**
 * Reactivation email campaign — one-off script (2026-07-28).
 *
 * Emails every VERIFIED, NON-OPTED-OUT agent (~217 existing signups) about
 * what their account now includes: 25 instant credits (accounts below 25 are
 * topped up to 25 by this script), the one-click MCP connector at
 * https://archtools.dev/mcp, 63 tools, and x402 agent payments.
 *
 * ── SAFETY MODEL ─────────────────────────────────────────────────────────────
 *  - DRY-RUN BY DEFAULT. Without CONFIRM_SEND=YES it sends NOTHING and only
 *    prints the recipient count, top-up count, and a fully rendered sample
 *    email to stdout.
 *  - CONFIRM_SEND=YES additionally REQUIRES a real BUSINESS_ADDRESS env value
 *    (CAN-SPAM §5(a)(5): a valid physical postal address must appear in the
 *    footer). The script aborts loudly if it is missing or a placeholder.
 *  - ⛔ NEVER run the send without Brad's explicit GO.
 *
 * ── CAN-SPAM COMPLIANCE (built in) ───────────────────────────────────────────
 *  - Recipients: only agents who created an account (existing relationship),
 *    emailVerified = true, emailOptOut = false.
 *  - One-click unsubscribe: signed-token GET/POST /unsubscribe link in the
 *    footer + RFC 8058 List-Unsubscribe / List-Unsubscribe-Post headers.
 *  - Physical postal address + "why you're receiving this" line in the footer.
 *  - Honest subject line; sender identified as Arch Tools.
 *
 * ── ENV KNOBS ────────────────────────────────────────────────────────────────
 *  CONFIRM_SEND       "YES" → actually send. Anything else → dry-run.
 *  BUSINESS_ADDRESS   Physical mailing address for the footer (REQUIRED for send).
 *  SEND_LIMIT         Optional int — cap recipients (canary batch, e.g. 3).
 *  TOPUP_MIN_CREDITS  Default 25. Accounts below this are raised to it before
 *                     their email is sent (so the copy is true). 0 disables.
 *  SEND_DELAY_MS      Default 600 — delay between sends. Resend's default API
 *                     rate limit is 2 requests/sec
 *                     (https://resend.com/docs/api-reference/introduction#rate-limit).
 *
 * ── HOW TO RUN IN PRODUCTION (Render one-off job) ────────────────────────────
 * One-off jobs run the service's image with the service's env vars
 * (DATABASE_URL, RESEND_API_KEY, JWT_SECRET all present — never copy values
 * locally). Docs: https://render.com/docs/jobs +
 * https://api-docs.render.com/reference/create-job
 * Mind the shell quoting — the startCommand is a JSON string, so inner double
 * quotes must be backslash-escaped:
 *
 *   # 1) DRY RUN (sends nothing; read the job log for count + sample):
 *   curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
 *     -H "Authorization: Bearer $RENDER_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"startCommand":"node dist/scripts/reactivationEmail.js"}'
 *
 *   # 2) CANARY — 3 real recipients (after Brad GO):
 *   curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
 *     -H "Authorization: Bearer $RENDER_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"startCommand":"CONFIRM_SEND=YES SEND_LIMIT=3 BUSINESS_ADDRESS=\"<street>, <city>, <ST> <zip>\" node dist/scripts/reactivationEmail.js"}'
 *
 *   # 3) FULL SEND (after canary looks good + Brad GO):
 *   curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
 *     -H "Authorization: Bearer $RENDER_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"startCommand":"CONFIRM_SEND=YES BUSINESS_ADDRESS=\"<street>, <city>, <ST> <zip>\" node dist/scripts/reactivationEmail.js"}'
 *
 *   # Job status/logs: Render dashboard → service → Jobs, or
 *   #   GET https://api.render.com/v1/services/$SERVICE_ID/jobs/$JOB_ID
 *
 * Local dry-run (needs DATABASE_URL): cd api && npm run build &&
 *   node dist/scripts/reactivationEmail.js
 */
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { sendMarketingEmail } from "../services/email.js";
import { signUnsubscribeToken } from "../lib/unsubscribe.js";

const SITE = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
const CONFIRM = process.env.CONFIRM_SEND === "YES";
const TOPUP_MIN = Math.max(0, parseInt(process.env.TOPUP_MIN_CREDITS ?? "25", 10) || 0);
const SEND_DELAY_MS = Math.max(0, parseInt(process.env.SEND_DELAY_MS ?? "600", 10) || 600);
const SEND_LIMIT = parseInt(process.env.SEND_LIMIT ?? "0", 10) || 0;
const ADDRESS = (process.env.BUSINESS_ADDRESS || "").trim();
const ADDRESS_PLACEHOLDER = "[BUSINESS_ADDRESS — Brad to provide]";

// Exported for tests (tests/reactivation-render.test.mjs). Importing this
// module never runs the campaign — see the isMainModule guard at the bottom.
export const SUBJECT = "Your Arch Tools account just got a lot more useful";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Copy ─────────────────────────────────────────────────────────────────────

function creditsLine(balanceAfterTopup: number, wasToppedUp: boolean): { html: string; text: string } {
  if (wasToppedUp) {
    return {
      html: `We just topped your balance up to <strong>${balanceAfterTopup} credits</strong> — live on your account right now, nothing to claim.`,
      text: `We just topped your balance up to ${balanceAfterTopup} credits — live on your account right now, nothing to claim.`,
    };
  }
  return {
    html: `You still have <strong>${balanceAfterTopup.toLocaleString()} credits</strong> on your account, ready to use right now.`,
    text: `You still have ${balanceAfterTopup.toLocaleString()} credits on your account, ready to use right now.`,
  };
}

export function renderText(name: string | null, balance: number, toppedUp: boolean, unsubUrl: string, address: string): string {
  const hi = name ? `Hi ${name},` : "Hi there,";
  return `${hi}

You created an Arch Tools account a while back. Since then the platform has grown a lot — and your account came along for the ride.

WHAT'S WAITING FOR YOU

* Credits, ready now — ${creditsLine(balance, toppedUp).text}

* 63 tools behind one API key — web scraping, AI generation (Claude, GPT, Grok), image + video generation, email finding, OCR, transcription, research reports, and more.

* One-click MCP connector — use every tool directly inside Claude, ChatGPT, or Grok:
    1. Open your AI app's connector settings (e.g. Claude -> Settings -> Connectors).
    2. Add a custom connector with this URL: ${SITE}/mcp
    3. Authorize — all 63 tools appear in your chat, ready to call.

* x402 agent payments — your agents can pay per call in USDC (Base, Ethereum, Solana + more). No card, no key, no human in the loop.

TRY IT IN 30 SECONDS (costs 1 credit)

  curl -X POST ${SITE}/v1/tools/generate-uuid \\
    -H "x-api-key: YOUR_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{"count": 3}'

(Lost your key? Log in at ${SITE}/login to manage your account.)

When you're ready for more, credit packs start at $9 for 3,000 credits — and they never expire:
${SITE}/pricing

— Brad, Arch Tools

----------------------------------------------------------------------
You're receiving this because you created an Arch Tools account at archtools.dev.
Unsubscribe (one click): ${unsubUrl}
Arch Tools · ${address}
`;
}

export function renderHtml(name: string | null, balance: number, toppedUp: boolean, unsubUrl: string, address: string): string {
  const hi = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const credits = creditsLine(balance, toppedUp).html;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${SUBJECT}</title>
<style>
  body{margin:0;padding:0;background:#07061A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#F0EEFF;}
  .outer{background:#07061A;padding:32px 16px 48px;}
  .wrap{max-width:560px;margin:0 auto;background:#0D0C24;border:1px solid #1C1A3A;border-radius:16px;overflow:hidden;}
  .header{background:linear-gradient(135deg,#FF9010 0%,#FF2896 100%);padding:28px 36px 24px;}
  .logo-text{font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;}
  .header-sub{font-size:13px;color:rgba(255,255,255,0.75);margin:4px 0 0;}
  .content{padding:32px 36px;}
  .content p{margin:0 0 16px;font-size:15px;line-height:1.65;color:#C4BFDF;}
  .content p strong{color:#F0EEFF;}
  .content a{color:#FF9010;text-decoration:none;}
  .feature{background:#070617;border:1px solid #1C1A3A;border-radius:10px;padding:16px 18px;margin:0 0 12px;}
  .feature h3{margin:0 0 6px;font-size:14px;font-weight:700;color:#F0EEFF;}
  .feature p{margin:0;font-size:13px;line-height:1.6;color:#8A85B0;}
  .feature ol{margin:8px 0 0;padding-left:20px;font-size:13px;line-height:1.8;color:#8A85B0;}
  .code{background:#070617;border:1px solid #2A2850;border-radius:10px;padding:16px 18px;margin:0 0 20px;font-family:'Courier New',Courier,monospace;font-size:12px;color:#AA77FF;line-height:1.7;white-space:pre;overflow-x:auto;}
  .btn-wrap{margin:8px 0 24px;text-align:center;}
  .btn{display:inline-block;background:linear-gradient(135deg,#FF9010,#FF2896);color:#fff!important;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:14px;font-weight:600;}
  .divider{border:none;border-top:1px solid #1C1A3A;margin:24px 0;}
  .footer{padding:20px 36px 24px;border-top:1px solid #1C1A3A;text-align:center;}
  .footer p{margin:0 0 6px;font-size:11px;color:#4A4570;line-height:1.7;}
  .footer a{color:#8A85B0;text-decoration:underline;}
  @media(max-width:560px){.content,.header,.footer{padding-left:24px;padding-right:24px;}}
</style>
</head>
<body>
<div class="outer">
<div class="wrap">
  <div class="header">
    <span class="logo-text">Arch Tools</span>
    <p class="header-sub">AI-native API platform · archtools.dev</p>
  </div>
  <div class="content">
    <p>${hi}</p>
    <p>You created an Arch Tools account a while back. Since then the platform has grown a lot — and <strong>your account came along for the ride</strong>.</p>

    <div class="feature">
      <h3>💳 Credits, ready now</h3>
      <p>${credits}</p>
    </div>

    <div class="feature">
      <h3>🧰 63 tools behind one API key</h3>
      <p>Web scraping, AI generation (Claude, GPT, Grok), image + video generation, email finding, OCR, transcription, research reports, and more.</p>
    </div>

    <div class="feature">
      <h3>🔌 One-click MCP connector for Claude / ChatGPT / Grok</h3>
      <ol>
        <li>Open your AI app's connector settings (e.g. Claude → Settings → Connectors).</li>
        <li>Add a custom connector with this URL: <a href="${SITE}/mcp">${SITE}/mcp</a></li>
        <li>Authorize — all 63 tools appear in your chat, ready to call.</li>
      </ol>
    </div>

    <div class="feature">
      <h3>⚡ x402 agent payments</h3>
      <p>Your agents can pay per call in USDC (Base, Ethereum, Solana + more). No card, no key, no human in the loop.</p>
    </div>

    <hr class="divider">
    <p><strong>Try it in 30 seconds</strong> (costs 1 credit):</p>
    <div class="code">curl -X POST ${SITE}/v1/tools/generate-uuid \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"count": 3}'</div>
    <p style="font-size:13px;color:#8A85B0;">Lost your key? <a href="${SITE}/login">Log in</a> to manage your account.</p>

    <div class="btn-wrap"><a class="btn" href="${SITE}/pricing">See credit packs — from $9 →</a></div>
    <p style="font-size:13px;color:#8A85B0;text-align:center;">Credits never expire. — Brad, Arch Tools</p>
  </div>
  <div class="footer">
    <p>You're receiving this because you created an Arch Tools account at archtools.dev.</p>
    <p><a href="${unsubUrl}">Unsubscribe with one click</a></p>
    <p>Arch Tools · ${escapeHtml(address)}</p>
  </div>
</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const address = ADDRESS || ADDRESS_PLACEHOLDER;

  // CAN-SPAM hard gate: a real physical postal address is REQUIRED to send.
  if (CONFIRM && (!ADDRESS || ADDRESS.startsWith("[BUSINESS_ADDRESS"))) {
    console.error("ABORT: CONFIRM_SEND=YES but BUSINESS_ADDRESS is not set. CAN-SPAM requires a valid physical postal address in the footer. Set BUSINESS_ADDRESS and re-run.");
    process.exit(1);
  }
  if (CONFIRM && !process.env.RESEND_API_KEY && !process.env.POSTMARK_SERVER_TOKEN) {
    console.error("ABORT: CONFIRM_SEND=YES but no email provider is configured (RESEND_API_KEY / POSTMARK_SERVER_TOKEN).");
    process.exit(1);
  }

  // Recipients: existing relationship + verified + not opted out.
  const all = await prisma.agent.findMany({
    where: { emailVerified: true, emailOptOut: false, email: { contains: "@" } },
    select: { id: true, email: true, name: true, credits: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const recipients = SEND_LIMIT > 0 ? all.slice(0, SEND_LIMIT) : all;
  const needTopup = TOPUP_MIN > 0 ? recipients.filter((a) => a.credits < TOPUP_MIN) : [];

  console.log(JSON.stringify({
    mode: CONFIRM ? "SEND" : "DRY-RUN",
    eligible: all.length,
    selected: recipients.length,
    sendLimit: SEND_LIMIT || null,
    topupMin: TOPUP_MIN,
    wouldTopUp: needTopup.length,
    delayMs: SEND_DELAY_MS,
    subject: SUBJECT,
  }));

  if (!CONFIRM) {
    // Render one full sample (first recipient, or a synthetic one) so the copy
    // can be reviewed end-to-end from the job log. No email leaves the building.
    const sample = recipients[0] ?? { id: "sample_agent_id", email: "sample@example.com", name: "Sample", credits: 3, createdAt: new Date() };
    const toppedUp = TOPUP_MIN > 0 && sample.credits < TOPUP_MIN;
    const balance = toppedUp ? TOPUP_MIN : sample.credits;
    const unsubUrl = `${SITE}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(sample.id))}`;
    console.log("\n===== DRY RUN — nothing sent. First recipients (masked): =====");
    for (const r of recipients.slice(0, 10)) console.log(`  ${maskEmail(r.email)}  credits=${r.credits}  topup=${TOPUP_MIN > 0 && r.credits < TOPUP_MIN}`);
    if (recipients.length > 10) console.log(`  … +${recipients.length - 10} more`);
    console.log(`\n===== SAMPLE EMAIL (to ${maskEmail(sample.email)}) =====`);
    console.log(`Subject: ${SUBJECT}`);
    console.log(`List-Unsubscribe: <${unsubUrl}>`);
    console.log(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
    console.log(`\n----- TEXT BODY -----\n${renderText(sample.name, balance, toppedUp, unsubUrl, address)}`);
    console.log(`----- HTML BODY (${renderHtml(sample.name, balance, toppedUp, unsubUrl, address).length} chars) -----`);
    console.log(renderHtml(sample.name, balance, toppedUp, unsubUrl, address));
    console.log("\nDry run complete. To send: CONFIRM_SEND=YES BUSINESS_ADDRESS=\"...\" (see file header). Requires Brad's GO.");
    return;
  }

  // ─── REAL SEND ───
  let sent = 0, failed = 0, skipped = 0, toppedUpCount = 0;
  for (const agent of recipients) {
    // Re-check opt-out LIVE: the recipient list is a snapshot taken at start,
    // and a full run takes minutes — anyone who unsubscribes mid-run (one-click
    // /unsubscribe) must be excluded, not emailed from the stale snapshot.
    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { credits: true, emailOptOut: true },
    });
    if (!fresh || fresh.emailOptOut) {
      skipped++;
      console.log(JSON.stringify({ at: new Date().toISOString(), agentId: agent.id, email: maskEmail(agent.email), skipped: "opted_out" }));
      continue;
    }
    // Top up BEFORE sending so the copy is true when the email lands.
    // updateMany + credits<min guard = atomic, never lowers a balance.
    const preCredits = fresh.credits;
    let toppedUp = false;
    if (TOPUP_MIN > 0 && preCredits < TOPUP_MIN) {
      const r = await prisma.agent.updateMany({
        where: { id: agent.id, credits: { lt: TOPUP_MIN } },
        data: { credits: TOPUP_MIN },
      });
      toppedUp = r.count > 0;
      if (toppedUp) toppedUpCount++;
    }
    // After the guarded updateMany above, the live balance is >= TOPUP_MIN
    // whenever top-up is enabled (we raised it, or it was already there).
    const balance = TOPUP_MIN > 0 ? Math.max(preCredits, TOPUP_MIN) : preCredits;
    const unsubUrl = `${SITE}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(agent.id))}`;
    const ok = await sendMarketingEmail(
      agent.email,
      SUBJECT,
      renderHtml(agent.name, balance, toppedUp, unsubUrl, address),
      renderText(agent.name, balance, toppedUp, unsubUrl, address),
      {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    );
    if (ok) {
      sent++;
    } else {
      failed++;
      // Roll back the top-up when the send failed — the email claiming the
      // top-up never went out. Guarded on credits === TOPUP_MIN so we never
      // clobber a balance the user has changed in the meantime.
      if (toppedUp) {
        const rb = await prisma.agent.updateMany({
          where: { id: agent.id, credits: TOPUP_MIN },
          data: { credits: preCredits },
        });
        if (rb.count > 0) {
          toppedUp = false;
          toppedUpCount--;
        }
      }
    }
    // Log EVERY send (job log = the audit trail).
    console.log(JSON.stringify({ at: new Date().toISOString(), agentId: agent.id, email: maskEmail(agent.email), toppedUp, balance, sent: ok }));
    await sleep(SEND_DELAY_MS);
  }

  console.log(JSON.stringify({ done: true, sent, failed, skipped, toppedUp: toppedUpCount, total: recipients.length }));
  if (failed > 0) process.exitCode = 1;
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("Reactivation campaign failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
