/**
 * Focused unit tests for the OAuth/workflow hardening fixes:
 *  - #14 (CRITICAL stored XSS): consent-page HTML escaping neutralizes
 *        attacker-controlled client_name / error strings.
 *  - #13 (path traversal): workflow step.tool is validated against a strict
 *        slug allowlist; "../agent/register" cannot escape /v1/tools.
 *  - #13 (refresh expiry): a refresh token stays valid past the 1h access-token
 *        expiry, up to its own 30d refresh lifetime.
 *  - #23 (CRITICAL crash DoS): a workflow step with missing/non-object input is
 *        rejected by the validation fn (→ 400) instead of throwing.
 *
 * Run: npm run build first (populates dist/), then:
 *   node tests/oauth-workflow-hardening.test.mjs
 */
import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = (...p) => path.join(__dirname, "..", "dist", ...p);

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
  const oauth = await import(distPath("routes", "oauth.js"));
  const oauthTokens = await import(distPath("lib", "oauthTokens.js"));
  const workflows = await import(distPath("routes", "workflows.js"));

  // ── #14: consent-page XSS escaping ────────────────────────────────────────
  console.log("OAuth consent — HTML escaping (#14 stored XSS):");
  const { esc } = oauth;

  test("escapeHtml neutralizes a <script> payload in clientName", () => {
    const out = esc('<script>alert(document.cookie)</script>');
    assert.ok(!out.includes("<script>"), "raw <script> tag must not survive");
    assert.strictEqual(
      out,
      "&lt;script&gt;alert(document.cookie)&lt;/script&gt;"
    );
  });

  test("escapeHtml escapes double-quotes (breaks out of value=\"...\" attrs)", () => {
    const out = esc('"><img src=x onerror=alert(1)>');
    assert.ok(!out.includes('"'), 'raw double-quote must be escaped');
    assert.ok(!out.includes("<img"), "raw < must be escaped");
    assert.strictEqual(
      out,
      "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"
    );
  });

  test("escapeHtml escapes & and single-quote too", () => {
    assert.strictEqual(esc(`a&b'c`), "a&amp;b&#x27;c");
  });

  // ── #13: workflow step.tool path-traversal guard ──────────────────────────
  console.log("Workflows — tool slug validation (#13 path traversal):");
  const { isValidWorkflowToolName } = workflows;

  test("normal tool slug is accepted", () =>
    assert.strictEqual(isValidWorkflowToolName("generate-uuid"), true));
  test("path traversal '../agent/register' is rejected", () =>
    assert.strictEqual(isValidWorkflowToolName("../agent/register"), false));
  test("encoded traversal is rejected before URL normalization", () =>
    assert.strictEqual(isValidWorkflowToolName("%2e%2e%2fagent"), false));
  test("absolute URL tool value is rejected", () =>
    assert.strictEqual(isValidWorkflowToolName("https://evil.example/tool"), false));
  test("empty / non-string tool values are rejected", () => {
    assert.strictEqual(isValidWorkflowToolName(""), false);
    assert.strictEqual(isValidWorkflowToolName(null), false);
    assert.strictEqual(isValidWorkflowToolName(undefined), false);
    assert.strictEqual(isValidWorkflowToolName(42), false);
  });
  test("uppercase / slash / dot tool names are rejected", () => {
    assert.strictEqual(isValidWorkflowToolName("Foo"), false);
    assert.strictEqual(isValidWorkflowToolName("a/b"), false);
    assert.strictEqual(isValidWorkflowToolName("a.b"), false);
  });

  // ── #23: workflow step.input crash-DoS guard ──────────────────────────────
  console.log("Workflows — step input validation (#23 crash DoS):");
  const { isValidWorkflowStepInput } = workflows;

  test("missing input (undefined) is rejected → handled 400, not a throw", () =>
    assert.strictEqual(isValidWorkflowStepInput(undefined), false));
  test("null input is rejected", () =>
    assert.strictEqual(isValidWorkflowStepInput(null), false));
  test("array / primitive input is rejected", () => {
    assert.strictEqual(isValidWorkflowStepInput([1, 2]), false);
    assert.strictEqual(isValidWorkflowStepInput("str"), false);
    assert.strictEqual(isValidWorkflowStepInput(7), false);
  });
  test("a plain object input is accepted", () =>
    assert.strictEqual(isValidWorkflowStepInput({ a: 1 }), true));
  test("a step with missing input never reaches JSON.stringify (guard returns false)", () => {
    // Simulates the handler path: validate BEFORE JSON.stringify(step.input).
    const step = { tool: "generate-uuid" }; // no input
    let threw = false;
    if (isValidWorkflowStepInput(step.input)) {
      try { JSON.stringify(step.input).replace(/x/g, "y"); } catch { threw = true; }
    }
    assert.strictEqual(threw, false, "stringify path must never be reached for missing input");
  });

  // ── #13: refresh-token lifetime is decoupled from access-token expiry ──────
  console.log("OAuth — refresh token lifetime (#13):");
  test("expired access token does NOT imply expired refresh token", () => {
    const now = new Date("2026-07-26T05:00:00.000Z");
    const token = { createdAt: new Date(now.getTime() - oauthTokens.OAUTH_ACCESS_TOKEN_TTL_MS - 1000) };
    assert.strictEqual(oauthTokens.isOAuthRefreshTokenExpired(token, now), false);
  });
  test("refresh token expires only after the refresh-token TTL", () => {
    const now = new Date("2026-07-26T05:00:00.000Z");
    const token = { createdAt: new Date(now.getTime() - oauthTokens.OAUTH_REFRESH_TOKEN_TTL_MS - 1000) };
    assert.strictEqual(oauthTokens.isOAuthRefreshTokenExpired(token, now), true);
  });
  test("cleanup cutoff tracks refresh-token lifetime, not access-token lifetime", () => {
    const now = new Date("2026-07-26T05:00:00.000Z");
    const cutoff = oauthTokens.oauthRefreshCutoff(now);
    assert.strictEqual(cutoff.getTime(), now.getTime() - oauthTokens.OAUTH_REFRESH_TOKEN_TTL_MS);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll OAuth/workflow hardening tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
