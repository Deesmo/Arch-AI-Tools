/**
 * Phone-first connection model:
 *   - "connected" = /system_stats OK + socket open (or grace elapsed); it never waits for /object_info
 *   - /object_info streams in the background with byte progress and a stall deadline
 *   - connect() is idempotent (a foreground return must not start a second 30 MB download)
 *   - a failed socket does not block the HTTP path (connected + wsBlocked, polling)
 *   - the socket client gives up on a hung handshake, backs off with jitter and resumes on foreground
 */
import './browser-stubs.mjs';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { connectionTimings, useServerStore } from '../src/core/store/server.ts';
import { api, TimeoutError } from '../src/core/api/client.ts';
import { ComfyWebSocket, WS_OPEN_TIMEOUT_MS } from '../src/core/api/ws.ts';
import { cacheKey, nodeListCache } from '../src/core/connection/cache.ts';

const SERVER = 'http://10.0.0.5:8188';
const STATS = { system: { os: 'posix', comfyui_version: '0.38.0' }, devices: [] };
const OBJECT_INFO = { KSampler: { input: { required: {} }, output: [], name: 'KSampler' } };

/** Minimal WebSocket double; tests open/close it by hand. */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = this.onclose = this.onmessage = this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  close() {
    this.readyState = 3;
  }
}
globalThis.WebSocket = FakeWebSocket;
const lastWs = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

/** Deferred fetch router: each path gets a queue of handlers the test resolves. */
function routeFetch(routes) {
  const calls = [];
  globalThis.fetch = (url, init = {}) => {
    const u = String(url);
    const path = u.replace(SERVER, '');
    calls.push(path);
    const handler = routes[path.split('?')[0]];
    if (!handler) return Promise.resolve(new Response('{}', { status: 200 }));
    return handler(init, u);
  };
  return calls;
}
const jsonResponse = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const never = (init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  connectionTimings.statsTimeoutMs = 300;
  connectionTimings.wsGraceMs = 200;
  connectionTimings.nodeListStallMs = 300;
  useServerStore.getState().disconnect();
  useServerStore.setState({ objectInfo: null, systemStats: null, lastError: null, lastFailure: null, modelLists: {} });
  useSettingsStore.getState().set({ serverUrl: SERVER });
  // the server-switch subscriber kicked off a connect against whatever fetch was set; cancel it
  useServerStore.getState().disconnect();
});
afterEach(() => {
  useServerStore.getState().disconnect();
});

// ---- streamed /object_info -------------------------------------------------

test('getObjectInfo streams: progress carries Content-Length, parsing hook fires, JSON parsed', async () => {
  const body = JSON.stringify(OBJECT_INFO);
  const enc = new TextEncoder().encode(body);
  const half = Math.floor(enc.length / 2);
  routeFetch({
    '/object_info': () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(enc.slice(0, half));
              await tick(10);
              c.enqueue(enc.slice(half));
              c.close();
            },
          }),
          { status: 200, headers: { 'content-length': String(enc.length) } },
        ),
      ),
  });
  const progress = [];
  let parsing = false;
  const info = await api.getObjectInfo({ onProgress: (p) => progress.push({ ...p }), onParsing: () => (parsing = true) });
  assert.deepEqual(info, OBJECT_INFO);
  assert.ok(parsing);
  assert.equal(progress[0].received, 0);
  assert.equal(progress.at(-1).received, enc.length);
  assert.ok(progress.every((p) => p.total === enc.length));
});

test('getObjectInfo: Content-Length is ignored as a total when the body is content-encoded', async () => {
  routeFetch({ '/object_info': () => Promise.resolve(jsonResponse(OBJECT_INFO, { 'content-length': '12', 'content-encoding': 'gzip' })) });
  const progress = [];
  await api.getObjectInfo({ onProgress: (p) => progress.push(p) });
  assert.ok(progress.every((p) => p.total === null));
});

test('getObjectInfo: a body that stops mid-way is a TimeoutError naming the URL and bytes so far', async () => {
  routeFetch({
    '/object_info': () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"a":'));
              // never closes
            },
          }),
          { status: 200 },
        ),
      ),
  });
  await assert.rejects(
    api.getObjectInfo({ stallTimeoutMs: 60 }),
    (err) => err instanceof TimeoutError && err.url === `${SERVER}/object_info` && /stalled: no data for 0s after 5 B/.test(err.message),
  );
});

test('getSystemStats honours its deadline with a TimeoutError', async () => {
  routeFetch({ '/system_stats': never });
  await assert.rejects(api.getSystemStats({ timeoutMs: 40 }), (err) => err instanceof TimeoutError && /within 0s/.test(err.message) && err.url === `${SERVER}/system_stats`);
});

// ---- store: connect() ------------------------------------------------------

test('connected after /system_stats + socket open — before /object_info has even answered', async () => {
  let releaseInfo;
  const infoGate = new Promise((r) => (releaseInfo = r));
  const calls = routeFetch({
    '/system_stats': () => Promise.resolve(jsonResponse(STATS)),
    '/object_info': async () => {
      await infoGate;
      return jsonResponse(OBJECT_INFO, { 'content-length': String(JSON.stringify(OBJECT_INFO).length) });
    },
    '/queue': () => Promise.resolve(jsonResponse({ queue_running: [], queue_pending: [] })),
    '/history': () => Promise.resolve(jsonResponse({})),
  });
  const p = useServerStore.getState().connect();
  await tick();
  assert.equal(useServerStore.getState().status, 'connecting');
  assert.equal(useServerStore.getState().connectPhase, 'ws');
  lastWs().open();
  await p;
  const s = useServerStore.getState();
  assert.equal(s.status, 'connected');
  assert.equal(s.wsBlocked, false);
  assert.equal(s.systemStats.system.comfyui_version, '0.38.0');
  assert.equal(s.objectInfo, null, 'object_info must not gate connected');
  assert.equal(s.nodeList.phase, 'loading');
  assert.equal(s.nodeList.url, `${SERVER}/object_info`);
  assert.ok(calls.includes('/object_info'), 'node list download started in the background');

  releaseInfo();
  await tick(20);
  const after = useServerStore.getState();
  assert.deepEqual(after.objectInfo, OBJECT_INFO);
  assert.equal(after.nodeList.phase, 'ready');
  assert.equal(after.nodeList.fromCache, false);
  assert.ok(after.nodeList.received > 0);
});

test('connect() is idempotent while in flight — one /system_stats, one /object_info', async () => {
  const calls = routeFetch({
    '/system_stats': () => Promise.resolve(jsonResponse(STATS)),
    '/object_info': () => Promise.resolve(jsonResponse(OBJECT_INFO)),
    '/queue': () => Promise.resolve(jsonResponse({ queue_running: [], queue_pending: [] })),
    '/history': () => Promise.resolve(jsonResponse({})),
  });
  const a = useServerStore.getState().connect();
  const b = useServerStore.getState().connect();
  useServerStore.getState().resume(0); // foreground return mid-connect: must not restart
  assert.equal(a, b);
  await tick();
  lastWs().open();
  await a;
  await tick(20);
  assert.equal(calls.filter((c) => c === '/system_stats').length, 1);
  assert.equal(calls.filter((c) => c === '/object_info').length, 1);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('/system_stats deadline -> error with the exact failing URL and kind timeout; no socket opened', async () => {
  routeFetch({ '/system_stats': never });
  await useServerStore.getState().connect();
  const s = useServerStore.getState();
  assert.equal(s.status, 'error');
  assert.equal(s.lastFailure.kind, 'timeout');
  assert.equal(s.lastFailure.url, `${SERVER}/system_stats`);
  assert.match(s.lastError, /No response from http:\/\/10\.0\.0\.5:8188\/system_stats within 0s/);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('HTTP 502 and non-ComfyUI answers are reported with status', async () => {
  routeFetch({ '/system_stats': () => Promise.resolve(new Response('bad gateway', { status: 502 })) });
  await useServerStore.getState().connect();
  assert.equal(useServerStore.getState().lastFailure.kind, 'http');
  assert.equal(useServerStore.getState().lastFailure.status, 502);

  routeFetch({ '/system_stats': () => Promise.resolve(jsonResponse({ hello: 'world' })) });
  await useServerStore.getState().connect();
  assert.equal(useServerStore.getState().lastFailure.kind, 'not-comfy');
  assert.equal(useServerStore.getState().status, 'error');
});

test('socket that never opens: connected over HTTP after the grace period, wsBlocked, polling /queue', async () => {
  const calls = routeFetch({
    '/system_stats': () => Promise.resolve(jsonResponse(STATS)),
    '/object_info': () => Promise.resolve(jsonResponse(OBJECT_INFO)),
    '/queue': () => Promise.resolve(jsonResponse({ queue_running: [], queue_pending: [] })),
    '/history': () => Promise.resolve(jsonResponse({})),
  });
  const started = Date.now();
  await useServerStore.getState().connect();
  const s = useServerStore.getState();
  assert.equal(s.status, 'connected');
  assert.equal(s.wsBlocked, true);
  assert.equal(s.wsState, 'connecting');
  assert.ok(Date.now() - started >= connectionTimings.wsGraceMs - 5);
  await tick(20);
  assert.deepEqual(useServerStore.getState().objectInfo, OBJECT_INFO, 'HTTP path kept working without a socket');
  assert.ok(calls.includes('/queue'));
});

test('socket closes before opening: still connected over HTTP, client keeps retrying with backoff', async () => {
  routeFetch({
    '/system_stats': () => Promise.resolve(jsonResponse(STATS)),
    '/object_info': () => Promise.resolve(jsonResponse(OBJECT_INFO)),
  });
  const p = useServerStore.getState().connect();
  await tick();
  lastWs().fail(1006);
  await p;
  assert.equal(useServerStore.getState().status, 'connected');
  assert.equal(useServerStore.getState().wsBlocked, true);
  const d = useServerStore.getState().wsDiagnostics();
  assert.equal(d.lastCloseCode, 1006);
  assert.equal(d.lastAttemptFailedToOpen, true);
  assert.equal(d.attempts, 1);
});

test('stalled /object_info -> nodeList.error says stalled with bytes; connection stays up; retry works', async () => {
  let attempt = 0;
  routeFetch({
    '/system_stats': () => Promise.resolve(jsonResponse(STATS)),
    '/object_info': () => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{"KSampler":'));
              },
            }),
            { status: 200, headers: { 'content-length': '31451238' } },
          ),
        );
      }
      return Promise.resolve(jsonResponse(OBJECT_INFO));
    },
  });
  const p = useServerStore.getState().connect();
  await tick();
  lastWs().open();
  await p;
  await tick(connectionTimings.nodeListStallMs + 100);
  const s = useServerStore.getState();
  assert.equal(s.status, 'connected');
  assert.equal(s.nodeList.phase, 'error');
  assert.match(s.nodeList.error, /stalled: no data for 0s after 12 B/);
  assert.equal(s.nodeList.total, 31451238);
  await useServerStore.getState().loadNodeList();
  assert.equal(useServerStore.getState().nodeList.phase, 'ready');
  assert.deepEqual(useServerStore.getState().objectInfo, OBJECT_INFO);
});

test('switching servers mid-download drops the old attempt (no stale object_info lands)', async () => {
  let releaseInfo;
  routeFetch({
    '/system_stats': () => Promise.resolve(jsonResponse(STATS)),
    '/object_info': () => new Promise((r) => (releaseInfo = () => r(jsonResponse({ Old: {} })))),
  });
  const p = useServerStore.getState().connect();
  await tick();
  lastWs().open();
  await p;
  assert.equal(useServerStore.getState().nodeList.phase, 'loading');
  routeFetch({ '/system_stats': never });
  useSettingsStore.getState().set({ serverUrl: 'http://10.0.0.6:8188' });
  releaseInfo();
  await tick(20);
  assert.equal(useServerStore.getState().objectInfo, null);
  assert.equal(useServerStore.getState().nodeList.phase, 'idle');
});

test('resume(): reconnects after an error, restarts a connect that was frozen while suspended', async () => {
  routeFetch({ '/system_stats': never });
  await useServerStore.getState().connect();
  assert.equal(useServerStore.getState().status, 'error');
  routeFetch({ '/system_stats': () => Promise.resolve(jsonResponse(STATS)), '/object_info': () => Promise.resolve(jsonResponse(OBJECT_INFO)) });
  useServerStore.getState().resume(0);
  await tick();
  assert.equal(useServerStore.getState().status, 'connecting');
  lastWs().open();
  await tick(20);
  assert.equal(useServerStore.getState().status, 'connected');

  // frozen connect: stats never answers, then the phone comes back after a long suspension
  useServerStore.getState().disconnect();
  const calls = routeFetch({ '/system_stats': never });
  void useServerStore.getState().connect();
  await tick();
  useServerStore.getState().resume(60_000);
  await tick();
  assert.equal(calls.filter((c) => c === '/system_stats').length, 2, 'stale connect was restarted');
});

// ---- socket client ---------------------------------------------------------

test('backoff ladder: 0.5 s → 15 s cap with ±25 % jitter', () => {
  assert.equal(ComfyWebSocket.backoffMs(0, 0.5), 500);
  assert.equal(ComfyWebSocket.backoffMs(1, 0.5), 1000);
  assert.equal(ComfyWebSocket.backoffMs(3, 0.5), 4000);
  assert.equal(ComfyWebSocket.backoffMs(10, 0.5), 15000);
  assert.equal(ComfyWebSocket.backoffMs(10, 0), 11250);
  assert.equal(ComfyWebSocket.backoffMs(10, 1), 18750);
});

test('a handshake stuck in CONNECTING is abandoned after WS_OPEN_TIMEOUT_MS and retried; resume() skips the backoff', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const states = [];
    const ws = new ComfyWebSocket('cid', () => {}, (s) => states.push(s));
    ws.connect();
    assert.equal(FakeWebSocket.instances.length, 1);
    mock.timers.tick(WS_OPEN_TIMEOUT_MS + 1);
    assert.deepEqual(states, ['connecting', 'closed']);
    assert.equal(ws.diagnostics().lastAttemptFailedToOpen, true);
    assert.match(ws.diagnostics().lastCloseReason, /no open event within 8s/);
    // backoff pending (≤ 625 ms for the first retry) — resume() reconnects right now
    ws.resume();
    assert.equal(FakeWebSocket.instances.length, 2);
    lastWs().open();
    assert.equal(states.at(-1), 'open');
    assert.equal(ws.diagnostics().attempts, 0);
    // a long suspension cycles even an "open" socket (iOS keeps readyState OPEN on dead sockets)
    ws.resume({ suspendedMs: 60_000 });
    assert.equal(FakeWebSocket.instances.length, 3);
    ws.disconnect();
  } finally {
    mock.timers.reset();
  }
});

// ---- cache -----------------------------------------------------------------

test('cache is keyed by server URL + ComfyUI version and is a silent no-op without IndexedDB', async () => {
  assert.equal(cacheKey(SERVER, '0.38.0'), `${SERVER}|0.38.0`);
  assert.equal(cacheKey(SERVER, undefined), `${SERVER}|unknown`);
  assert.equal(typeof indexedDB, 'undefined');
  assert.equal(await nodeListCache.getObjectInfo(SERVER, '0.38.0'), null);
  await nodeListCache.putObjectInfo(SERVER, '0.38.0', OBJECT_INFO);
  await nodeListCache.clear();
});
