// @ts-nocheck
/**
 * Monthly Free Credit Refresh
 *
 * Tops up free-tier agents to FREE_MONTHLY_CREDITS on the 1st of each month.
 * Render Cron Job: Schedule 0 0 1 * * | Command: node dist/cron/refreshCredits.js
 *
 * TOP-UP, NEVER RESET: an inactive free agent that still holds PURCHASED pack
 * credits above the monthly free grant must NOT be lowered to the free amount.
 * We only grant when the current balance is below the monthly floor.
 *
 * Safe to run multiple times — uses updatedAt guard to prevent double-grants in same month.
 */
import "dotenv/config";
import { promises as dns } from "dns";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { isDisposableEmail } from "../lib/verification.js";
import { sendMonthlyRefreshEmail } from "../services/email.js";
import { parseExcludeDomains, emailDomain } from "../scripts/reactivationEmail.js";

// ─── Deliverability guard for the refresh email (2026-11-02) ─────────────────
// Of the 183 verified free accounts, ~140 cannot receive mail: internal
// @archtools.dev aliases (hard-bounce, see reactivationEmail.ts), test domains with
// no mail server (test.dev) or a null MX (example.com, RFC 7505), and throwaway
// inboxes. Bounces burn the Resend sender reputation that signup verification
// emails depend on, so those accounts still get their credits but no email.
const EXCLUDE_DOMAINS = parseExcludeDomains(process.env.EXCLUDE_EMAIL_DOMAINS);

/** True when MX records name at least one real mail server (not a null MX). */
export function mxAcceptsMail(records: Array<{ exchange: string }>): boolean {
  return records.some((r) => r.exchange !== "" && r.exchange !== ".");
}

const mxCache = new Map<string, Promise<boolean>>();
function domainReceivesMail(domain: string): Promise<boolean> {
  let known = mxCache.get(domain);
  if (!known) {
    known = dns.resolveMx(domain).then(mxAcceptsMail, () => false);
    mxCache.set(domain, known);
  }
  return known;
}

export async function shouldSendRefreshEmail(email: string | null | undefined, emailOptOut: boolean): Promise<boolean> {
  if (!email || emailOptOut) return false;
  const domain = emailDomain(email);
  if (!domain || EXCLUDE_DOMAINS.has(domain) || isDisposableEmail(email)) return false;
  return domainReceivesMail(domain);
}

export async function refreshMonthlyCredits(now = new Date()): Promise<{ granted: number; skipped: number }> {
  const credits = Number(process.env.FREE_MONTHLY_CREDITS || 250);

  if (credits <= 0) {
    console.log("FREE_MONTHLY_CREDITS is 0 — skipping refresh");
    return { granted: 0, skipped: 0 };
  }

  // Only refresh agents whose credits haven't been topped up this month
  const startOfMonth = new Date(now);
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  // VERIFIED ONLY: signup holds back most free credits until the email is verified,
  // so the monthly top-up must not hand them to unverified accounts. Topping up every
  // free account let throwaway-email bots (60 unverified accounts on 2026-10-14) collect
  // the full monthly grant without ever proving an address.
  const agents = await prisma.agent.findMany({
    where: { tier: "free", emailVerified: true },
    select: { id: true, email: true, credits: true, updatedAt: true, emailOptOut: true },
  });

  let granted = 0;
  let skipped = 0;
  let emailed = 0;

  for (const agent of agents) {
    // Skip if already refreshed this month (updatedAt is within current month)
    if (agent.updatedAt >= startOfMonth) {
      skipped++;
      continue;
    }

    // TOP-UP ONLY: raise the balance to the monthly floor iff it is currently
    // below it. Agents already at/above the floor (e.g. holding purchased pack
    // credits) are left untouched so we never lower a paid balance.
    const result = await prisma.agent.updateMany({
      where: { id: agent.id, credits: { lt: credits } },
      data: { credits: credits },
    });
    if (result.count === 0) {
      skipped++;
      continue;
    }
    granted++;

    // Send the monthly refresh email (non-blocking) only to a deliverable address
    // of someone who has not unsubscribed.
    if (await shouldSendRefreshEmail(agent.email, agent.emailOptOut)) {
      sendMonthlyRefreshEmail(agent.email, credits - agent.credits, credits).catch(() => {});
      emailed++;
    }
  }

  console.log(`Credit refresh complete: ${granted} granted, ${skipped} skipped, ${emailed} emailed.`);
  return { granted, skipped };
}

async function main() {
  await refreshMonthlyCredits();
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("Credit refresh failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
