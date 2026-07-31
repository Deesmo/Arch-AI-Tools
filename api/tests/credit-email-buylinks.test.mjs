/**
 * One-click buy links in the credit alert emails — render tests (GROWTH_50 #7).
 *
 * Covers, for BOTH the low-credit and the credits-depleted email (html + text):
 *   A  Every pack in the recommendation catalog is a one-click GET deep-link
 *      to the pre-selected pricing page (/pricing?pack=<id>) — the PR #100
 *      funnel surface — and the prominent CTA button carries the same link.
 *   B  Council rule: emails never auto-fire checkout — no checkout/subscribe
 *      API URL ever appears in an email; buying is an explicit click on the
 *      pricing page (pricing.html preselect is pinned by intent-funnel tests).
 *   C  Drift guards: every linked pack id is in the pricing.html ?pack=
 *      allowlist, and the credit/price copy is rendered FROM the catalog
 *      (lib/creditPacks.ts), so a pack change can't silently strand the email.
 *   D  Wiring: the send wrappers pass the text alternative through, and
 *      utils/credits.ts still sends both alerts (dedup wiring untouched).
 *
 * Run: cd api && npm run build first (populates dist/), then:
 *   node tests/credit-email-buylinks.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = (...p) => path.join(__dirname, "..", "dist", ...p);
const src = (...p) => path.join(__dirname, "..", "src", ...p);
const pub = (...p) => path.join(__dirname, "..", "public", ...p);

// Deterministic base URL: the emails build links from PUBLIC_SITE_URL
// (default https://archtools.dev) — pin it before the module import.
process.env.PUBLIC_SITE_URL = "https://archtools.dev";

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const { renderLowCreditAlert, renderCreditsDepletedAlert } =
  await import(distPath("services", "email.js"));
const { RECOMMENDABLE_PACKS } = await import(distPath("lib", "creditPacks.js"));

const AGENT = "agent_0123456789abcdef0123456789";
const AGENT_SHOWN = AGENT.slice(0, 20);
const packLink = (id) => `https://archtools.dev/pricing?pack=${id}`;

const low = renderLowCreditAlert(17, AGENT);
const depleted = renderCreditsDepletedAlert(AGENT, 0);

for (const [label, email] of [["low-credit", low], ["depleted", depleted]]) {
  console.log(`\n${label} email:`);

  for (const [part, out] of [["html", email.html], ["text", email.text]]) {
    test(`${part}: one-click buy link for every pack`, () => {
      for (const p of RECOMMENDABLE_PACKS) {
        assert.ok(out.includes(packLink(p.id)), `missing ${packLink(p.id)}`);
      }
    });
    test(`${part}: pack copy rendered from the catalog (credits + price)`, () => {
      for (const p of RECOMMENDABLE_PACKS) {
        assert.ok(out.includes(`${p.credits.toLocaleString()} credits`), `missing ${p.id} credits`);
        assert.ok(out.includes(`$${p.priceUsd}`), `missing ${p.id} price`);
      }
    });
    test(`${part}: never auto-fires checkout (no checkout/subscribe API URL)`, () => {
      for (const forbidden of ["/v1/billing/checkout", "/v1/billing/subscribe"]) {
        assert.ok(!out.includes(forbidden), `email must not carry ${forbidden}`);
      }
    });
    test(`${part}: agent id shown truncated, never in full`, () => {
      assert.ok(out.includes(AGENT_SHOWN));
      assert.ok(!out.includes(AGENT), "full agent id must not leak into the email");
    });
  }

  test("html: prominent CTA button links the pre-selected starter pack", () => {
    assert.ok(email.html.includes(`<a class="btn" href="${packLink("starter")}"`));
  });
  test("html: every pack card is itself the link (one-click)", () => {
    for (const p of RECOMMENDABLE_PACKS) {
      assert.ok(
        email.html.includes(`<a class="stat" href="${packLink(p.id)}"`),
        `${p.id} card is not a link`
      );
    }
  });
  test("text: plaintext alternative is non-empty (buy link works in text-only clients)", () => {
    assert.ok(typeof email.text === "string" && email.text.trim().length > 0);
  });
}

console.log("\ncross-cutting:");

test("subjects unchanged (dedup/analytics continuity)", () => {
  assert.strictEqual(low.subject, "⚠️ Low credits — 17 remaining on Arch Tools");
  assert.strictEqual(depleted.subject, "Your Arch Tools credits ran out — how to top up");
});

test("balance figure renders in both emails", () => {
  assert.ok(low.html.includes("<strong>17 credits</strong>") && low.text.includes("17 remaining"));
  assert.ok(depleted.html.includes("<strong>0 credits</strong>") && depleted.text.includes("(0 credits)"));
});

test("depleted email keeps the x402 per-call alternative", () => {
  for (const out of [depleted.html, depleted.text]) {
    assert.ok(out.includes("https://archtools.dev/x402-guide"));
  }
});

test("every linked pack id is in the pricing.html ?pack= preselect allowlist", () => {
  const pricing = fs.readFileSync(pub("pricing.html"), "utf-8");
  for (const p of RECOMMENDABLE_PACKS) {
    assert.ok(
      pricing.includes(`pack !== '${p.id}'`),
      `pricing.html preselect allowlist missing '${p.id}'`
    );
    assert.ok(
      pricing.includes(`data-pack="${p.id}"`),
      `pricing.html has no buy button for '${p.id}'`
    );
  }
});

test("send wrappers pass the text alternative through (source pin)", () => {
  const emailSrc = fs.readFileSync(src("services", "email.ts"), "utf-8");
  const lowBlock = emailSrc.slice(
    emailSrc.indexOf("export async function sendLowCreditAlert"),
    emailSrc.indexOf("// ─── 4. Purchase Confirmation")
  );
  assert.ok(lowBlock.includes("renderLowCreditAlert(creditsRemaining, agentId)"));
  assert.ok(lowBlock.includes("sendEmail(to, subject, html, text)"));
  const depBlock = emailSrc.slice(emailSrc.indexOf("export async function sendCreditsDepletedAlert"));
  assert.ok(depBlock.includes("renderCreditsDepletedAlert(agentId, creditsRemaining)"));
  assert.ok(depBlock.includes("sendEmail(to, subject, html, text)"));
});

test("alert wiring untouched: utils/credits.ts still sends both alerts", () => {
  const creditsSrc = fs.readFileSync(src("utils", "credits.ts"), "utf-8");
  assert.ok(creditsSrc.includes("sendLowCreditAlert(email, agent.credits, agent.id)"));
  assert.ok(creditsSrc.includes("sendCreditsDepletedAlert(email, agent.id, Math.max(agent.credits, 0))"));
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log("\nall credit-email-buylinks tests passed");
