/**
 * Purchase-intent funnel — regression tests (growth/intent-funnel).
 *
 * Covers:
 *   A  isSafeSignupNext — the widened /signup ?next= allowlist: exact page
 *      paths (/pricing, /dashboard, /docs, /playground) plus the original
 *      /oauth/authorize prefix rule. Injection hardening unchanged: external
 *      URLs, protocol-relative, javascript:, traversal, lookalikes, query
 *      strings on page paths, and HTML-breakout chars are all rejected.
 *      isSafeOAuthNext itself stays oauth-only (consent-resume surfaces keep
 *      the tighter rule).
 *   B  recommendPack — smallest sufficient pack from credits_needed, with
 *      largest-pack fallback and never-throw degradation; packUrl shape.
 *   C  Surface pins — 402 body carries recommended_pack + links.buy_now;
 *      signup page validates the page allowlist client-side and renders the
 *      "Continue to <label>" CTA; dashboard has the three upsell states;
 *      pricing.html preselect block never auto-fires checkout; all 8 SEO
 *      landers carry the /signup?next=%2Fpricing buy-intent CTA.
 *
 * Run: npm run build first (populates dist/), then:
 *   node tests/intent-funnel.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = (...p) => path.join(__dirname, "..", "dist", ...p);
const src = (...p) => path.join(__dirname, "..", "src", ...p);
const pub = (...p) => path.join(__dirname, "..", "public", ...p);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

async function main() {
  const { isSafeOAuthNext, isSafeSignupNext, SIGNUP_NEXT_LABELS } =
    await import(distPath("utils", "oauthNext.js"));
  const { recommendPack, packUrl, RECOMMENDABLE_PACKS } =
    await import(distPath("lib", "creditPacks.js"));
  const { SIGNUP_HTML } = await import(distPath("assets", "signupHtml.js"));
  const { DASHBOARD_HTML } = await import(distPath("assets", "dashboardHtml.js"));

  // ── A: the signup ?next= allowlist ─────────────────────────────────────
  console.log("A — isSafeSignupNext (exact page paths + oauth prefix):");

  for (const p of ["/pricing", "/dashboard", "/docs", "/playground"]) {
    test(`accepts exact allowlisted path ${p}`, () =>
      assert.strictEqual(isSafeSignupNext(p), true));
  }
  test("accepts the oauth authorize path (rule preserved)", () => {
    assert.strictEqual(isSafeSignupNext("/oauth/authorize"), true);
    assert.strictEqual(isSafeSignupNext("/oauth/authorize?client_id=arch_x&state=y"), true);
  });

  const rejected = [
    ["query string on a page path", "/pricing?pack=starter"],
    ["trailing slash", "/pricing/"],
    ["case variant", "/Pricing"],
    ["subpath", "/pricing/evil"],
    ["lookalike prefix", "/pricingevil"],
    ["path traversal", "/pricing/../admin"],
    ["non-allowlisted same-origin path", "/refer"],
    ["absolute external URL", "https://evil.com/pricing"],
    ["protocol-relative URL", "//evil.com/pricing"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["attr-breakout chars", '/pricing"><img src=x>'],
    ["embedded whitespace", "/pricing 2"],
    ["newline injection", "/pricing\nSet-Cookie:a=b"],
    ["empty string", ""],
  ];
  for (const [name, value] of rejected) {
    test(`rejects ${name}`, () =>
      assert.strictEqual(isSafeSignupNext(value), false, `must reject: ${JSON.stringify(value)}`));
  }
  test("rejects non-string inputs", () => {
    for (const v of [undefined, null, 42, ["/pricing"], { toString: () => "/pricing" }]) {
      assert.strictEqual(isSafeSignupNext(v), false, `must reject non-string ${typeof v}`);
    }
  });
  test("isSafeOAuthNext stays oauth-only (page paths still rejected there)", () => {
    for (const p of ["/pricing", "/dashboard", "/docs", "/playground"]) {
      assert.strictEqual(isSafeOAuthNext(p), false, `${p} must NOT pass the oauth-only guard`);
    }
  });
  test("every allowlisted path is a registered route in index.ts", () => {
    const indexSrc = fs.readFileSync(src("index.ts"), "utf-8");
    for (const p of SIGNUP_NEXT_LABELS.keys()) {
      assert.ok(indexSrc.includes(`app.get("${p}"`), `route missing for ${p}`);
    }
  });
  test("server /signup guard uses the widened validator", () => {
    const indexSrc = fs.readFileSync(src("index.ts"), "utf-8");
    assert.ok(indexSrc.includes("!isSafeSignupNext(req.query.next)"));
  });

  // ── B: recommendPack ─────────────────────────────────────────────────────
  console.log("\nB — recommendPack (smallest sufficient):");

  test("pack catalog mirrors billing (3k/25k/125k @ $9/$49/$199)", () => {
    assert.deepStrictEqual(
      RECOMMENDABLE_PACKS.map((p) => [p.id, p.credits, p.priceUsd]),
      [["starter", 3000, 9], ["pro", 25000, 49], ["business", 125000, 199]]
    );
    // Drift guard: routes/billing.ts must still sell the same sizes.
    const billingSrc = fs.readFileSync(src("routes", "billing.ts"), "utf-8");
    assert.ok(billingSrc.includes('{ id: "starter",  credits: 3000,   amount: 900,'));
    assert.ok(billingSrc.includes('{ id: "pro",      credits: 25000,  amount: 4900,'));
    assert.ok(billingSrc.includes('{ id: "business", credits: 125000, amount: 19900,'));
  });
  const cases = [
    [1, "starter"], [700, "starter"], [3000, "starter"],
    [3001, "pro"], [25000, "pro"],
    [25001, "business"], [125000, "business"],
    [999999, "business"], // exceeds every pack → largest
    [0, "starter"], [-5, "starter"], [NaN, "starter"], [Infinity, "starter"],
  ];
  for (const [needed, id] of cases) {
    test(`credits_needed=${needed} → ${id}`, () =>
      assert.strictEqual(recommendPack(needed).id, id));
  }
  test("packUrl builds the preselect link", () =>
    assert.strictEqual(packUrl("starter"), "https://archtools.dev/pricing?pack=starter"));

  // ── C: surface pins ──────────────────────────────────────────────────────
  console.log("\nC — funnel surfaces:");

  const creditsSrc = fs.readFileSync(src("utils", "credits.ts"), "utf-8");
  const refusalBlock = creditsSrc.slice(
    creditsSrc.indexOf("if (deduction.count === 0)"),
    creditsSrc.indexOf("agent.credits -= cost;")
  );
  test("402 body carries recommended_pack (id/credits/price_usd)", () =>
    assert.ok(refusalBlock.includes("recommended_pack: { id: rec.id, credits: rec.credits, price_usd: rec.priceUsd }")));
  test("402 links.buy_now carries the pre-selected pack URL", () =>
    assert.ok(refusalBlock.includes("buy_now: packUrl(rec.id)")));
  test("402 sets X-Upgrade-URL to the same pack URL", () =>
    assert.ok(refusalBlock.includes('res.setHeader("X-Upgrade-URL", packUrl(rec.id))')));

  test("signup page mirrors the page allowlist client-side", () => {
    for (const p of ["/pricing", "/dashboard", "/docs", "/playground"]) {
      assert.ok(SIGNUP_HTML.includes(`'${p}':`), `client map missing ${p}`);
    }
    assert.ok(SIGNUP_HTML.includes("Object.prototype.hasOwnProperty.call(PAGE_NEXT_LABELS, rawNext)"));
  });
  test("signup success renders the Continue-to CTA from the validated map", () => {
    assert.ok(SIGNUP_HTML.includes("Continue to ' + PAGE_NEXT_LABELS[pageNext]"));
    assert.ok(SIGNUP_HTML.includes("} else if (pageNext) {"), "page CTA must not override the oauth resume CTA");
  });
  test("oauth resume CTA unchanged", () =>
    assert.ok(SIGNUP_HTML.includes("Continue connecting your account")));

  test("dashboard has the three upsell states", () => {
    assert.ok(DASHBOARD_HTML.includes('id="depleted-banner"'), "zero-balance banner missing");
    assert.ok(DASHBOARD_HTML.includes('id="upgrade-banner"'), "low-balance banner missing");
    assert.ok(DASHBOARD_HTML.includes('id="verify-banner"'), "verify banner missing");
    assert.ok(DASHBOARD_HTML.includes('(cr === 0) ? "flex" : "none"'));
    assert.ok(DASHBOARD_HTML.includes('(cr > 0 && cr < 50) ? "flex" : "none"'));
    assert.ok(DASHBOARD_HTML.includes('data.email_verified === false && pending > 0'));
    assert.ok(DASHBOARD_HTML.includes('href="/pricing?pack=starter"'));
  });
  test("/v1/agent/usage exposes email_verified + pending_credits", () => {
    const agentSrc = fs.readFileSync(src("routes", "agent.ts"), "utf-8");
    assert.ok(agentSrc.includes("email_verified: verification?.emailVerified ?? true"));
    assert.ok(agentSrc.includes("pending_credits: verification?.pendingCredits ?? 0"));
  });

  test("pricing.html preselect: highlight + scroll only, never auto-checkout", () => {
    const pricing = fs.readFileSync(pub("pricing.html"), "utf-8");
    const start = pricing.indexOf("// Pack preselect");
    assert.ok(start > -1, "preselect block missing");
    const block = pricing.slice(start, pricing.indexOf("})();", start));
    assert.ok(block.includes("classList.add('preselected')"));
    assert.ok(block.includes("scrollIntoView"));
    for (const forbidden of ["startCheckout", "buyPack", "buySubscription", "fetch("]) {
      assert.ok(!block.includes(forbidden), `preselect block must not call ${forbidden}`);
    }
  });

  test("alert emails link the pre-selected pack URLs (one-click buy)", () => {
    const emailSrc = fs.readFileSync(src("services", "email.ts"), "utf-8");
    // The helper builds the same ?pack= preselect deep-link shape …
    assert.ok(emailSrc.includes("`${SITE}/pricing?pack=${id}`"), "packHref helper missing");
    // … and both the low-credit and depleted emails use it for the CTA button.
    const hits = emailSrc.split('packHref("starter")').length - 1;
    assert.ok(hits >= 2, `expected low-credit + depleted emails to carry the pack CTA, found ${hits}`);
    // Deep render coverage lives in credit-email-buylinks.test.mjs.
  });

  const landers = [
    "ai-agent-tools", "ai-media-tools", "crypto-tools", "mcp-server",
    "mcp-tools-for-claude", "utility-tools", "web-data-tools", "x402",
  ];
  test("all 8 SEO landers carry the buy-intent CTA → /signup?next=%2Fpricing", () => {
    for (const l of landers) {
      const html = fs.readFileSync(pub(`${l}.html`), "utf-8");
      assert.ok(html.includes('href="/signup?next=%2Fpricing"'), `${l}.html missing buy-intent CTA`);
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll intent-funnel tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
