/**
 * Regression test — starter-credit split (2026-07-26 funnel fix).
 *
 * Verifies issueEmailVerification against the built dist with a stubbed
 * prisma layer: the starter allowance activates immediately (credits
 * increment), the remainder gates in pendingCredits, and a lost identity
 * claim grants neither.
 *
 * Run: node api/tests/starter-credits.test.mjs   (after npm run build)
 */
process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";

const { prisma } = await import("../dist/lib/prisma.js");
const { issueEmailVerification, SIGNUP_STARTER_CREDITS } = await import("../dist/lib/verification.js");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

// Stub the two prisma calls the function makes. claimResult controls whether
// the SignupIdentity unique insert "wins" (1 row) or loses (0 rows).
let claimResult = 1;
let lastUpdate = null;
prisma.$executeRaw = async () => claimResult;
prisma.agent.update = async (args) => { lastUpdate = args; return {}; };

console.log(`SIGNUP_STARTER_CREDITS = ${SIGNUP_STARTER_CREDITS}`);
assert(SIGNUP_STARTER_CREDITS > 0, "starter allowance is enabled by default");

// Case 1: normal signup, grant 100 → starter live now, rest pending
claimResult = 1;
let r = await issueEmailVerification("agent-1", "fresh@example.com", 100);
assert(r.starter === SIGNUP_STARTER_CREDITS, `starter=${r.starter} activates immediately on a fresh signup`);
assert(r.pending === 100 - SIGNUP_STARTER_CREDITS, `pending=${r.pending} gates the remainder`);
assert(lastUpdate.data.credits.increment === r.starter, "credits use increment (can never wipe a balance)");
assert(lastUpdate.data.pendingCredits === r.pending, "pendingCredits set to the gated remainder");
assert(lastUpdate.data.emailVerified === false, "email still unverified");
assert(typeof lastUpdate.data.verifyToken === "string" && lastUpdate.data.verifyToken.length === 64, "verify token still issued");

// Case 2: duplicate identity (claim lost) → no credits at all
claimResult = 0;
r = await issueEmailVerification("agent-2", "dupe@example.com", 100);
assert(r.starter === 0 && r.pending === 0, "lost identity claim grants neither starter nor pending");
assert(lastUpdate.data.credits.increment === 0, "no credit increment on a farmed identity");

// Case 3: grant smaller than the starter allowance → starter capped at grant
claimResult = 1;
r = await issueEmailVerification("agent-3", "small@example.com", Math.max(1, SIGNUP_STARTER_CREDITS - 5));
assert(r.starter === Math.max(1, SIGNUP_STARTER_CREDITS - 5) && r.pending === 0, "starter never exceeds the total grant");

// Case 4: trial-sized grant (250) → same split, big pending
claimResult = 1;
r = await issueEmailVerification("agent-4", "trial@example.com", 250);
assert(r.starter === SIGNUP_STARTER_CREDITS && r.pending === 250 - SIGNUP_STARTER_CREDITS, "trial grant splits the same way");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
