/**
 * App gallery: permanent delete of this app's outputs through ComfyUI
 * (`POST /history {"delete"}`). Video Studio's libraries are not involved.
 * No network: fetch is stubbed per test.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { useServerStore } from '../src/core/store/server.ts';
import { deleteOutputMessage } from '../src/shared/useDeleteOutput.ts';

/** A fetch stub that answers from a routing function and records calls. */
function fakeFetch(route) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    const call = { url, method: init.method ?? 'GET', headers, credentials: init.credentials, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = route(call);
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status ?? 200, headers: { 'content-type': r.contentType ?? 'application/json' } });
  };
  return { fetchImpl, calls };
}

const COMFY = 'http://127.0.0.1:1';
const historyEntry = (n) => ({
  prompt: [n, `p${n}`, {}, {}, []],
  outputs: { 9: { images: [{ filename: `out_${n}.png`, subfolder: '', type: 'output' }] } },
  status: { status_str: 'success', completed: true, messages: [] },
});

test('deleteRun: POST /history {"delete":[id]} on ComfyUI, then the run leaves the local history', async () => {
  useSettingsStore.getState().set({ serverUrl: COMFY });
  const server = { history: { p1: historyEntry(1), p2: historyEntry(2) } };
  const { fetchImpl, calls } = fakeFetch(({ url, method, body }) => {
    if (url.startsWith(`${COMFY}/history`) && method === 'POST') {
      for (const id of body.delete) delete server.history[id];
      return { body: {} };
    }
    if (url.startsWith(`${COMFY}/history`)) return { body: server.history };
    return { status: 404, body: {} };
  });
  globalThis.fetch = fetchImpl;
  useServerStore.setState({ history: { ...server.history } });
  assert.deepEqual(await useServerStore.getState().deleteRun('p1'), { ok: true });
  const del = calls.find((c) => c.method === 'POST');
  assert.equal(del.url, `${COMFY}/history`);
  assert.deepEqual(del.body, { delete: ['p1'] });
  assert.deepEqual(Object.keys(useServerStore.getState().history), ['p2']);
  assert.deepEqual(Object.keys(server.history), ['p2']);
});

test('deleteRun: a server failure keeps the run and returns the error text', async () => {
  useSettingsStore.getState().set({ serverUrl: COMFY });
  const { fetchImpl } = fakeFetch(({ method }) => (method === 'POST' ? { status: 500, body: 'history is read-only', contentType: 'text/plain' } : { body: { p1: historyEntry(1) } }));
  globalThis.fetch = fetchImpl;
  useServerStore.setState({ history: { p1: historyEntry(1) } });
  const res = await useServerStore.getState().deleteRun('p1');
  assert.equal(res.ok, false);
  assert.match(res.error, /500|read-only/);
  assert.deepEqual(Object.keys(useServerStore.getState().history), ['p1']);
});

test('deleteOutputMessage: names the run, counts its outputs, and says the bytes stay on the server', () => {
  const one = deleteOutputMessage(1, 12);
  assert.match(one, /^This removes run #12 and its output from ComfyUI's history/);
  assert.match(one, /no API that deletes the file itself/);
  assert.match(deleteOutputMessage(3, undefined), /^This removes this run and all 3 of its outputs/);
});
