/**
 * Security P0 regressions (2026-11-02 audit).
 *
 * 1  /auth/reset-password only accepts the 64-hex token we issue — a Prisma
 *    filter object ({"not":""}) used to match another account's pending reset.
 * 2  Signup-style email checks reject HTML-significant characters, and the
 *    admin panel escapes every user-controlled value it renders (stored XSS).
 * 3  Self-registered facilitator providers start inactive (pending approval)
 *    and /settle refuses amounts below the gas floor.
 * 4  No script carries a hard-coded private key.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// 1
const auth = src("src/routes/auth.ts");
assert.ok(auth.includes('if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {'), "reset token must be a 64-hex string");
assert.ok(auth.includes('if (typeof email !== "string" || !email) {'), "forgot-password email must be a string");

// 2
const SAFE = String.raw`/^[^\s@<>"'` + "`" + String.raw`]+@[^\s@<>"'` + "`" + String.raw`]+\.[^\s@<>"'` + "`" + String.raw`]+$/`;
for (const f of ["src/routes/agents.ts", "src/routes/trial.ts", "src/routes/agent.ts", "src/routes/facilitator.ts"]) {
  const s = src(f);
  assert.ok(!s.includes(String.raw`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), `${f}: old permissive email regex must be gone`);
  assert.ok(s.includes(SAFE), `${f}: must use the HTML-safe email regex`);
}
const emailRe = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
assert.equal(emailRe.test("<img/src=x/onerror=alert(1)>@example.com"), false);
assert.equal(emailRe.test('a"b@example.com'), false);
assert.equal(emailRe.test("real.person+tag@gmail.com"), true);
const admin = src("public/admin.html");
assert.ok(!/\$\{a\.email/.test(admin), "admin.html must not interpolate a.email unescaped");
assert.ok(admin.includes("${esc(a.email || '—')}"), "admin.html must escape emails");
assert.ok(admin.includes("function esc(v)"), "admin.html must define esc()");

// 3
const fac = src("src/routes/facilitator.ts");
assert.ok(/active: false,/.test(fac), "new facilitator providers must start inactive");
assert.ok(fac.includes('error: "amount_too_small"'), "settle must refuse amounts below the gas floor");

// 4
for (const f of readdirSync(new URL("../scripts/", import.meta.url))) {
  const s = src(`scripts/${f}`);
  assert.ok(!/privateKeyToAccount\(\s*["']0x[0-9a-fA-F]{64}["']\s*\)/.test(s), `scripts/${f} must not hard-code a private key`);
}

console.log("All security-p0 tests passed.");
