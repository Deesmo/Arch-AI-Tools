/**
 * Connection diagnosis. Browsers surface CORS failures, dead hosts and
 * mixed-content blocking as the same `TypeError: Failed to fetch`, so the
 * classifier relies on a `no-cors` re-probe plus the page/server schemes.
 * When HTTP works it goes on to probe the WebSocket and to classify the
 * `/object_info` download (slow vs stalled). These tests pin the mapping for
 * a plain-http dev origin and an https origin, and the copyable report.
 */
import { setPageOrigin } from './browser-stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { useServerStore } from '../src/core/store/server.ts';
import { buildConnectionReport, classifyNodeList, diagnoseConnection, formatConnectionReport, problemFix, problemTitle } from '../src/core/connection/diagnose.ts';

const failedToFetch = () => Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
const SERVER = 'http://192.168.1.50:8188';
const STATS = `${SERVER}/system_stats`;
const wsOpen = async () => ({ outcome: 'open' });

/** fetch stub: `cors` answers the normal request, `noCors` answers the probe. */
function stubFetch({ cors, noCors }) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), mode: init.mode ?? 'cors' });
    const handler = init.mode === 'no-cors' ? noCors : cors;
    const out = await handler();
    if (out instanceof Error) throw out;
    return out;
  };
  return calls;
}

const okStats = () => new Response(JSON.stringify({ system: { os: 'posix' } }), { status: 200, headers: { 'content-type': 'application/json' } });

const idleNodeList = () => ({ phase: 'idle', received: 0, total: null, startedAt: null, updatedAt: null, finishedAt: null, fromCache: false, cachedAt: null, error: null, url: null });

beforeEach(() => {
  setPageOrigin('http://localhost:5173');
  useSettingsStore.getState().set({ serverUrl: SERVER });
  useServerStore.setState({ nodeList: idleNodeList() });
});

test('runs as the web platform under Node (native guard inactive)', () => {
  assert.equal(Capacitor.isNativePlatform(), false);
});

test('ok / http-error / not-comfy from a successful fetch (socket probe injected)', async () => {
  stubFetch({ cors: okStats, noCors: okStats });
  assert.equal((await diagnoseConnection({ wsProbe: wsOpen, nodeList: null })).kind, 'ok');

  stubFetch({ cors: () => new Response('nope', { status: 503 }), noCors: okStats });
  assert.deepEqual(await diagnoseConnection({ wsProbe: wsOpen }), { kind: 'http-error', serverUrl: SERVER, status: 503, url: STATS });

  stubFetch({ cors: () => new Response('{"hello":1}', { status: 200 }), noCors: okStats });
  assert.equal((await diagnoseConnection({ wsProbe: wsOpen })).kind, 'not-comfy');
});

test('http origin: host answers the no-cors probe -> CORS, with the tested URL', async () => {
  const calls = stubFetch({ cors: failedToFetch, noCors: () => new Response(null, { status: 200 }) });
  const r = await diagnoseConnection({ wsProbe: wsOpen });
  assert.deepEqual(r, { kind: 'cors', serverUrl: SERVER, url: STATS });
  assert.deepEqual(calls.map((c) => c.mode), ['cors', 'no-cors']);
});

test('http origin: probe rejects too -> unreachable (never mixed-content)', async () => {
  stubFetch({ cors: failedToFetch, noCors: failedToFetch });
  const r = await diagnoseConnection({ wsProbe: wsOpen });
  assert.equal(r.kind, 'unreachable');
  assert.equal(r.url, STATS);
});

test('deadline exceeded -> unreachable with the timeout in the detail', async () => {
  globalThis.fetch = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const r = await diagnoseConnection({ timeoutMs: 50, wsProbe: wsOpen });
  assert.equal(r.kind, 'unreachable');
  assert.match(r.detail, /within 0\.05s/);
});

test('https origin -> http server: both fetches blocked -> mixed-content', async () => {
  setPageOrigin('https://app.example.test');
  stubFetch({ cors: failedToFetch, noCors: failedToFetch });
  const r = await diagnoseConnection({ wsProbe: wsOpen });
  assert.deepEqual(r, { kind: 'mixed-content', pageOrigin: 'https://app.example.test', url: STATS });
});

test('https origin -> http server that the browser lets through: CORS, not mixed-content', async () => {
  // e.g. http://localhost targets are "potentially trustworthy" and never mixed content.
  setPageOrigin('https://app.example.test');
  stubFetch({ cors: failedToFetch, noCors: () => new Response(null, { status: 200 }) });
  const r = await diagnoseConnection({ wsProbe: wsOpen });
  assert.equal(r.kind, 'cors');
});

test('https origin -> https server unreachable -> unreachable, not mixed-content', async () => {
  setPageOrigin('https://app.example.test');
  useSettingsStore.getState().set({ serverUrl: 'https://comfy.example.test' });
  stubFetch({ cors: failedToFetch, noCors: failedToFetch });
  const r = await diagnoseConnection({ wsProbe: wsOpen });
  assert.equal(r.kind, 'unreachable');
});

test('HTTP fine but the socket never opens -> ws-blocked with the ws:// URL', async () => {
  stubFetch({ cors: okStats, noCors: okStats });
  const seen = [];
  const r = await diagnoseConnection({
    wsProbe: async (url) => {
      seen.push(url);
      return { outcome: 'timeout' };
    },
  });
  assert.equal(r.kind, 'ws-blocked');
  assert.match(r.url, /^ws:\/\/192\.168\.1\.50:8188\/ws\?clientId=/);
  assert.deepEqual(seen, [r.url]);
  assert.match(r.detail, /no open event/);

  const r2 = await diagnoseConnection({ wsProbe: async () => ({ outcome: 'error', code: 1006, reason: '' }) });
  assert.equal(r2.kind, 'ws-blocked');
  assert.match(r2.detail, /1006/);
  assert.match(problemFix(r2), /still works over HTTP/);
});

test('probeWs:false skips the socket probe', async () => {
  stubFetch({ cors: okStats, noCors: okStats });
  const r = await diagnoseConnection({ probeWs: false, wsProbe: async () => { throw new Error('must not run'); }, nodeList: null });
  assert.equal(r.kind, 'ok');
});

test('node list: slow when bytes trickle, stalled when the download died, nothing when fine', () => {
  const now = 100_000;
  const base = { ...idleNodeList(), url: `${SERVER}/object_info` };
  // 2 MB of 30 MB after 20 s -> ~100 KB/s -> >10 s remaining -> slow
  const slow = classifyNodeList(SERVER, { ...base, phase: 'loading', startedAt: now - 20_000, updatedAt: now, received: 2 * 1024 * 1024, total: 30 * 1024 * 1024 }, now);
  assert.equal(slow.kind, 'slow');
  assert.equal(slow.url, `${SERVER}/object_info`);
  assert.match(problemFix(slow), /2\.0 MB of 30 MB/);
  assert.match(problemFix(slow), /--enable-compress-response-body/);
  assert.match(problemTitle(slow), /downloading slowly/);
  // Nearly done at a healthy rate -> not worth flagging
  const fine = classifyNodeList(SERVER, { ...base, phase: 'loading', startedAt: now - 6_000, updatedAt: now, received: 29 * 1024 * 1024, total: 30 * 1024 * 1024 }, now);
  assert.equal(fine, null);
  // First seconds are never "slow"
  const early = classifyNodeList(SERVER, { ...base, phase: 'loading', startedAt: now - 2_000, updatedAt: now, received: 10, total: 30 * 1024 * 1024 }, now);
  assert.equal(early, null);
  // Stall error from the streamed fetch
  const stalled = classifyNodeList(SERVER, { ...base, phase: 'error', received: 5 * 1024 * 1024, error: `${SERVER}/object_info stalled: no data for 30s after 5.0 MB` }, now);
  assert.equal(stalled.kind, 'stalled');
  assert.equal(stalled.received, 5 * 1024 * 1024);
  // Other errors are not "stalled"
  assert.equal(classifyNodeList(SERVER, { ...base, phase: 'error', error: 'GET /object_info failed (500)' }, now), null);
  assert.equal(classifyNodeList(SERVER, { ...base, phase: 'ready' }, now), null);
});

test('diagnosis falls through to the store node-list state when HTTP and WS are fine', async () => {
  stubFetch({ cors: okStats, noCors: okStats });
  const now = Date.now();
  useServerStore.setState({ nodeList: { ...idleNodeList(), phase: 'loading', url: `${SERVER}/object_info`, startedAt: now - 30_000, updatedAt: now, received: 1024 * 1024, total: 40 * 1024 * 1024 } });
  const r = await diagnoseConnection({ wsProbe: wsOpen });
  assert.equal(r.kind, 'slow');
});

test('connection report names the failing request, status, socket and node-list state', () => {
  useServerStore.setState({
    status: 'error',
    connectPhase: null,
    connectStartedAt: Date.now() - 12_500,
    lastError: 'No response from http://192.168.1.50:8188/system_stats within 12s',
    lastFailure: { url: STATS, status: null, kind: 'timeout', message: 'No response from http://192.168.1.50:8188/system_stats within 12s', at: Date.now() },
    wsBlocked: false,
    nodeList: { ...idleNodeList(), phase: 'error', url: `${SERVER}/object_info`, received: 3 * 1024 * 1024, total: 31 * 1024 * 1024, startedAt: Date.now() - 40_000, finishedAt: Date.now(), error: 'stalled: no data for 30s after 3.0 MB' },
  });
  const report = buildConnectionReport({ kind: 'unreachable', serverUrl: SERVER, url: STATS, detail: 'No response within 6s' });
  const text = formatConnectionReport(report);
  assert.match(text, /^Comfy Mobile connection report/);
  assert.match(text, /server: http:\/\/192\.168\.1\.50:8188/);
  assert.match(text, /status: error/);
  assert.match(text, /diagnosis: unreachable — Server unreachable/);
  assert.match(text, new RegExp(`tested: ${STATS.replace(/[.]/g, '\\.')}`));
  assert.match(text, /failed request: timeout http:\/\/192\.168\.1\.50:8188\/system_stats — No response/);
  assert.match(text, /node list \(\/object_info\): error · 3\.0 MB \/ 31 MB in 40\.0s/);
  assert.match(text, /error: stalled: no data for 30s after 3\.0 MB/);
  assert.match(text, /websocket: not attempted · ws:\/\/192\.168\.1\.50:8188\/ws\?clientId=/);
  // http-error carries the status into the report
  const t2 = formatConnectionReport(buildConnectionReport({ kind: 'http-error', serverUrl: SERVER, url: STATS, status: 502 }));
  assert.match(t2, /http status: 502/);
});
