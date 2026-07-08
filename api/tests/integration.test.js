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
const IS_LOCAL_TARGET = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(BASE_URL);

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

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Accept': 'application/json', ...options.headers },
  });
  return { res, body: await res.json().catch(() => null) };
}

async function fetchRaw(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
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

  // ── Workflows ──
  console.log('\n── Workflows ──');

  await test('POST /v1/workflows/run malformed step → 400 without crashing', async () => {
    if (!IS_LOCAL_TARGET) {
      console.log('     ↳ skipped (mutating regression test only runs against local target)');
      return;
    }

    const email = `workflow-malformed-${Date.now()}@example.com`;
    const { res: registerRes, body: registerBody } = await fetchJSON('/v1/agent/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Workflow regression test' }),
    });
    assert(registerRes.status === 201, `register status ${registerRes.status}`);
    assert(registerBody?.api_key, 'registration did not return api_key');

    const { res: workflowRes, body: workflowBody } = await fetchJSON('/v1/workflows/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${registerBody.api_key}`,
      },
      body: JSON.stringify({ steps: [{ tool: 'generate-hash', input: null }] }),
    });
    assert(workflowRes.status === 400, `expected 400, got ${workflowRes.status}`);
    assert(workflowBody?.error === 'invalid_request', `unexpected error ${workflowBody?.error}`);

    const { res: healthRes, body: healthBody } = await fetchJSON('/health');
    assert(healthRes.status === 200, `health status ${healthRes.status}`);
    assert(healthBody?.ok === true, 'server did not remain healthy after malformed workflow');
  });

  // ── Tools Discovery ──
  console.log('\n── Discovery ──');

  await test('GET /v1/tools → 200 with tools array', async () => {
    const { res, body } = await fetchJSON('/v1/tools');
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(body.tools) || Array.isArray(body), 'no tools array in response');
  });

  await test('POST /v1/tools/search-web (no auth) → 402 with x402Version', async () => {
    const { res, body } = await fetchJSON('/v1/tools/search-web', { method: 'POST' });
    assert(res.status === 402, `expected 402, got ${res.status}`);
    assert(body.x402Version === 1, `x402Version missing or wrong: ${body.x402Version}`);
    assert(body.error === 'PAYMENT-REQUIRED', `error field: ${body.error}`);
    assert(Array.isArray(body.accepts), 'accepts array missing');
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
