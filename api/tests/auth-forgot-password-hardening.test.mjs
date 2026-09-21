/**
 * Security regression — forgot-password malformed email handling.
 *
 * Public auth endpoints must reject non-string emails before normalization.
 * In Express 4, an exception thrown inside an async route can escape route
 * error handling and take down the Node process.
 *
 * Run: cd api && npm run build && node tests/auth-forgot-password-hardening.test.mjs
 */
import assert from "assert";

process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";
process.env.JWT_SECRET ??= "test-secret-do-not-use-in-prod";

const { prisma } = await import("../dist/lib/prisma.js");
const { default: authRouter } = await import("../dist/routes/auth.js");
const express = (await import("express")).default;

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const app = express();
app.use(express.json());
app.use("/auth", authRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

let lookups = [];
prisma.agent.findUnique = async (args) => {
  lookups.push(args);
  return null;
};

async function postForgot(email) {
  const res = await fetch(`${BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  return { res, body };
}

console.log("Forgot-password hardening:");

await test("rejects object email with 400 and no DB lookup", async () => {
  lookups = [];
  const { res, body } = await postForgot({ toString: "boom@example.com" });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.error, "email_required");
  assert.deepStrictEqual(lookups, []);
});

await test("rejects blank email with 400 and no DB lookup", async () => {
  lookups = [];
  const { res, body } = await postForgot("   ");
  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.error, "email_required");
  assert.deepStrictEqual(lookups, []);
});

await test("normalizes string email and keeps neutral success response", async () => {
  lookups = [];
  const { res, body } = await postForgot("  USER@Example.COM  ");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(lookups, [{ where: { email: "user@example.com" } }]);
});

server.close();

console.log(`\n${3 - failures} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
