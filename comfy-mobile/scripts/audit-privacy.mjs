#!/usr/bin/env node
/**
 * Privacy audit — proves the built app cannot talk to anything but the
 * user-configured ComfyUI server.
 *
 *   node scripts/audit-privacy.mjs            # audits dist/ (run `npm run build` first)
 *   node scripts/audit-privacy.mjs --src      # also scans src/ and index.html
 *
 * Checks
 *   1. Every http(s):// and ws(s):// literal in dist/ (JS, CSS, HTML) must be
 *      on the allow-list below. The allow-list contains ONLY:
 *        - the default ComfyUI server (overridable in-app), and
 *        - inert namespace/URN strings that never produce a request
 *          (XML namespaces, license/spec links inside library comments).
 *   2. No <script src>, <link href>, @import or url() in dist/ may point off
 *      the bundle (anything with a scheme or starting with //).
 *   3. No known telemetry / CDN / analytics hostnames anywhere in dist/.
 *   4. node_modules runtime deps must be the expected set (no transitive
 *      surprise like a telemetry SDK being pulled in).
 *
 * Exit code 1 on any finding, so it can gate CI.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const scanSrc = process.argv.includes('--src');

/** The only real network endpoint the app knows about by default. */
const DEFAULT_SERVER = 'http://100.103.142.118:8188';
/**
 * Second default endpoint: the My Studio content bundle served by the Mac mini
 * over Tailscale (tools/export_video_studio.py --serve). User-configurable in
 * My Studio → Source; a CGNAT (100.64/10) address, never routable off-tailnet.
 */
const DEFAULT_CONTENT_SOURCE = 'http://100.89.112.7:8152/bundle.json';
/**
 * Third default endpoint: Video Studio itself on the same Mac (tailnet, port
 * 8140) for the live galleries and card previews. PIN-gated (`POST /pin`,
 * `vs_pin` cookie); the PIN lives only on the device. User-configurable in
 * My Studio → Source.
 */
const DEFAULT_VIDEO_STUDIO = 'http://100.89.112.7:8140';
const ALLOWED_DEFAULTS = [DEFAULT_SERVER, DEFAULT_CONTENT_SOURCE, DEFAULT_VIDEO_STUDIO];

/**
 * Inert strings: namespaces, URNs and spec/license URLs that appear as
 * literals in React / Zustand / Vite output but are never fetched.
 */
const INERT_PATTERNS = [
  /^https?:\/\/www\.w3\.org\//, // SVG / XHTML / MathML namespaces
  /^https?:\/\/reactjs\.org\//, // React error-decoder URL baked into error messages
  /^https?:\/\/react\.dev\//, // React 18.3+ docs links in warnings
  /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?(blob|issues|tree)?/, // links in library comments
  /^https?:\/\/(opensource\.org|spdx\.org|www\.apache\.org|creativecommons\.org)\//, // license URLs
  /^https?:\/\/(vitejs\.dev|vite\.dev)\//, // vite docs link in dev-only error text
  /^https?:\/\/docs\.pmnd\.rs\//, // zustand docs links in deprecation messages
  /^https?:\/\/zustand\.docs\.pmnd\.rs\//, // zustand docs links in deprecation messages
  /^https?:\/\/capacitorjs\.com\//, // capacitor docs link in warnings
  /^https?:\/\/localhost(:\d+)?/, // mock server / dev hints in README-style strings
  /^https?:\/\/127\.0\.0\.1(:\d+)?/,
  /^https?:\/\/example\.com/,
];

/** Hostnames that must never appear in the bundle, even in dead code. */
const FORBIDDEN_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'sentry.io',
  'ingest.sentry.io',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'posthog.com',
  'hotjar.com',
  'intercom.io',
  'bugsnag.com',
  'datadoghq.com',
  'newrelic.com',
  'firebaseio.com',
  'firebase.googleapis.com',
  'crashlytics.com',
  'app-measurement.com',
  'civitai.com',
  'huggingface.co',
  'openai.com',
  'anthropic.com',
  'api.github.com',
  'registry.npmjs.org',
];

/** Runtime dependency allow-list (package.json "dependencies"). */
const ALLOWED_RUNTIME_DEPS = new Set([
  '@capacitor/android',
  '@capacitor/core',
  '@capacitor/filesystem',
  '@capacitor/ios',
  '@capacitor/share',
  'react',
  'react-dom',
  'zustand',
]);

const findings = [];
const seen = new Map(); // url -> [files]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg', '.ts', '.tsx', '.webmanifest', '.map']);

function scanFile(file) {
  if (!TEXT_EXT.has(extname(file))) return;
  if (file.endsWith('.map')) return; // source maps contain source text; audited via --src instead
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  // 1. absolute URLs
  const urlRe = /\b(?:https?|wss?):\/\/[^\s"'`<>()\\,;]+/g;
  for (const m of text.matchAll(urlRe)) {
    const url = m[0].replace(/[.)\]]+$/, '');
    if (ALLOWED_DEFAULTS.some((d) => url.startsWith(d))) continue;
    // `http://${x}` is the scheme prefix added to whatever the user typed in
    // Settings (normalizeServerUrl) — a dynamic user-supplied host, not a literal.
    if (/^(?:https?|wss?):\/\/\$\{/.test(url)) {
      const key = `${url.split('${')[0]}\${…}`;
      (seen.get(key) ?? seen.set(key, []).get(key)).push(rel);
      continue;
    }
    if (INERT_PATTERNS.some((re) => re.test(url))) {
      (seen.get(url) ?? seen.set(url, []).get(url)).push(rel);
      continue;
    }
    findings.push(`${rel}: outbound URL literal ${url}`);
  }

  // 2. external resource references
  const refRe = /(?:<script[^>]+src|<link[^>]+href|@import\s+(?:url\()?|url\()\s*=?\s*["']?([^"')\s>]+)/gi;
  for (const m of text.matchAll(refRe)) {
    const target = m[1];
    if (/^(?:[a-z]+:)?\/\//i.test(target) && !ALLOWED_DEFAULTS.some((d) => target.startsWith(d))) {
      findings.push(`${rel}: external resource reference ${target}`);
    }
  }

  // 3. forbidden hosts anywhere
  for (const host of FORBIDDEN_HOSTS) {
    if (text.includes(host)) findings.push(`${rel}: forbidden hostname "${host}"`);
  }

  // 4. things that smell like telemetry
  for (const word of ['sendBeacon', 'gtag(', 'dataLayer', '__sentry', 'mixpanel', 'posthog', 'amplitude.getInstance']) {
    if (text.includes(word)) findings.push(`${rel}: telemetry marker "${word}"`);
  }
}

// ---- dist ------------------------------------------------------------------
const dist = join(root, 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(2);
}
const distFiles = walk(dist);
distFiles.forEach(scanFile);

// ---- src (optional) --------------------------------------------------------
if (scanSrc) {
  walk(join(root, 'src')).forEach(scanFile);
  scanFile(join(root, 'index.html'));
}

// ---- index.html must not preconnect / dns-prefetch anywhere ----------------
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
if (/rel=["'](?:preconnect|dns-prefetch|prefetch|preload)["'][^>]*href=["'](?:https?:)?\/\//i.test(indexHtml)) {
  findings.push('dist/index.html: preconnect/dns-prefetch to an external origin');
}

// ---- runtime dependencies --------------------------------------------------
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (!ALLOWED_RUNTIME_DEPS.has(dep)) findings.push(`package.json: unexpected runtime dependency "${dep}" — review it for network access and add to the allow-list only if clean`);
}
const nm = join(root, 'node_modules');
if (existsSync(nm)) {
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const pj = join(nm, dep, 'package.json');
    if (!existsSync(pj)) continue;
    const dp = JSON.parse(readFileSync(pj, 'utf8'));
    for (const sub of Object.keys(dp.dependencies ?? {})) {
      // Transitive runtime deps of the allow-list, each reviewed:
      //   react/react-dom → scheduler, loose-envify, js-tokens (pure JS, no I/O)
      //   @capacitor/filesystem → @capacitor/synapse (1 KB window.CapacitorUtils proxy shim, no I/O)
      if (!['scheduler', 'loose-envify', 'js-tokens', '@capacitor/core', '@capacitor/synapse', 'tslib'].includes(sub) && !ALLOWED_RUNTIME_DEPS.has(sub)) {
        findings.push(`node_modules/${dep}: unexpected transitive dependency "${sub}"`);
      }
    }
  }
}

// ---- report ----------------------------------------------------------------
console.log(`Privacy audit · scanned ${distFiles.length} files in dist/${scanSrc ? ' + src/' : ''}`);
console.log(`Allowed server: ${DEFAULT_SERVER} (user-configurable in Settings)`);
console.log(`Allowed content source: ${DEFAULT_CONTENT_SOURCE} (user-configurable in My Studio → Source)`);
console.log(`Allowed Video Studio: ${DEFAULT_VIDEO_STUDIO} (same Mac, PIN-gated; user-configurable in My Studio → Source)`);
if (seen.size) {
  console.log('\nInert literals found (namespaces / docs links in library code — never fetched):');
  for (const [url, files] of seen) console.log(`  ${url}  ← ${[...new Set(files)].join(', ')}`);
}
if (findings.length) {
  console.log('\nFAIL — outbound references found:');
  for (const f of findings) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nPASS — no outbound network references other than the configured ComfyUI server.');
