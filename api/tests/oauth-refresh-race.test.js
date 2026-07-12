/**
 * Regression test for concurrent OAuth refresh-token rotation.
 *
 * This is intentionally local-only by default because it creates an account and
 * OAuth client. Run with:
 *   TEST_BASE_URL=http://localhost:8787 npm run test:oauth-refresh-race
 */
import crypto from "node:crypto";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8787";
const target = new URL(BASE_URL);

if (!["localhost", "127.0.0.1"].includes(target.hostname) && process.env.ALLOW_MUTATING_REMOTE_TESTS !== "1") {
  throw new Error("Refusing to run mutating OAuth race test against non-local TEST_BASE_URL");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  return { res, body: await res.json().catch(() => null) };
}

function formBody(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return body;
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function run() {
  console.log("OAuth refresh race regression");
  console.log(`Target: ${BASE_URL}`);

  const email = `oauth-race-${Date.now()}-${crypto.randomUUID()}@example.com`;
  const register = await fetchJSON("/v1/agent/register", {
    method: "POST",
    body: JSON.stringify({ email, name: "OAuth Race Test" }),
  });
  assert(register.res.status === 201, `register status ${register.res.status}: ${JSON.stringify(register.body)}`);
  const apiKey = register.body?.api_key;
  assert(typeof apiKey === "string" && apiKey.startsWith("arch_"), "registration did not return API key");

  const client = await fetchJSON("/oauth/register", {
    method: "POST",
    body: JSON.stringify({
      client_name: `Race Test ${Date.now()}`,
      redirect_uris: ["http://localhost/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert(client.res.status === 201, `client register status ${client.res.status}: ${JSON.stringify(client.body)}`);
  const clientId = client.body?.client_id;
  assert(typeof clientId === "string", "client_id missing");

  const pkce = pkcePair();
  const authorizeRes = await fetch(`${BASE_URL}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: clientId,
      redirect_uri: "http://localhost/callback",
      scope: "tools:read tools:execute",
      state: "race-test",
      email,
      apiKey,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    }),
  });
  assert(authorizeRes.status === 302, `authorize status ${authorizeRes.status}: ${await authorizeRes.text()}`);
  const location = authorizeRes.headers.get("location");
  assert(location, "authorize redirect missing Location");
  const code = new URL(location).searchParams.get("code");
  assert(code, "authorize redirect missing code");

  const token = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: "http://localhost/callback",
      code,
      code_verifier: pkce.verifier,
    }),
  });
  const tokenBody = await token.json().catch(() => null);
  assert(token.status === 200, `token status ${token.status}: ${JSON.stringify(tokenBody)}`);
  const refreshToken = tokenBody?.refresh_token;
  assert(typeof refreshToken === "string", "refresh_token missing");

  async function refreshOnce() {
    const res = await fetch(`${BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: formBody({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const results = await Promise.all([refreshOnce(), refreshOnce()]);
  const winners = results.filter((result) => result.status === 200 && result.body?.refresh_token);
  const losers = results.filter((result) => result.status === 400 && result.body?.error === "invalid_grant");
  assert(winners.length === 1, `expected one refresh winner, got ${JSON.stringify(results)}`);
  assert(losers.length === 1, `expected one invalid_grant loser, got ${JSON.stringify(results)}`);

  const health = await fetchJSON("/health");
  assert(health.res.status === 200 && health.body?.ok === true, `health failed after race: ${health.res.status}`);

  console.log("PASS: concurrent refresh returns one success, one invalid_grant, and server remains healthy");
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
