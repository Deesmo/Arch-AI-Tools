/**
 * Regression test for the global DoS limiter.
 *
 * Run against a local API server:
 *   TEST_BASE_URL=http://localhost:8787 npm run test:rate-limit
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8787";
const REQUESTS = Number(process.env.TEST_RATE_LIMIT_REQUESTS || 305);
const PATH = process.env.TEST_RATE_LIMIT_PATH || "/api/v1/x402/pricing";

const localTarget = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(BASE_URL);
if (!localTarget) {
  throw new Error("Refusing to run rate-limit test against a non-local TEST_BASE_URL");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const statuses = {};
  const tokenPrefix = `invalid-rate-limit-${Date.now()}`;

  for (let i = 0; i < REQUESTS; i++) {
    const res = await fetch(`${BASE_URL}${PATH}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenPrefix}-${i}`,
      },
    });
    statuses[res.status] = (statuses[res.status] || 0) + 1;
  }

  console.log(JSON.stringify({ target: `${BASE_URL}${PATH}`, requests: REQUESTS, statuses }));
  assert(statuses[429] > 0, "expected rotating invalid Bearer tokens to hit the global IP limit");
  assert((statuses[200] || 0) < REQUESTS, "all requests succeeded; global limiter was bypassed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
