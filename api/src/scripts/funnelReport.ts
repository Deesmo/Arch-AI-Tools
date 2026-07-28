/**
 * Funnel report — READ-ONLY analytics script (2026-07-28).
 *
 * Answers "why did 219 accounts produce $0?" with data. Produces the staged
 * conversion funnel plus supporting distributions, as clean JSON on stdout:
 *
 *   accounts created (by week)
 *     → email verified
 *     → made ≥1 successful call
 *     → made ≥5 successful calls
 *     → hit an insufficient-credits refusal
 *     → visited a checkout            (NOT instrumented — see below)
 *     → paid                          (Purchase rows + x402 settlements)
 *
 * Plus: time-to-first-call distribution, last-activity recency histogram,
 * top tools among activated agents vs everyone, stranded-unverified cohort
 * (expired verify tokens — the resend-endpoint audience), and refusal
 * (credit-depletion) counts by agent.
 *
 * ── SAFETY MODEL ─────────────────────────────────────────────────────────────
 *  - ZERO WRITES. Every Prisma call in this file is a count / findMany /
 *    groupBy / aggregate SELECT. No create/update/upsert/delete/$executeRaw.
 *  - No PII in output: agents are identified by cuid only — emails are never
 *    selected, so the report is safe to read in Render job logs.
 *
 * ── KNOWN INSTRUMENTATION GAPS (reported honestly in the JSON) ──────────────
 *  - Checkout visits: POST /v1/billing/checkout (src/routes/billing.ts)
 *    creates a Stripe Checkout Session but writes NO database row, so
 *    "visited a checkout" cannot be counted here. Count sessions in the
 *    Stripe dashboard / API instead. Purchase rows exist only for COMPLETED
 *    payments (checkout.session.completed webhook).
 *  - 402 refusals: an insufficient-credits refusal (deductCredits,
 *    src/utils/credits.ts) returns 402 WITHOUT writing an ApiRequest row.
 *    The only persistent footprint is the AuditLog "credits_depleted_alert"
 *    row — deduplicated to one per depletion cycle and only written when the
 *    balance is at/below LOW_CREDIT_THRESHOLD — so refusal numbers here are a
 *    LOWER BOUND on actual 402s, not an exact count.
 *  - ApiRequest rows older than 90 days are purged by the weekly db-cleanup
 *    cron, so call-derived stages are bounded to the retention window.
 *
 * ── HOW TO RUN (Render one-off job — service env provides DATABASE_URL) ─────
 *   POST https://api.render.com/v1/services/<serviceId>/jobs
 *     { "startCommand": "node dist/scripts/funnelReport.js" }
 *   Locally: npm run build && DATABASE_URL=... npm run funnel-report
 */
import "dotenv/config";
import { prisma } from "../lib/prisma.js";

// Mirrors src/utils/credits.ts (LOW_ALERT_ACTION / DEPLETED_ALERT_ACTION).
// Hardcoded here so this one-off job does not import the email/alert stack.
const DEPLETED_ALERT_ACTION = "credits_depleted_alert";
const LOW_ALERT_ACTION = "low_credit_alert";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO date (YYYY-MM-DD) of the Monday starting the week containing `d`. */
function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(d.getTime() - day * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}

interface Bucket {
  label: string;
  maxMs: number;
  count: number;
}

async function main(): Promise<void> {
  const now = new Date();

  // ── Stage 0: accounts created ──────────────────────────────────────────────
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      createdAt: true,
      emailVerified: true,
      verifyToken: true,
      verifyTokenExpiry: true,
      pendingCredits: true,
      credits: true,
      totalCalls: true,
      lastSeenAt: true,
      tier: true,
    },
  });
  const totalAgents = agents.length;

  const byWeek = new Map<string, number>();
  for (const a of agents) {
    const wk = weekStart(a.createdAt);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
  }
  const accountsByWeek = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, count]) => ({ week_start, count }));

  // ── Stage 1: email verified ────────────────────────────────────────────────
  const verified = agents.filter((a) => a.emailVerified).length;

  // ── Stages 2–3: made ≥1 successful call / made ≥5 successful calls ────────
  // Primary source = ApiRequest rows (90-day retention window). The persisted
  // Agent.totalCalls counter is reported alongside as the all-time signal.
  const successByAgent = await prisma.apiRequest.groupBy({
    by: ["agentId"],
    where: { status: "SUCCESS" },
    _count: { _all: true },
  });
  const agentsWithSuccess = successByAgent.length;

  // SUCCESS-only, like stage 2, so the funnel stays monotonic: an agent whose
  // calls all failed must not appear "activated" while missing stage 2.
  const callsByAgent = await prisma.apiRequest.groupBy({
    by: ["agentId"],
    where: { status: "SUCCESS" },
    _count: { _all: true },
  });
  const agentsWith5Calls = callsByAgent.filter((r) => r._count._all >= 5).length;
  const agentsTotalCalls1 = agents.filter((a) => a.totalCalls >= 1).length;
  const agentsTotalCalls5 = agents.filter((a) => a.totalCalls >= 5).length;

  // ── Stage 4: hit an insufficient-credits refusal (lower-bound proxy) ──────
  const depletionAlerts = await prisma.auditLog.groupBy({
    by: ["agentId"],
    where: { action: DEPLETED_ALERT_ACTION },
    _count: { _all: true },
  });
  const lowAlerts = await prisma.auditLog.groupBy({
    by: ["agentId"],
    where: { action: LOW_ALERT_ACTION },
    _count: { _all: true },
  });
  const refusalAgents = depletionAlerts.filter((r) => r.agentId !== null);
  const refusalCyclesTotal = refusalAgents.reduce((s, r) => s + r._count._all, 0);

  // ── Stage 5: visited a checkout — NOT instrumented (see header) ───────────
  // No table logs Stripe Checkout Session creation; only completed payments
  // land in Purchase. Reported as not_instrumented rather than guessed.

  // ── Stage 6: paid ──────────────────────────────────────────────────────────
  const purchaseRows = await prisma.purchase.count();
  const purchaseAgents = await prisma.purchase.groupBy({ by: ["agentId"], _count: { _all: true } });
  const completedPurchases = await prisma.purchase.count({ where: { status: "completed" } });

  const x402Count = await prisma.x402Payment.count();
  const x402Agents = await prisma.x402Payment.groupBy({
    by: ["agentId"],
    where: { agentId: { not: null } },
    _count: { _all: true },
  });
  const paidTierAgents = agents.filter((a) => a.tier !== "free").length;

  // ── Time-to-first-call distribution ───────────────────────────────────────
  // First SUCCESSFUL call, matching stage 2 — a logged failure is not "the
  // agent got the product working".
  const firstCallByAgent = await prisma.apiRequest.groupBy({
    by: ["agentId"],
    where: { status: "SUCCESS" },
    _min: { createdAt: true },
  });
  const createdAtById = new Map(agents.map((a) => [a.id, a.createdAt]));
  const ttfcBuckets: Bucket[] = [
    { label: "<10m", maxMs: 10 * 60 * 1000, count: 0 },
    { label: "10m-1h", maxMs: 60 * 60 * 1000, count: 0 },
    { label: "1h-24h", maxMs: DAY_MS, count: 0 },
    { label: "1d-7d", maxMs: 7 * DAY_MS, count: 0 },
    { label: ">7d", maxMs: Number.POSITIVE_INFINITY, count: 0 },
  ];
  const ttfcMinutes: number[] = [];
  for (const r of firstCallByAgent) {
    const created = createdAtById.get(r.agentId);
    const first = r._min.createdAt;
    if (!created || !first) continue;
    const delta = Math.max(0, first.getTime() - created.getTime());
    ttfcMinutes.push(Math.round(delta / 60000));
    const bucket = ttfcBuckets.find((b) => delta < b.maxMs);
    if (bucket) bucket.count += 1;
  }
  ttfcMinutes.sort((a, b) => a - b);
  const ttfcMedian = ttfcMinutes.length
    ? ttfcMinutes[Math.floor(ttfcMinutes.length / 2)]
    : null;

  // ── Last-activity recency histogram (Agent.lastSeenAt) ────────────────────
  const recency = { "<=1d": 0, "1d-7d": 0, "7d-30d": 0, ">30d": 0, never: 0 };
  for (const a of agents) {
    if (!a.lastSeenAt) {
      recency.never += 1;
      continue;
    }
    const age = now.getTime() - a.lastSeenAt.getTime();
    if (age <= DAY_MS) recency["<=1d"] += 1;
    else if (age <= 7 * DAY_MS) recency["1d-7d"] += 1;
    else if (age <= 30 * DAY_MS) recency["7d-30d"] += 1;
    else recency[">30d"] += 1;
  }

  // ── Top tools: activated agents (≥5 successful calls) vs everyone ─────────
  const activatedIds = callsByAgent.filter((r) => r._count._all >= 5).map((r) => r.agentId);
  const topToolsEveryone = await prisma.apiRequest.groupBy({
    by: ["toolName"],
    _count: { _all: true },
    orderBy: { _count: { toolName: "desc" } },
    take: 15,
  });
  const topToolsActivated = activatedIds.length
    ? await prisma.apiRequest.groupBy({
        by: ["toolName"],
        where: { agentId: { in: activatedIds } },
        _count: { _all: true },
        orderBy: { _count: { toolName: "desc" } },
        take: 15,
      })
    : [];

  // ── Stranded unverified (the resend-verification cohort) ──────────────────
  const unverified = agents.filter((a) => !a.emailVerified);
  const strandedExpired = unverified.filter(
    (a) => a.verifyToken !== null && a.verifyTokenExpiry !== null && a.verifyTokenExpiry < now
  );
  const strandedValid = unverified.filter(
    (a) => a.verifyToken !== null && a.verifyTokenExpiry !== null && a.verifyTokenExpiry >= now
  );
  const strandedNoToken = unverified.filter((a) => a.verifyToken === null);
  const pendingCreditsLocked = unverified.reduce((s, a) => s + a.pendingCredits, 0);

  const report = {
    report: "funnel",
    generated_at: now.toISOString(),
    read_only: true,
    source: "production database (Prisma SELECT/aggregate only)",
    caveats: [
      "ApiRequest rows older than 90 days are purged by the weekly db-cleanup cron; call-derived stages cover the retention window (Agent.totalCalls is the all-time counter).",
      "Refusal counts are a LOWER BOUND: 402s write no ApiRequest row; only deduplicated credits_depleted_alert AuditLog rows (one per depletion cycle, balance <= LOW_CREDIT_THRESHOLD) persist.",
      "Checkout visits are NOT instrumented: POST /v1/billing/checkout writes no DB row; count Stripe Checkout Sessions via the Stripe dashboard/API.",
    ],
    funnel: {
      accounts_created: { total: totalAgents, by_week: accountsByWeek },
      email_verified: { count: verified, pct_of_created: pct(verified, totalAgents) },
      made_1_successful_call: {
        count: agentsWithSuccess,
        pct_of_created: pct(agentsWithSuccess, totalAgents),
        all_time_via_totalCalls_ge_1: agentsTotalCalls1,
      },
      made_5_successful_calls: {
        count: agentsWith5Calls,
        pct_of_created: pct(agentsWith5Calls, totalAgents),
        all_time_via_totalCalls_ge_5: agentsTotalCalls5,
      },
      hit_insufficient_credits_refusal: {
        agents_with_depletion_alert: refusalAgents.length,
        depletion_alert_cycles_total: refusalCyclesTotal,
        agents_with_low_credit_alert: lowAlerts.filter((r) => r.agentId !== null).length,
        lower_bound: true,
        note: "Exact 402 refusal counts are not persisted — see caveats.",
      },
      visited_checkout: {
        instrumented: false,
        note: "No table logs Stripe Checkout Session creation; Purchase rows record completed payments only.",
      },
      paid: {
        purchase_rows: purchaseRows,
        completed_purchases: completedPurchases,
        distinct_purchasing_agents: purchaseAgents.length,
        paid_tier_agents: paidTierAgents,
        x402_payments: x402Count,
        x402_distinct_agents: x402Agents.length,
      },
    },
    time_to_first_call: {
      agents_with_any_successful_call: firstCallByAgent.length,
      median_minutes: ttfcMedian,
      buckets: ttfcBuckets.map((b) => ({ label: b.label, count: b.count })),
    },
    last_activity_recency: recency,
    top_tools: {
      activated_agents_ge_5_calls: topToolsActivated.map((t) => ({
        tool: t.toolName,
        calls: t._count._all,
      })),
      everyone: topToolsEveryone.map((t) => ({ tool: t.toolName, calls: t._count._all })),
    },
    stranded_unverified: {
      total_unverified: unverified.length,
      with_expired_token: strandedExpired.length,
      with_valid_token: strandedValid.length,
      with_no_token: strandedNoToken.length,
      pending_credits_locked: pendingCreditsLocked,
      note: "with_expired_token = the resend-verification-endpoint cohort.",
    },
    refusals_by_agent: refusalAgents
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 20)
      .map((r) => ({ agent_id: r.agentId, depletion_alert_cycles: r._count._all })),
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[funnel-report] FAILED:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
