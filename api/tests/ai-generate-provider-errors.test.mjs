/**
 * ai-generate provider failure regression coverage.
 *
 * Guards the paid-empty-success bug: OpenAI/Gemini/xAI non-2xx or empty
 * responses must not be coerced into { ok:true, text:"" }, because successful
 * responses are charged/logged by the credit finalizer.
 *
 * Run: cd api && node tests/ai-generate-provider-errors.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "tools", "index.ts"), "utf8");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

function route(name) {
  const start = toolsSrc.indexOf(`router.post("/${name}"`);
  assert.ok(start >= 0, `missing route for ${name}`);
  const end = toolsSrc.indexOf("router.post(", start + 1);
  return toolsSrc.slice(start, end > start ? end : undefined);
}

const aiGenerateRoute = route("ai-generate");

console.log("ai-generate provider failure handling:");

test("shared helpers convert provider failures into non-2xx API responses", () => {
  assert.match(toolsSrc, /async function readProviderJson\(resp: globalThis\.Response\)/);
  assert.match(toolsSrc, /function providerFailureStatus\(status: number\): number/);
  assert.match(toolsSrc, /status === 429 \? "rate_limited" : `\$\{provider\}_error`/);
});

for (const [provider, label, emptyMessage] of [
  ["openai", "OpenAI", "OpenAI returned an empty response"],
  ["google", "Google", "Google returned an empty response"],
  ["xai", "xAI", "xAI returned an empty response"],
]) {
  test(`${provider}: checks resp.ok before success`, () => {
    const providerBlock = aiGenerateRoute.slice(aiGenerateRoute.indexOf(`provider: "${provider}"`) - 900, aiGenerateRoute.indexOf(`provider: "${provider}"`) + 500);
    assert.match(providerBlock, /if \(!resp\.ok\)/, `${provider} branch must check provider HTTP status`);
    assert.match(providerBlock, new RegExp(`providerFailureCode\\("${provider}", resp\\.status\\)`));
    assert.match(providerBlock, new RegExp(`providerFailureMessage\\("${label}", resp\\.status, data\\)`));
  });

  test(`${provider}: empty provider output is not a paid success`, () => {
    assert.ok(aiGenerateRoute.includes(emptyMessage), `${provider} empty response message missing`);
    assert.ok(!new RegExp(`provider: "${provider}"[\\s\\S]{0,500}const text = data\\.[\\s\\S]*?\\?\\? "";[\\s\\S]{0,250}res\\.json\\(\\{ ok: true`).test(aiGenerateRoute),
      `${provider} must not immediately turn missing output into ok:true`);
  });
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll ai-generate provider-error tests passed.");
