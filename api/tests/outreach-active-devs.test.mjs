/**
 * Active-dev outreach copy — render checks (CAN-SPAM elements + honest claims).
 * Importing the script module is safe: the isMainModule guard means the
 * campaign only runs when the file is the entrypoint.
 * Run: cd api && npm run build && node tests/outreach-active-devs.test.mjs
 */
import assert from "assert";

process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5/test";

const { SUBJECT, renderText, renderHtml } = await import("../dist/scripts/outreachActiveDevs.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const UNSUB = "https://archtools.dev/unsubscribe?token=abc.def";
const ADDR = "[BUSINESS_ADDRESS — Brad to provide]";

console.log("Active-dev outreach email render:");

test("subject matches the campaign", () => {
  assert.strictEqual(SUBJECT, "Quick question from the Arch Tools builder");
});

for (const [label, render] of [["text", renderText], ["html", renderHtml]]) {
  const out = render("Sam", UNSUB, ADDR);
  test(`${label}: unsubscribe link present (CAN-SPAM)`, () => assert.ok(out.includes(UNSUB)));
  test(`${label}: physical address present (CAN-SPAM)`, () => assert.ok(out.includes(ADDR)));
  test(`${label}: relationship line present (CAN-SPAM)`, () =>
    assert.ok(out.includes("because you created an Arch Tools account")));
  test(`${label}: personal ask present`, () =>
    assert.ok(out.includes("worth paying for") && out.includes("I read everything")));
  test(`${label}: MCP connector URL present`, () => assert.ok(out.includes("https://archtools.dev/mcp")));
  test(`${label}: USDC chains limited to Base + Polygon (honest claims)`, () => {
    assert.ok(out.includes("USDC on Base or Polygon"));
    for (const chain of ["Ethereum", "Solana", "Arbitrum", "Optimism", "Avalanche"]) {
      assert.ok(!out.includes(chain), `must not claim ${chain}`);
    }
  });
  test(`${label}: signed by Brad`, () => assert.ok(out.includes("— Brad")));
}

test("greeting personalizes with name, falls back to plain 'Hi —'", () => {
  assert.ok(renderText("Sam", UNSUB, ADDR).startsWith("Hi Sam — saw you've been using Arch Tools."));
  assert.ok(renderText(null, UNSUB, ADDR).startsWith("Hi — saw you've been using Arch Tools."));
});

test("html escapes a hostile display name", () => {
  const out = renderHtml('<script>alert(1)</script>', UNSUB, ADDR);
  assert.ok(!out.includes("<script>alert(1)</script>"));
  assert.ok(out.includes("&lt;script&gt;"));
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall outreach-active-devs tests passed");
