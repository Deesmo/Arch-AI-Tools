/**
 * Regression coverage for high-severity bugs found by the critical-bug scan.
 *
 * Run: node api/tests/critical-regressions.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

const agentSrc = fs.readFileSync(path.join(srcRoot, "routes", "agent.ts"), "utf8");
const toolsSrc = fs.readFileSync(path.join(srcRoot, "routes", "tools", "index.ts"), "utf8");
const seedSrc = fs.readFileSync(path.join(srcRoot, "seed.ts"), "utf8");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.error(error);
  }
}

function seedCredits(toolName) {
  const match = seedSrc.match(new RegExp(`name: "${toolName}"[\\s\\S]*?credits: (\\d+)`));
  assert.ok(match, `missing seed entry for ${toolName}`);
  return Number(match[1]);
}

function responseCredits(toolName) {
  const route = toolsSrc.match(new RegExp(`router\\.post\\("/${toolName}"[\\s\\S]*?\\n\\}\\);`));
  assert.ok(route, `missing route for ${toolName}`);
  const matches = [...route[0].matchAll(/credits_used:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(matches.length > 0, `missing credits_used response for ${toolName}`);
  return new Set(matches);
}

test("account deletion erases SignupIdentity using the shared normalized email identity", () => {
  assert.ok(agentSrc.includes("normalizeEmailIdentity"), "agent route imports normalizeEmailIdentity");
  assert.match(
    agentSrc,
    /signupIdentity\.deleteMany\(\{\s*where:\s*\{\s*normalizedEmail:\s*normalizeEmailIdentity\(email\)\s*\}\s*\}\)/,
    "DELETE /v1/agent must delete the same normalized identity signup stored",
  );
});

test("seed catalog advertises the audited default/base prices actually charged", () => {
  assert.strictEqual(seedCredits("web-search"), 14);
  assert.strictEqual(seedCredits("ocr-extract"), 12);
  assert.strictEqual(seedCredits("email-find"), 110);
  assert.strictEqual(seedCredits("design-create"), 50);
  assert.strictEqual(seedCredits("news-search"), 12);
  assert.strictEqual(seedCredits("fact-check"), 14);
  assert.strictEqual(seedCredits("video-generate"), 700);
  assert.strictEqual(seedCredits("image-remove-bg"), 350);
});

test("successful result bodies report the same fixed price the route deducts", () => {
  assert.deepStrictEqual(responseCredits("news-search"), new Set([12]));
  assert.deepStrictEqual(responseCredits("fact-check"), new Set([14]));
  assert.deepStrictEqual(responseCredits("email-find"), new Set([0, 110]));
  assert.deepStrictEqual(responseCredits("image-remove-bg"), new Set([350]));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
