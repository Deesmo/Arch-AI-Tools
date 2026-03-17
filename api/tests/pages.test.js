/**
 * Arch Tools — Page Availability Tests
 * 
 * Verifies every known page and endpoint returns expected status codes.
 * Uses native fetch (Node 18+), no external dependencies.
 * 
 * Run: node api/tests/pages.test.js
 */

const BASE_URL = process.env.TEST_BASE_URL || 'https://archtools.dev';

let passed = 0;
let failed = 0;
const failures = [];

async function testPage(path, expectedStatus = 200) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    const status = res.status;
    
    if (expectedStatus === '2xx') {
      if (status >= 200 && status < 300) {
        passed++;
        console.log(`  ✅ ${status} ${path}`);
      } else {
        throw new Error(`expected 2xx, got ${status}`);
      }
    } else if (status === expectedStatus) {
      passed++;
      console.log(`  ✅ ${status} ${path}`);
    } else {
      throw new Error(`expected ${expectedStatus}, got ${status}`);
    }
  } catch (err) {
    failed++;
    failures.push({ path, error: err.message });
    console.log(`  ❌ ${path} — ${err.message}`);
  }
}

async function run() {
  const start = Date.now();
  console.log(`\n🧪 Arch Tools Page Availability Tests`);
  console.log(`   Target: ${BASE_URL}\n`);

  // ── Public Pages (200 expected) ──
  console.log('── Public Pages ──');
  const publicPages = [
    '/',
    '/directory',
    '/fund',
    '/playground',
    '/changelog',
    '/docs',
    '/docs/getting-started',
    '/sdk',
    '/blog',
  ];
  for (const page of publicPages) {
    await testPage(page, 200);
  }

  // ── Static HTML Pages ──
  console.log('\n── Static HTML Pages ──');
  const htmlPages = [
    '/blog-x402.html',
    '/blog-x402-directory.html',
    '/docs-x402-guide.html',
    '/compare.html',
    '/integrations.html',
    '/facilitator.html',
    '/agents.html',
  ];
  for (const page of htmlPages) {
    await testPage(page, 200);
  }

  // ── Auth-Protected Pages (302 redirect expected) ──
  console.log('\n── Auth-Protected Pages (expect 302) ──');
  const authPages = [
    '/pricing',
    '/dashboard',
  ];
  for (const page of authPages) {
    await testPage(page, 302);
  }

  // ── API Endpoints ──
  console.log('\n── API Endpoints ──');
  const apiEndpoints = [
    { path: '/health', status: 200 },
    { path: '/api/v1/x402/directory', status: 200 },
    { path: '/api/v1/x402/pricing', status: 200 },
    { path: '/api/v1/agents/leaderboard', status: 200 },
    { path: '/v1/tools', status: 200 },
  ];
  for (const ep of apiEndpoints) {
    await testPage(ep.path, ep.status);
  }

  // ── Discovery Files ──
  console.log('\n── Discovery Files ──');
  const discoveryFiles = [
    '/sitemap.xml',
    '/robots.txt',
    '/llms.txt',
    '/llms-full.txt',
    '/openapi.json',
    '/tools.json',
  ];
  for (const file of discoveryFiles) {
    await testPage(file, 200);
  }

  // ── Summary ──
  const elapsed = Date.now() - start;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed + failed} pages | ✅ ${passed} passed | ❌ ${failed} failed | ⏱ ${elapsed}ms`);

  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    • ${f.path}: ${f.error}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
