/**
 * Free-credit farming — regression tests (2026-11-02).
 *
 * A  The monthly refresh tops up VERIFIED free accounts only (it used to top up
 *    every free account, so 60 unverified throwaway-email bots created on
 *    2026-10-14 each collected the full monthly grant) and never emails an
 *    account that unsubscribed.
 * B  Signup's disposable-email check uses the generated maintained blocklist,
 *    which covers the farming domains and none of the mainstream providers.
 * Runs against the compiled output (npm run build first), like the other *.test.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DISPOSABLE_DOMAINS } from "../dist/lib/disposableDomains.js";

// A — source pins on the refresh job.
const cron = readFileSync(new URL("../src/cron/refreshCredits.ts", import.meta.url), "utf8");
assert.match(cron, /where:\s*\{\s*tier:\s*"free",\s*emailVerified:\s*true\s*\}/, "refresh must select verified free accounts only");
assert.match(cron, /if \(await shouldSendRefreshEmail\(agent\.email, agent\.emailOptOut\)\)/, "refresh email must go through the deliverability guard");
assert.match(cron, /if \(!email \|\| emailOptOut\) return false;/, "unsubscribed accounts must never be emailed");
assert.match(cron, /EXCLUDE_DOMAINS\.has\(domain\) \|\| isDisposableEmail\(email\)/, "internal and throwaway domains must be skipped");

// A2 — null-MX handling (RFC 7505: "0 ." means the domain accepts no mail; Node reports exchange "").
const { mxAcceptsMail } = await import("../dist/cron/refreshCredits.js");
assert.equal(mxAcceptsMail([{ exchange: "", priority: 0 }]), false, "null MX (example.com) accepts no mail");
assert.equal(mxAcceptsMail([{ exchange: ".", priority: 0 }]), false);
assert.equal(mxAcceptsMail([]), false);
assert.equal(mxAcceptsMail([{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }]), true);

// B — blocklist contents and wiring.
for (const d of ["nexotp.web.id", "trialkupremium.web.id", "mailinator.com", "yopmail.com", "calirona.com", "maxxspace.com"]) {
  assert.ok(DISPOSABLE_DOMAINS.has(d), `${d} must be blocked`);
}
for (const d of ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com", "archtools.dev"]) {
  assert.ok(!DISPOSABLE_DOMAINS.has(d), `${d} must NOT be blocked`);
}
assert.ok(DISPOSABLE_DOMAINS.size > 5000, "maintained blocklist must be loaded");
const verification = readFileSync(new URL("../src/lib/verification.ts", import.meta.url), "utf8");
assert.match(verification, /import \{ DISPOSABLE_DOMAINS \} from "\.\/disposableDomains\.js";/);
assert.ok(!/const DISPOSABLE_DOMAINS = new Set\(/.test(verification), "the old hand list must be gone");

console.log("All credit-refresh-verified tests passed.");
