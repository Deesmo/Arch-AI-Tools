/**
 * Active-developer outreach — one-off personal-ask email (2026-07-31).
 *
 * Emails the small cohort of developers (~13-15) with REAL API activity in the
 * last 30 days, asking one personal question: what would make Arch Tools worth
 * paying for? Plain, short, text-first copy signed by Brad. Replies go to the
 * normal from-address inbox.
 *
 * ── SAFETY MODEL (mirrors scripts/reactivationEmail.ts exactly) ──────────────
 *  - DRY-RUN BY DEFAULT. Without CONFIRM_SEND=YES it sends NOTHING and only
 *    prints the recipient count, per-domain histogram, and a fully rendered
 *    sample email to stdout.
 *  - CONFIRM_SEND=YES additionally REQUIRES a real BUSINESS_ADDRESS env value
 *    (CAN-SPAM §5(a)(5): a valid physical postal address must appear in the
 *    footer). The script aborts loudly if it is missing or a placeholder.
 *  - Recipients: existing relationship only — emailVerified = true,
 *    emailOptOut = false, and ≥MIN_CALLS successful API calls inside the
 *    activity window. Opt-out is re-checked LIVE before each send.
 *  - One-click unsubscribe: signed-token /unsubscribe link in the footer +
 *    RFC 8058 List-Unsubscribe / List-Unsubscribe-Post headers.
 *  - Internal domains (EXCLUDE_EMAIL_DOMAINS, default archtools.dev) are
 *    skipped entirely: Cloudflare Email Routing forwards only abuse@/security@/
 *    privacy@/support@ (catch-all DISABLED), so internal aliases hard-bounce
 *    and damage Resend sender reputation. This also removes seed/self traffic
 *    from the cohort (internal accounts are the @archtools.dev aliases).
 *  - ⛔ NEVER run the send without Brad's explicit GO.
 *
 * ── SELECTION (same source as scripts/funnelReport.ts stages 2-3) ────────────
 *  ApiRequest rows with status = "SUCCESS" grouped by agentId — the exact
 *  pattern funnelReport uses for "made ≥1 successful call" — restricted to
 *  createdAt >= now - ACTIVE_WINDOW_DAYS. (ApiRequest rows older than 90 days
 *  are purged by the weekly db-cleanup cron, so a ≤90-day window is complete.)
 *
 * ── ENV KNOBS ────────────────────────────────────────────────────────────────
 *  CONFIRM_SEND           "YES" → actually send. Anything else → dry-run.
 *  BUSINESS_ADDRESS       Physical mailing address for the footer (REQUIRED for send).
 *  SEND_LIMIT             Optional int — cap recipients (canary batch, e.g. 3).
 *  ACTIVE_WINDOW_DAYS     Default 30 — activity lookback window.
 *  MIN_CALLS              Default 1 — successful calls required inside the window.
 *  SEND_DELAY_MS          Default 600 — delay between sends (Resend rate limit
 *                         is 2 req/s: https://resend.com/docs/api-reference/introduction#rate-limit).
 *  EXCLUDE_EMAIL_DOMAINS  Comma-separated domains to skip. Default "archtools.dev".
 *
 * ── HOW TO RUN IN PRODUCTION (Render one-off job) ────────────────────────────
 *   # 1) DRY RUN (sends nothing; read the job log for cohort + sample):
 *   curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
 *     -H "Authorization: Bearer $RENDER_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"startCommand":"node dist/scripts/outreachActiveDevs.js"}'
 *
 *   # 2) SEND (after Brad GO — cohort is small, canary via SEND_LIMIT=3 first):
 *   curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/jobs" \
 *     -H "Authorization: Bearer $RENDER_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{"startCommand":"CONFIRM_SEND=YES BUSINESS_ADDRESS=\"<street>, <city>, <ST> <zip>\" node dist/scripts/outreachActiveDevs.js"}'
 *
 * Local dry-run (needs DATABASE_URL): cd api && npm run build &&
 *   node dist/scripts/outreachActiveDevs.js
 */
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { sendMarketingEmail } from "../services/email.js";
import { signUnsubscribeToken } from "../lib/unsubscribe.js";
import { parseExcludeDomains, emailDomain, escapeHtml, maskEmail } from "./reactivationEmail.js";

const SITE = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
const CONFIRM = process.env.CONFIRM_SEND === "YES";
const SEND_DELAY_MS = Math.max(0, parseInt(process.env.SEND_DELAY_MS ?? "600", 10) || 600);
const SEND_LIMIT = parseInt(process.env.SEND_LIMIT ?? "0", 10) || 0;
const ACTIVE_WINDOW_DAYS = Math.max(1, parseInt(process.env.ACTIVE_WINDOW_DAYS ?? "30", 10) || 30);
const MIN_CALLS = Math.max(1, parseInt(process.env.MIN_CALLS ?? "1", 10) || 1);
const ADDRESS = (process.env.BUSINESS_ADDRESS || "").trim();
const ADDRESS_PLACEHOLDER = "[BUSINESS_ADDRESS — Brad to provide]";
const EXCLUDE_DOMAINS = parseExcludeDomains(process.env.EXCLUDE_EMAIL_DOMAINS);

const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Exported for tests (tests/outreach-active-devs.test.mjs). Importing this
// module never runs the campaign — see the isMainModule guard at the bottom.
export const SUBJECT = "Quick question from the Arch Tools builder";

// ─── Copy (plain, short, personal — text-first, minimal HTML) ────────────────
// ⚠️ Payment-chain claims: ONLY Base + Polygon are live for USDC pay-per-call.
// Never add other chains to this copy.

export function renderText(name: string | null, unsubUrl: string, address: string): string {
  const hi = name ? `Hi ${name} —` : "Hi —";
  return `${hi} saw you've been using Arch Tools. Thank you; you're exactly who I built it for.

Quick ask: what's the one thing that would make it worth paying for, for you? (And is there a tool you wish worked better?) Just reply — I read everything.

— Brad

P.S. Your account also got upgrades: one-click MCP connector (${SITE}/mcp) and agents can now pay per call in USDC on Base or Polygon.

----------------------------------------------------------------------
You're receiving this because you created an Arch Tools account at archtools.dev.
Unsubscribe (one click): ${unsubUrl}
Arch Tools · ${address}
`;
}

export function renderHtml(name: string | null, unsubUrl: string, address: string): string {
  const hi = name ? `Hi ${escapeHtml(name)} —` : "Hi —";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${SUBJECT}</title></head>
<body style="margin:0;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:560px;margin:0 auto;font-size:15px;line-height:1.65;">
    <p>${hi} saw you've been using Arch Tools. Thank you; you're exactly who I built it for.</p>
    <p>Quick ask: what's the one thing that would make it worth paying for, for you? (And is there a tool you wish worked better?) Just reply — I read everything.</p>
    <p>— Brad</p>
    <p>P.S. Your account also got upgrades: one-click MCP connector (<a href="${SITE}/mcp">${SITE}/mcp</a>) and agents can now pay per call in USDC on Base or Polygon.</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
    <p style="font-size:11px;color:#888;line-height:1.7;">
      You're receiving this because you created an Arch Tools account at archtools.dev.<br>
      <a href="${unsubUrl}" style="color:#888;">Unsubscribe with one click</a><br>
      Arch Tools · ${escapeHtml(address)}
    </p>
  </div>
</body>
</html>`;
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

  // Cohort: successful API calls inside the window (funnelReport's stage-2
  // pattern, time-bounded), then the usual marketing-eligibility filters.
  const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * DAY_MS);
  const activity = await prisma.apiRequest.groupBy({
    by: ["agentId"],
    where: { status: "SUCCESS", createdAt: { gte: since } },
    _count: { _all: true },
  });
  const callsById = new Map(activity.map((r) => [r.agentId, r._count._all]));
  const activeIds = activity.filter((r) => r._count._all >= MIN_CALLS).map((r) => r.agentId);

  const fetched = activeIds.length
    ? await prisma.agent.findMany({
        where: { id: { in: activeIds }, emailVerified: true, emailOptOut: false, email: { contains: "@" } },
        select: { id: true, email: true, name: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  // Internal-domain exclusion BEFORE SEND_LIMIT slicing (also drops seed/self
  // traffic — internal accounts are the @archtools.dev aliases).
  const excludedInternal = fetched.filter((a) => EXCLUDE_DOMAINS.has(emailDomain(a.email)));
  const eligible = fetched.filter((a) => !EXCLUDE_DOMAINS.has(emailDomain(a.email)));
  const recipients = SEND_LIMIT > 0 ? eligible.slice(0, SEND_LIMIT) : eligible;

  console.log(JSON.stringify({
    mode: CONFIRM ? "SEND" : "DRY-RUN",
    campaign: "outreach-active-devs",
    activeWindowDays: ACTIVE_WINDOW_DAYS,
    minCalls: MIN_CALLS,
    activeAgents: activeIds.length,
    eligible: eligible.length,
    excludedInternal: excludedInternal.length,
    excludeDomains: [...EXCLUDE_DOMAINS].sort(),
    selected: recipients.length,
    sendLimit: SEND_LIMIT || null,
    delayMs: SEND_DELAY_MS,
    subject: SUBJECT,
  }));

  if (!CONFIRM) {
    const sample = recipients[0] ?? { id: "sample_agent_id", email: "sample@example.com", name: "Sample", createdAt: new Date() };
    const unsubUrl = `${SITE}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(sample.id))}`;
    console.log("\n===== DRY RUN — nothing sent. Recipients (masked): =====");
    for (const r of recipients) console.log(`  ${maskEmail(r.email)}  callsInWindow=${callsById.get(r.id) ?? 0}`);
    const domainCounts = new Map<string, number>();
    for (const r of eligible) {
      const d = emailDomain(r.email) || "(no domain)";
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
    console.log("\n===== RECIPIENT DOMAINS (eligible, after exclusion) =====");
    for (const [domain, count] of [...domainCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  ${domain}: ${count}`);
    }
    console.log(`Excluded as internal (${[...EXCLUDE_DOMAINS].sort().join(", ") || "none"}): ${excludedInternal.length}`);
    console.log(`\n===== SAMPLE EMAIL (to ${maskEmail(sample.email)}) =====`);
    console.log(`Subject: ${SUBJECT}`);
    console.log(`List-Unsubscribe: <${unsubUrl}>`);
    console.log(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
    console.log(`\n----- TEXT BODY -----\n${renderText(sample.name, unsubUrl, address)}`);
    console.log(`----- HTML BODY -----`);
    console.log(renderHtml(sample.name, unsubUrl, address));
    console.log("\nDry run complete. To send: CONFIRM_SEND=YES BUSINESS_ADDRESS=\"...\" (see file header). Requires Brad's GO.");
    return;
  }

  // ─── REAL SEND ───
  let sent = 0, failed = 0, skipped = 0;
  for (const agent of recipients) {
    // Re-check opt-out LIVE: anyone who unsubscribes mid-run (one-click
    // /unsubscribe) must be excluded, not emailed from the stale snapshot.
    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { emailOptOut: true },
    });
    if (!fresh || fresh.emailOptOut) {
      skipped++;
      console.log(JSON.stringify({ at: new Date().toISOString(), agentId: agent.id, email: maskEmail(agent.email), skipped: "opted_out" }));
      continue;
    }
    const unsubUrl = `${SITE}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(agent.id))}`;
    const ok = await sendMarketingEmail(
      agent.email,
      SUBJECT,
      renderHtml(agent.name, unsubUrl, address),
      renderText(agent.name, unsubUrl, address),
      {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    );
    if (ok) sent++;
    else failed++;
    // Log EVERY send (job log = the audit trail).
    console.log(JSON.stringify({ at: new Date().toISOString(), agentId: agent.id, email: maskEmail(agent.email), sent: ok }));
    await sleep(SEND_DELAY_MS);
  }

  console.log(JSON.stringify({ done: true, sent, failed, skipped, total: recipients.length }));
  if (failed > 0) process.exitCode = 1;
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("Active-dev outreach failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
