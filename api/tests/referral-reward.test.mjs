/**
 * Referral reward engine tests — lib/referralReward.ts (growth/referral-surface).
 *
 * Verifies applyReferralCode against the built dist with a stubbed prisma
 * layer: case-insensitive code lookup, every abuse guard (self-referral by id
 * and by normalized email identity, unverified email, one-bonus-per-account,
 * per-referrer daily cap, P2002 race, same private domain, per-domain and
 * lifetime caps), and the atomic both-sides credit grant.
 *
 * Run: node api/tests/referral-reward.test.mjs   (after npm run build)
 */
process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";

const { prisma } = await import("../dist/lib/prisma.js");
const { applyReferralCode, REFERRAL_REWARD, REFERRAL_DAILY_CAP, REFERRAL_DOMAIN_CAP, REFERRAL_LIFETIME_CAP } = await import("../dist/lib/referralReward.js");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

// ─── Stub state ──────────────────────────────────────────────────────────────
// codeRow          → returned by the code lookup (findFirst with where.code)
// alreadyRow       → returned by the already-referred lookup (where.referredId)
// agents           → id → row returned by agent.findUnique
// completedCount   → returned by referral.count (daily-cap check)
// createThrows     → make referral.create reject (P2002 race simulation)
// rewardedIds      → referral.findMany (all of the referrer's rewarded referrals)
let codeRow, alreadyRow, agents, completedCount, createThrows, rewardedIds;
let capturedCodeWhere, createdRows, agentUpdates;

function reset() {
  codeRow = { id: "ref-1", referrerId: "referrer-1", code: "ARCH-a1b2c3d4", status: "pending", rewardCredits: REFERRAL_REWARD };
  alreadyRow = null;
  agents = {
    "referrer-1": { email: "alice@example.com" },
    // Different private domains: one shared private domain is the same_domain guard (case 11).
    "referred-9": { emailVerified: true, email: "bob@example.org" },
  };
  completedCount = 0;
  createThrows = null;
  rewardedIds = [];
  capturedCodeWhere = null;
  createdRows = [];
  agentUpdates = [];
}

prisma.referral.findFirst = async (args) => {
  const where = args?.where ?? {};
  if (where.code !== undefined) { capturedCodeWhere = where; return codeRow; }
  if (where.referredId !== undefined) return alreadyRow;
  return null;
};
prisma.referral.count = async () => completedCount;
prisma.referral.create = async (args) => {
  if (createThrows) throw createThrows;
  createdRows.push(args.data);
  return args.data;
};
prisma.referral.findMany = async () => rewardedIds.map((referredId) => ({ referredId }));
prisma.agent.findUnique = async (args) => agents[args.where.id] ?? null;
prisma.agent.findMany = async (args) => (args?.where?.id?.in ?? []).map((id) => agents[id]).filter(Boolean);
prisma.agent.update = async (args) => { agentUpdates.push(args); return {}; };
prisma.$transaction = async (arg) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg));

console.log(`REFERRAL_REWARD = ${REFERRAL_REWARD}, REFERRAL_DAILY_CAP = ${REFERRAL_DAILY_CAP}`);
assert(REFERRAL_REWARD > 0, "reward is enabled by default");
assert(REFERRAL_DAILY_CAP >= 1, "daily cap is at least 1");

// Case 1: happy path — both sides credited in one transaction
reset();
let r = await applyReferralCode("referred-9", "  ARCH-A1B2C3D4  ");
assert(r.ok === true, "verified referee applying a valid code succeeds");
assert(r.ok && r.reward === REFERRAL_REWARD, `reward = ${REFERRAL_REWARD}`);
assert(capturedCodeWhere?.code?.mode === "insensitive", "code lookup is case-insensitive (codes are lowercase hex, inputs may be uppercased)");
assert(capturedCodeWhere?.code?.equals === "ARCH-A1B2C3D4", "input is trimmed before lookup");
assert(capturedCodeWhere?.referredId === null, "lookup excludes internal referred-<id> completion records");
assert(createdRows.length === 1 && createdRows[0].status === "completed" && createdRows[0].code === "referred-referred-9",
  "completion record is unique-keyed on the referred account (atomic single-use)");
assert(agentUpdates.length === 2, "exactly two credit grants (referrer + referee)");
assert(agentUpdates.every((u) => u.data.credits.increment === REFERRAL_REWARD),
  "both grants use increment of the reward (never overwrite a balance)");
assert(agentUpdates.some((u) => u.where.id === "referrer-1") && agentUpdates.some((u) => u.where.id === "referred-9"),
  "referrer AND referee are both credited");

// Case 2: unknown code
reset();
codeRow = null;
r = await applyReferralCode("referred-9", "ARCH-nope0000");
assert(r.ok === false && r.error === "invalid_code" && r.status === 404, "unknown code → invalid_code (404)");
assert(agentUpdates.length === 0, "no credits granted on invalid code");

// Case 3: self-referral by account id
reset();
r = await applyReferralCode("referrer-1", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "self_referral", "own code → self_referral");

// Case 4: self-referral by normalized email identity (gmail +alias / dots)
reset();
agents["referrer-1"] = { email: "same.person@gmail.com" };
agents["referred-9"] = { emailVerified: true, email: "sameperson+farm@gmail.com" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "self_referral", "same normalized gmail identity → self_referral (alias-farming blocked)");
assert(agentUpdates.length === 0, "no credits granted to an alias farm");

// Case 4b: distinct identities on a non-gmail domain are allowed
reset();
agents["referrer-1"] = { email: "a+x@fastmail.com" };
agents["referred-9"] = { emailVerified: true, email: "a+y@fastmail.com" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === true, "non-gmail +aliases are distinct identities (matches signup policy)");

// Case 5: unverified referee
reset();
agents["referred-9"] = { emailVerified: false, email: "bob@example.com" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "email_not_verified" && r.status === 403, "unverified email → email_not_verified (403)");

// Case 6: one referral bonus per account
reset();
alreadyRow = { id: "prior", status: "completed" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "already_referred", "second apply → already_referred");

// Case 7: per-referrer daily cap
reset();
completedCount = REFERRAL_DAILY_CAP;
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "referral_daily_cap" && r.status === 429, `referrer at ${REFERRAL_DAILY_CAP} rewarded referrals in 24h → referral_daily_cap (429)`);
assert(agentUpdates.length === 0, "no credits granted past the daily cap");

// Case 8: cap-1 still allowed
reset();
completedCount = REFERRAL_DAILY_CAP - 1;
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === true, "one under the daily cap still rewards");

// Case 9: concurrent apply race — unique violation maps to already_referred
reset();
const dup = new Error("duplicate key");
dup.code = "P2002";
createThrows = dup;
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "already_referred", "P2002 race loser → already_referred, not a 500");

// Case 10: non-P2002 transaction failure propagates (fail loud)
reset();
createThrows = new Error("connection lost");
let threw = false;
try { await applyReferralCode("referred-9", "ARCH-a1b2c3d4"); } catch { threw = true; }
assert(threw, "unexpected transaction errors propagate (no silent success)");

// Case 11: same private domain (catch-all farm) → same_domain
reset();
agents["referrer-1"] = { email: "boss@farm.example" };
agents["referred-9"] = { emailVerified: true, email: "worker1@farm.example" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "same_domain", "referrer and referee on one private domain → same_domain");
assert(agentUpdates.length === 0, "no credits on same_domain");

// Case 12: public mailbox providers are never treated as one owner
reset();
agents["referrer-1"] = { email: "alice@gmail.com" };
agents["referred-9"] = { emailVerified: true, email: "bob@gmail.com" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === true, "two different gmail users still earn the referral");

// Case 13: per-domain cap for one referrer
reset();
for (let i = 0; i < REFERRAL_DOMAIN_CAP; i++) { agents[`prev-${i}`] = { email: `p${i}@farm.example` }; rewardedIds.push(`prev-${i}`); }
agents["referred-9"] = { emailVerified: true, email: "next@farm.example" };
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "referral_domain_cap" && r.status === 429, `referrer already rewarded ${REFERRAL_DOMAIN_CAP} times from one domain → referral_domain_cap`);

// Case 14: lifetime cap
reset();
rewardedIds = Array.from({ length: REFERRAL_LIFETIME_CAP }, (_, i) => `old-${i}`);
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
assert(r.ok === false && r.error === "referral_lifetime_cap", `referrer at ${REFERRAL_LIFETIME_CAP} lifetime rewards → referral_lifetime_cap`);
assert(agentUpdates.length === 0, "no credits past the lifetime cap");

// Case 15: race — the lock-free pre-check sees room, but by the time the
// referrer row is locked another apply has filled the domain cap.
reset();
agents["referred-9"] = { emailVerified: true, email: "late@farm.example" };
for (let i = 0; i < REFERRAL_DOMAIN_CAP; i++) agents[`won-${i}`] = { email: `w${i}@farm.example` };
let findManyCalls = 0;
const realFindMany = prisma.referral.findMany;
prisma.referral.findMany = async () => (++findManyCalls === 1 ? [] : Array.from({ length: REFERRAL_DOMAIN_CAP }, (_, i) => ({ referredId: `won-${i}` })));
r = await applyReferralCode("referred-9", "ARCH-a1b2c3d4");
prisma.referral.findMany = realFindMany;
assert(r.ok === false && r.error === "referral_domain_cap", "domain cap is re-checked under the referrer lock (concurrent applies can't race past it)");
assert(createdRows.length === 0, "no completion row when the in-transaction cap check fails");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
