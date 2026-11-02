/**
 * Phase 1 tool fixes (2026-11-02 audit: 63 tools called live).
 * Run: cd api && npm run build && node tests/phase1-tools.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zonedToDate } from "../dist/lib/zonedTime.js";
import { modelCostMultiplier } from "../dist/lib/modelCost.js";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tools = src("src/routes/tools/index.ts");
const handler = (name) => {
  const i = tools.indexOf(`router.post("/${name}"`);
  assert.ok(i >= 0, `handler ${name} exists`);
  return tools.slice(i, tools.indexOf("\nrouter.post(", i + 10));
};

// timezone-convert: 12:00 in New York is 17:00 in London (EST, Nov) — it used to stay 12:00.
const ny = zonedToDate("2026-11-02T12:00", "America/New_York");
assert.equal(ny.toISOString(), "2026-11-02T17:00:00.000Z");
assert.equal(zonedToDate("2026-07-01 12:00:00", "America/New_York").toISOString(), "2026-07-01T16:00:00.000Z"); // EDT
assert.equal(zonedToDate("2026-11-02T12:00:00Z", "Asia/Tokyo").toISOString(), "2026-11-02T12:00:00.000Z"); // explicit offset wins
assert.equal(zonedToDate("2026-11-02T12:00", "UTC").toISOString(), "2026-11-02T12:00:00.000Z");
assert.equal(zonedToDate("2026-03-08T03:30", "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z"); // just after DST start
assert.equal(zonedToDate("not a date", "UTC"), null);
assert.throws(() => zonedToDate("2026-11-02T12:00", "Mars/Olympus"), RangeError);
assert.ok(handler("timezone-convert").includes("zonedToDate(datetime, from_tz)"));

// Catalog field names are accepted (catalog said input/body/type; handlers read text/payload/version).
assert.ok(handler("generate-hash").includes("req.body.text ?? req.body.input"));
assert.ok(handler("webhook-send").includes("req.body.payload ?? req.body.body"));
assert.ok(handler("generate-uuid").includes("req.body.version ?? req.body.type"));
const tt = handler("transform-text");
for (const alias of ['upper: "uppercase"', 'lower: "lowercase"', 'title: "titlecase"']) assert.ok(tt.includes(alias), `transform-text alias ${alias}`);
assert.ok(tt.includes('case "pascal"'), "transform-text implements pascal (documented in openapi.json)");

// email-verify: an RFC 7505 null MX ("0 .") is not a mail server; full disposable list.
const ev = handler("email-verify");
assert.ok(ev.includes("DISPOSABLE_DOMAINS.has("), "email-verify uses the shared disposable list");
const isNullMx = (r) => /^\d+\s+\.$/.test(r);
assert.equal(isNullMx("0 ."), true);
assert.equal(isNullMx("10 mx.example.com."), false);
assert.ok(ev.includes("null_mx"), "email-verify reports null MX");

// html-to-markdown keeps links/emphasis inside paragraphs.
const hm = handler("html-to-markdown");
assert.ok(hm.includes("function inlineMd("), "html-to-markdown renders inline content");
assert.ok(hm.includes('const text = inlineMd(child).trim();'), "paragraphs use inline rendering");

// browser-task refuses actions it cannot perform (was a charged "Simulated" 200).
const bt = handler("browser-task");
assert.ok(!bt.includes("Simulated"), "no simulated browser actions");
assert.ok(bt.includes('error: "unsupported_action"'));

// ai-generate: failed/empty upstream answers are errors (refunded), and models are current.
const ag = handler("ai-generate");
for (const p of ['upstreamFailure(res, "OpenAI"', 'upstreamFailure(res, "Google"', 'upstreamFailure(res, "xAI"', 'upstreamFailure(res, "Anthropic"']) assert.ok(ag.includes(p), p);
assert.ok(ag.includes('"gemini": "gemini-2.5-flash"') && ag.includes('"grok": "grok-4.3"'));
const uf = tools.slice(tools.indexOf("function upstreamFailure("), tools.indexOf("function toolMiddleware("));
assert.ok(/message: byok\s*\?/.test(uf), "provider error text is shown only for the caller's own key (BYOK)");
assert.ok(handler("send-email").includes("mapResendFailure(r.status, err.message)"), "send-email maps Resend failures like email-send");
assert.ok(!/GEMINI_MODELS = \[[^\]]*gemini-1\.5/.test(ag) && !/GROK_MODELS = \[[^\]]*grok-3/.test(ag), "retired models are not routed");
assert.equal(modelCostMultiplier("gemini-2.5-pro"), 0.8);
assert.equal(modelCostMultiplier("grok-4.3"), 0.3);

// Never 502 from origin: Cloudflare replaces origin 502 bodies with its own page.
assert.ok(!tools.includes("status(502)"), "tools never answer 502");
assert.ok(!src("src/routes/chat.ts").includes("status(502)"), "chat never answers 502");
assert.ok(!tools.includes("api.coincap.io/v2"), "dead CoinCap v2 fallback removed");

// Refunded calls report the refund in their credit headers.
const credits = src("src/utils/credits.ts");
assert.ok(credits.includes('res.setHeader("X-Credits-Used", "0");') && credits.includes("res.writeHead = function"), "error responses report X-Credits-Used 0");

// Outgoing requests: default User-Agent; Sentry tracing headers only to our own host.
assert.ok(src("src/lib/ssrf.ts").includes('headers.set("User-Agent", DEFAULT_USER_AGENT)'));
assert.ok(src("src/index.ts").includes("tracePropagationTargets: [/^https:\\/\\/(www\\.)?archtools\\.dev\\//]"));

console.log("All phase1-tools tests passed.");
