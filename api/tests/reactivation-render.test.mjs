/**
 * Reactivation campaign copy — render checks (CAN-SPAM elements + hooks).
 * Importing the script module is safe: the isMainModule guard means the
 * campaign only runs when the file is the entrypoint.
 * Run: cd api && npm run build && node tests/reactivation-render.test.mjs
 */
import assert from "assert";

process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5/test";

const { SUBJECT, renderText, renderHtml, parseExcludeDomains, emailDomain } = await import("../dist/scripts/reactivationEmail.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const UNSUB = "https://archtools.dev/unsubscribe?token=abc.def";
const ADDR = "[BUSINESS_ADDRESS — Brad to provide]";

console.log("Reactivation email render:");

test("subject matches the campaign", () => {
  assert.strictEqual(SUBJECT, "Your Arch Tools account just got a lot more useful");
});

for (const [label, render] of [["text", renderText], ["html", renderHtml]]) {
  const out = render("Sam", 25, true, UNSUB, ADDR);
  test(`${label}: unsubscribe link present (CAN-SPAM)`, () => assert.ok(out.includes(UNSUB)));
  test(`${label}: physical address present (CAN-SPAM)`, () => assert.ok(out.includes(ADDR)));
  test(`${label}: relationship line present (CAN-SPAM)`, () =>
    assert.ok(out.includes("because you created an Arch Tools account")));
  test(`${label}: MCP connector URL present`, () => assert.ok(out.includes("https://archtools.dev/mcp")));
  test(`${label}: pricing CTA present`, () => assert.ok(out.includes("https://archtools.dev/pricing")));
  test(`${label}: 63 tools mentioned`, () => assert.ok(out.includes("63 tools")));
  test(`${label}: quickstart curl uses a real 1-credit tool`, () =>
    assert.ok(out.includes("/v1/tools/generate-uuid")));
  test(`${label}: top-up phrasing when credited`, () =>
    assert.ok(out.includes("topped your balance up to") && out.includes("25")));
}

test("non-topped-up copy shows the existing balance instead", () => {
  const out = renderText(null, 1200, false, UNSUB, ADDR);
  assert.ok(out.includes("1,200 credits"));
  assert.ok(!out.includes("topped your balance"));
});

test("greeting personalizes with name, falls back to 'there'", () => {
  assert.ok(renderText("Sam", 25, true, UNSUB, ADDR).startsWith("Hi Sam,"));
  assert.ok(renderText(null, 25, true, UNSUB, ADDR).startsWith("Hi there,"));
});

test("html escapes a hostile display name", () => {
  const out = renderHtml('<script>alert(1)</script>', 25, true, UNSUB, ADDR);
  assert.ok(!out.includes("<script>alert(1)</script>"));
  assert.ok(out.includes("&lt;script&gt;"));
});

console.log("\nInternal-domain exclusion (recipient selection):");

test("EXCLUDE_EMAIL_DOMAINS unset → defaults to archtools.dev", () => {
  const set = parseExcludeDomains(undefined);
  assert.deepStrictEqual([...set], ["archtools.dev"]);
});

test("EXCLUDE_EMAIL_DOMAINS parses comma-separated, trimmed, lowercased", () => {
  const set = parseExcludeDomains(" Foo.COM , bar.io ,,archtools.dev ");
  assert.deepStrictEqual([...set].sort(), ["archtools.dev", "bar.io", "foo.com"]);
});

test("EXCLUDE_EMAIL_DOMAINS='' explicitly disables exclusion", () => {
  assert.strictEqual(parseExcludeDomains("").size, 0);
});

test("emailDomain lowercases and takes the part after the last @", () => {
  assert.strictEqual(emailDomain("Brad@ArchTools.DEV"), "archtools.dev");
  assert.strictEqual(emailDomain("no-at-sign"), "");
});

test("internal aliases match the default exclusion; real users do not", () => {
  const set = parseExcludeDomains(undefined);
  for (const internal of ["lucius@archtools.dev", "brad@archtools.dev", "mc1@ARCHTOOLS.DEV"]) {
    assert.ok(set.has(emailDomain(internal)), `${internal} should be excluded`);
  }
  assert.ok(!set.has(emailDomain("someone@gmail.com")));
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall reactivation-render tests passed");
