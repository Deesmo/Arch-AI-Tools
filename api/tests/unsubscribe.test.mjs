/**
 * Unsubscribe token — sign/verify roundtrip + tamper rejection (CAN-SPAM opt-out).
 * Run: cd api && npm run build && node tests/unsubscribe.test.mjs
 */
import assert from "assert";

process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
delete process.env.JWT_SECRET;

const { signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } = await import("../dist/lib/unsubscribe.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log("Unsubscribe token:");

test("roundtrip: sign then verify returns the agent id", () => {
  const token = signUnsubscribeToken("clx123agent");
  assert.strictEqual(verifyUnsubscribeToken(token), "clx123agent");
});

test("token is URL-safe (base64url, no +/=)", () => {
  const token = signUnsubscribeToken("cme0abcdef1234567890");
  assert.strictEqual(encodeURIComponent(token), token.replace(/\./g, "."));
  assert.ok(!/[+/=]/.test(token));
});

test("tampered payload is rejected", () => {
  const token = signUnsubscribeToken("agent-a");
  const other = Buffer.from("agent-b", "utf8").toString("base64url");
  const forged = `${other}.${token.split(".")[1]}`;
  assert.strictEqual(verifyUnsubscribeToken(forged), null);
});

test("tampered signature is rejected", () => {
  const token = signUnsubscribeToken("agent-a");
  const [payload, sig] = token.split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.strictEqual(verifyUnsubscribeToken(`${payload}.${flipped}`), null);
});

test("garbage inputs are rejected, never throw", () => {
  for (const bad of [null, undefined, "", ".", "abc", "abc.", ".abc", "a.b.c", "%%%.%%%", "x".repeat(600)]) {
    assert.strictEqual(verifyUnsubscribeToken(bad), null, `should reject: ${String(bad).slice(0, 20)}`);
  }
});

test("token signed under a different secret is rejected", () => {
  const token = signUnsubscribeToken("agent-a");
  process.env.UNSUBSCRIBE_SECRET = "a-completely-different-secret";
  assert.strictEqual(verifyUnsubscribeToken(token), null);
  process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
  assert.strictEqual(verifyUnsubscribeToken(token), "agent-a");
});

test("unsubscribeUrl points at /unsubscribe with an encoded token", () => {
  const url = unsubscribeUrl("agent-xyz");
  assert.ok(url.startsWith("https://archtools.dev/unsubscribe?token="), url);
  const token = decodeURIComponent(url.split("token=")[1]);
  assert.strictEqual(verifyUnsubscribeToken(token), "agent-xyz");
});

test("signing without any secret throws loudly (fail-closed)", () => {
  delete process.env.UNSUBSCRIBE_SECRET;
  assert.throws(() => signUnsubscribeToken("agent-a"), /must be set/);
  process.env.UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall unsubscribe-token tests passed");
