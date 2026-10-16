/**
 * Connection diagnosis. Browsers surface CORS failures, dead hosts and
 * mixed-content blocking as the same `TypeError: Failed to fetch`, so the
 * classifier relies on a `no-cors` re-probe plus the page/server schemes.
 * These tests pin the mapping for a plain-http dev origin and an https origin.
 */
import { setPageOrigin } from './browser-stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { diagnoseConnection } from '../src/core/connection/diagnose.ts';

const failedToFetch = () => Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });

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

beforeEach(() => {
  setPageOrigin('http://localhost:5173');
  useSettingsStore.getState().set({ serverUrl: 'http://192.168.1.50:8188' });
});

test('runs as the web platform under Node (native guard inactive)', () => {
  assert.equal(Capacitor.isNativePlatform(), false);
});

test('ok / http-error / not-comfy from a successful fetch', async () => {
  stubFetch({ cors: okStats, noCors: okStats });
  assert.equal((await diagnoseConnection()).kind, 'ok');

  stubFetch({ cors: () => new Response('nope', { status: 503 }), noCors: okStats });
  assert.deepEqual(await diagnoseConnection(), { kind: 'http-error', serverUrl: 'http://192.168.1.50:8188', status: 503 });

  stubFetch({ cors: () => new Response('{"hello":1}', { status: 200 }), noCors: okStats });
  assert.equal((await diagnoseConnection()).kind, 'not-comfy');
});

test('http origin: host answers the no-cors probe -> CORS', async () => {
  const calls = stubFetch({ cors: failedToFetch, noCors: () => new Response(null, { status: 200 }) });
  const r = await diagnoseConnection();
  assert.equal(r.kind, 'cors');
  assert.deepEqual(calls.map((c) => c.mode), ['cors', 'no-cors']);
});

test('http origin: probe rejects too -> unreachable (never mixed-content)', async () => {
  stubFetch({ cors: failedToFetch, noCors: failedToFetch });
  const r = await diagnoseConnection();
  assert.equal(r.kind, 'unreachable');
});

test('https origin -> http server: both fetches blocked -> mixed-content', async () => {
  setPageOrigin('https://app.example.test');
  stubFetch({ cors: failedToFetch, noCors: failedToFetch });
  const r = await diagnoseConnection();
  assert.deepEqual(r, { kind: 'mixed-content', pageOrigin: 'https://app.example.test' });
});

test('https origin -> http server that the browser lets through: CORS, not mixed-content', async () => {
  // e.g. http://localhost targets are "potentially trustworthy" and never mixed content.
  setPageOrigin('https://app.example.test');
  stubFetch({ cors: failedToFetch, noCors: () => new Response(null, { status: 200 }) });
  const r = await diagnoseConnection();
  assert.equal(r.kind, 'cors');
});

test('https origin -> https server unreachable -> unreachable, not mixed-content', async () => {
  setPageOrigin('https://app.example.test');
  useSettingsStore.getState().set({ serverUrl: 'https://comfy.example.test' });
  stubFetch({ cors: failedToFetch, noCors: failedToFetch });
  const r = await diagnoseConnection();
  assert.equal(r.kind, 'unreachable');
});
