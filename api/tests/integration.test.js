/**
 * Arch Tools — API Integration Tests
 * 
 * Tests critical API endpoints against the live site.
 * Uses native fetch (Node 18+), no external dependencies.
 * 
 * Run: node api/tests/integration.test.js
 */

const BASE_URL = process.env.TEST_BASE_URL || 'https://archtools.dev';
// Detailed /health is admin-gated by design (see SECURITY.md). Provide a matching
// admin key here to also validate the rich health payload (deps + tool count).
const ADMIN_KEY = process.env.TEST_ADMIN_KEY || '';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The suite runs against the LIVE site, which is often mid-deploy when CI
// fires (Render swaps instances → a few seconds of 502/503/504 at the edge).
// A transient gateway error is NOT a product failure, so retry it a few times
// with backoff before letting the assertion see it. Real 4xx/5xx from the app
// pass straight through.
const TRANSIENT = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, options = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, options);
      if (!TRANSIENT.has(res.status) || i === tries - 1) return res;
      last = res;
    } catch (e) {
      last = e;
      if (i === tries - 1) throw e;
    }
    await sleep(2000 * (i + 1)); // 2s, 4s, 6s
  }
  return last;
}

async function fetchJSON(path, options = {}) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Accept': 'application/json', ...options.headers },
  });
  return { res, body: await res.json().catch(() => null) };
}

async function fetchRaw(path, options = {}) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, options);
  return { res, text: await res.text() };
}

// ─── Test Suites ──────────────────────────────────────────

async function run() {
  const start = Date.now();
  console.log(`\n🧪 Arch Tools Integration Tests`);
  console.log(`   Target: ${BASE_URL}\n`);

  // ── Health ──
  console.log('── Health ──');
  
  await test('GET /health → 200 (public minimal contract)', async () => {
    const { res, body } = await fetchJSON('/health');
    assert(res.status === 200, `status ${res.status}`);
    assert(body && body.ok === true, 'ok is not true');
  });

  await test('GET /health (admin) → detailed deps + tools count', async () => {
    if (!ADMIN_KEY) {
      console.log('     ↳ skipped (set TEST_ADMIN_KEY to validate detailed health)');
      return;
    }
    const { res, body } = await fetchJSON('/health', { headers: { 'x-admin-key': ADMIN_KEY } });
    assert(res.status === 200, `status ${res.status}`);
    assert(body.ok === true, 'ok is not true');
    assert(typeof body.tools === 'number' && body.tools > 0, `tools count missing or zero: ${body.tools}`);
    assert(typeof body.uptime_seconds === 'number', 'uptime_seconds missing');
    assert(body.dependencies?.database?.status === 'connected', 'database not connected');
  });

  // ── x402 Directory & Pricing ──
  console.log('\n── x402 ──');

  await test('GET /api/v1/x402/directory → 200 with services', async () => {
    const { res, body } = await fetchJSON('/api/v1/x402/directory');
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(body.services), 'services is not an array');
    assert(body.services.length > 0, 'services array is empty');
  });

  await test('GET /api/v1/x402/pricing → 200 with tools', async () => {
    const { res, body } = await fetchJSON('/api/v1/x402/pricing');
    assert(res.status === 200, `status ${res.status}`);
    assert(body.tools || body.pricing || body.tiers, 'no tools/pricing/tiers in response');
  });

  // ── Agents ──
  console.log('\n── Agents ──');

  await test('GET /api/v1/agents/leaderboard → 200', async () => {
    const { res, body } = await fetchJSON('/api/v1/agents/leaderboard');
    assert(res.status === 200, `status ${res.status}`);
    assert(body !== null, 'empty response body');
  });

  // ── Tools Discovery ──
  console.log('\n── Discovery ──');

  await test('GET /v1/tools → 200 with tools array', async () => {
    const { res, body } = await fetchJSON('/v1/tools');
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(body.tools) || Array.isArray(body), 'no tools array in response');
  });

  await test('POST /v1/tools/search-web (no auth) → 402 x402 challenge (v2 spec shape)', async () => {
    const { res, body } = await fetchJSON('/v1/tools/search-web', { method: 'POST' });
    assert(res.status === 402, `expected 402, got ${res.status}`);
    // Runs against live prod. x402Version 1 is tolerated ONLY because prod still
    // serves v1 402s until the v2 seller migration (PR #87) deploys; the strict v2
    // shape checks below run only when the live 402 is already v2 — they do NOT yet
    // pin the wire format against a v1 regression.
    // FOLLOW-UP (tracked in PR #87 hardening notes): once the v2 deploy is verified
    // live, delete the `=== 1` tolerance so CI pins `body.x402Version === 2`.
    assert(body.x402Version === 2 || body.x402Version === 1, `x402Version missing or wrong: ${body.x402Version}`);
    assert(Array.isArray(body.accepts) && body.accepts.length > 0, 'accepts array missing/empty');
    if (body.x402Version === 2) {
      // Spec §5.1 (coinbase/x402 specs/x402-specification-v2.md): required
      // resource object + CAIP-2 networks + `amount` on every accepts entry.
      assert(typeof body.resource === 'object' && typeof body.resource.url === 'string' && body.resource.url.includes('/v1/tools/search-web'),
        `v2 resource object missing/wrong: ${JSON.stringify(body.resource)}`);
      for (const a of body.accepts) {
        assert(typeof a.network === 'string' && a.network.includes(':'), `accepts network not CAIP-2: ${a.network}`);
        assert(typeof a.amount === 'string' && a.amount.length > 0, `accepts amount missing: ${JSON.stringify(a)}`);
        assert(a.maxAmountRequired === undefined, 'v1 maxAmountRequired leaked into v2 accepts entry');
        assert(typeof a.payTo === 'string' && typeof a.asset === 'string', 'accepts payTo/asset missing');
      }
      assert(body.accepts.some((a) => a.network === 'eip155:8453'), 'Base mainnet (eip155:8453) missing from accepts');
    }
  });

  // ── SEO / Discovery Files ──
  console.log('\n── SEO & Discovery ──');

  await test('GET /sitemap.xml → 200 with XML', async () => {
    const { res, text } = await fetchRaw('/sitemap.xml');
    assert(res.status === 200, `status ${res.status}`);
    assert(text.includes('<urlset') || text.includes('<ns0:urlset'), 'not valid sitemap XML');
    assert(text.includes('archtools.dev'), 'sitemap missing archtools.dev URLs');
  });

  await test('GET /robots.txt → 200 with rules', async () => {
    const { res, text } = await fetchRaw('/robots.txt');
    assert(res.status === 200, `status ${res.status}`);
    assert(text.includes('User-agent:'), 'no User-agent rules');
    assert(text.includes('Sitemap:'), 'no Sitemap reference');
  });

  await test('GET /llms.txt → 200', async () => {
    const { res, text } = await fetchRaw('/llms.txt');
    assert(res.status === 200, `status ${res.status}`);
    assert(text.length > 50, 'llms.txt too short');
  });

  await test('GET /llms-full.txt → 200', async () => {
    const { res, text } = await fetchRaw('/llms-full.txt');
    assert(res.status === 200, `status ${res.status}`);
    assert(text.length > 100, 'llms-full.txt too short');
  });

  await test('GET /openapi.json → 200 with valid schema', async () => {
    const { res, body } = await fetchJSON('/openapi.json');
    assert(res.status === 200, `status ${res.status}`);
    assert(body.openapi || body.swagger, 'not a valid OpenAPI doc');
    assert(body.paths || body.info, 'missing paths or info');
  });

  await test('GET /tools.json → 200', async () => {
    const { res, body } = await fetchJSON('/tools.json');
    assert(res.status === 200, `status ${res.status}`);
    assert(body !== null, 'empty response');
  });

  // ── Summary ──
  const elapsed = Date.now() - start;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed + failed} tests | ✅ ${passed} passed | ❌ ${failed} failed | ⏱ ${elapsed}ms`);

  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    • ${f.name}: ${f.error}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
