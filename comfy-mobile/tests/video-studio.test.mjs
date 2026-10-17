/**
 * Video Studio thumbnails: URLs, lenient payload readers for the card APIs,
 * the PIN gate (direct 8140, `credentials: 'include'`), and the store's
 * PIN replay. Plus the app-gallery permanent delete, which goes through
 * ComfyUI's history (`POST /history {"delete"}`), not Video Studio.
 * No network: fetch is stubbed per test.
 */
import './browser-stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIDEO_STUDIO_URL,
  STUDIO_AUTH,
  VideoStudioError,
  buildCardMedia,
  fetchStudioJson,
  localMediaPath,
  looksLikePinGate,
  normalizeVideoStudioUrl,
  parseCopyCards,
  parseLoraPreviews,
  parseWorkflowCards,
  studioCopyFor,
  studioLoraPreview,
  studioMediaUrl,
  studioWorkflowFor,
  unlockStudio,
  withStudioVisual,
} from '../src/core/content/videoStudio.ts';
import { useStudioMediaStore } from '../src/core/content/studioMedia.ts';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { useServerStore } from '../src/core/store/server.ts';
import { deleteOutputMessage } from '../src/shared/useDeleteOutput.ts';

const BASE = 'http://100.89.112.7:8140';
const noCounts = { loras: 0, workflows: 0, copies: 0 };

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

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

test('normalizeVideoStudioUrl: defaults to Video Studio on 8140, adds http, strips trailing slash and query', () => {
  assert.equal(normalizeVideoStudioUrl(''), DEFAULT_VIDEO_STUDIO_URL);
  assert.equal(DEFAULT_VIDEO_STUDIO_URL, 'http://100.89.112.7:8140');
  assert.equal(normalizeVideoStudioUrl('100.89.112.7:8140/'), 'http://100.89.112.7:8140');
  assert.equal(normalizeVideoStudioUrl('http://mac.local:8140?x=1#y'), 'http://mac.local:8140');
  assert.equal(normalizeVideoStudioUrl('not a url at all'), DEFAULT_VIDEO_STUDIO_URL);
});

test('studioMediaUrl: base + encoded path, nothing appended (the browser sends the cookie itself)', () => {
  assert.equal(studioMediaUrl(BASE, '/lora-previews/a b.jpg'), `${BASE}/lora-previews/a%20b.jpg`);
  assert.equal(studioMediaUrl(BASE, '/copy-previews/42.mp4'), `${BASE}/copy-previews/42.mp4`);
  assert.equal(studioMediaUrl(BASE, '/workflow-card-media/wf_7.jpg?v=2'), `${BASE}/workflow-card-media/wf_7.jpg?v=2`);
  assert.equal(studioMediaUrl(BASE, 'relative'), null);
  assert.equal(studioMediaUrl('', '/lora-previews/a.png'), null);
});

test('localMediaPath: bare names go under the dir, absolute URLs and traversal are dropped', () => {
  assert.equal(localMediaPath('a.png', '/lora-previews'), '/lora-previews/a.png');
  assert.equal(localMediaPath('/lora-previews/x.jpg', '/other'), '/lora-previews/x.jpg');
  assert.equal(localMediaPath({ url: 'wf_1.mp4' }, '/workflow-card-media'), '/workflow-card-media/wf_1.mp4');
  assert.equal(localMediaPath('https://some-model-site.example/thumbs/1.jpg', '/lora-previews'), undefined);
  assert.equal(localMediaPath('//cdn.example/1.jpg', '/x'), undefined);
  assert.equal(localMediaPath('../secret.json', '/lora-previews'), undefined);
  assert.equal(localMediaPath('a\\b.png', '/lora-previews'), undefined);
});

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------

test('parseLoraPreviews: guide-data previews and lora_cards options → /lora-previews, matched by file stem', () => {
  const previews = parseLoraPreviews(
    { previews: { 'Flux Style v2.safetensors': { file: 'flux_style_v2.jpg' }, other: 'https://some-model-site.example/x.jpg' } },
    { cards: { styles: { options: [{ file: 'cinematic_look.safetensors', preview: { url: '/lora-previews/cine.jpg' } }, { name: 'nothing' }] } } },
  );
  const media = { loraPreviews: previews, workflows: {}, copies: {}, counts: noCounts };
  assert.equal(studioLoraPreview(media, 'loras/Flux Style v2.safetensors'), '/lora-previews/flux_style_v2.jpg');
  assert.equal(studioLoraPreview(media, 'flux_style_v2'), '/lora-previews/flux_style_v2.jpg'); // by preview file name too
  assert.equal(studioLoraPreview(media, 'cinematic_look'), '/lora-previews/cine.jpg');
  assert.equal(studioLoraPreview(media, 'unknown.safetensors'), undefined);
  assert.equal(previews.other, undefined); // model-site URL ignored
});

test('parseWorkflowCards: thumb + up to 9 examples (the strip), matched by id, wf_<id> and name', () => {
  const wf = parseWorkflowCards({
    library: [
      { id: '7', name: 'Night Drive.json', card: { thumb: 'wf_7.jpg', examples: ['wf_7_1.mp4', { url: 'wf_7_2.png' }, 'wf_7.jpg', ...Array.from({ length: 12 }, (_, i) => `wf_7_x${i}.png`)] } },
      { id: '8', card: {} },
    ],
  });
  assert.equal(wf.list.length, 1);
  const media = { workflows: wf.byKey, loraPreviews: {}, copies: {}, counts: noCounts };
  const card = studioWorkflowFor(media, { id: 'wf_7', name: 'other' });
  assert.ok(card);
  assert.equal(card.thumb, '/workflow-card-media/wf_7.jpg');
  assert.equal(card.examples.length, 9);
  assert.equal(card.examples[0].kind, 'video');
  assert.equal(card.examples[0].path, '/workflow-card-media/wf_7_1.mp4');
  assert.ok(!card.examples.some((e) => e.path === card.thumb)); // the thumb is not repeated in the strip
  assert.ok(studioWorkflowFor(media, { id: 'x', name: 'night-drive' }));
  assert.equal(studioWorkflowFor(media, { id: 'x', name: 'nothing like it' }), undefined);
});

test('parseCopyCards: poster + clip under /copy-previews, matched by id and title', () => {
  const cp = parseCopyCards({ workflows: [{ id: '42', title: 'Golden Hour', preview: { poster: '42.jpg', video: '42.mp4' } }, { id: '43', title: 'No media' }] });
  assert.equal(cp.list.length, 1);
  const media = { copies: cp.byKey, loraPreviews: {}, workflows: {}, counts: noCounts };
  const copy = studioCopyFor(media, { id: 'zzz', title: 'golden hour' });
  assert.deepEqual(copy, { id: '42', title: 'Golden Hour', poster: '/copy-previews/42.jpg', video: '/copy-previews/42.mp4' });
  assert.equal(studioCopyFor(media, { id: '42', title: '' }), copy);
});

test('buildCardMedia counts what it indexed', () => {
  const media = buildCardMedia({
    guideData: { previews: { 'a.safetensors': { file: 'a.jpg' } } },
    workflowCards: { library: [{ id: '1', card: { thumb: 'wf_1.jpg' } }] },
    copyCards: { workflows: [{ id: '9', preview: { poster: '9.jpg' } }] },
  });
  assert.deepEqual(media.counts, { loras: 1, workflows: 1, copies: 1 }); // key and preview file name share one stem
});

test('withStudioVisual: studio thumb and examples first, bundle examples after, plain 8140 URLs', () => {
  const base = { thumb: 'static/thumbs/old.png', examples: [{ path: 'static/old_1.png', kind: 'image' }] };
  const v = withStudioVisual(base, { thumb: '/workflow-card-media/wf_7.jpg', examples: [{ path: '/workflow-card-media/wf_7_1.mp4', kind: 'video' }] }, BASE);
  assert.equal(v.thumbUrl, `${BASE}/workflow-card-media/wf_7.jpg`);
  assert.equal(v.examples.length, 2);
  assert.equal(v.examples[0].url, `${BASE}/workflow-card-media/wf_7_1.mp4`);
  assert.equal(v.examples[1].path, 'static/old_1.png');
  assert.equal(withStudioVisual(base, undefined, BASE), base);
});

// ---------------------------------------------------------------------------
// PIN gate (direct to 8140)
// ---------------------------------------------------------------------------

test('looksLikePinGate: 401/403, JSON "pin required", HTML PIN pages; plain data is not a gate', () => {
  assert.equal(looksLikePinGate('{"error":"pin required"}', 401), true);
  assert.equal(looksLikePinGate('{"error":"pin required"}', 200), true);
  assert.equal(looksLikePinGate('<html><body><h1>Enter PIN</h1></body></html>', 200, 'text/html'), true);
  assert.equal(looksLikePinGate('{"previews":{}}', 200), false);
  assert.equal(looksLikePinGate('<html>Welcome</html>', 200, 'text/html'), false);
});

test('fetchStudioJson: GETs 8140 with credentials: include and no custom auth header; classifies pin / not-json / http', async () => {
  const { fetchImpl, calls } = fakeFetch(({ url }) => {
    if (url.endsWith('/api/guide-data')) return { body: { previews: {} } };
    if (url.endsWith('/api/workflows/cards')) return { status: 401, body: { error: 'pin required' } };
    if (url.endsWith('/api/copies/cards')) return { body: '<html>PIN</html>', contentType: 'text/html' };
    if (url.endsWith('/config/lora_cards.json')) return { body: '<html>Other app</html>', contentType: 'text/html' };
    return { status: 500, body: { error: 'boom' } };
  });
  assert.deepEqual(await fetchStudioJson(BASE, '/api/guide-data', fetchImpl), { previews: {} });
  assert.equal(calls[0].url, `${BASE}/api/guide-data`);
  assert.equal(calls[0].credentials, 'include');
  assert.deepEqual([...calls[0].headers.keys()], ['accept']);
  await assert.rejects(fetchStudioJson(BASE, '/api/workflows/cards', fetchImpl), (e) => e instanceof VideoStudioError && e.kind === 'pin' && e.message === 'Video Studio wants your PIN.');
  await assert.rejects(fetchStudioJson(BASE, '/api/copies/cards', fetchImpl), (e) => e.kind === 'pin');
  await assert.rejects(fetchStudioJson(BASE, '/config/lora_cards.json', fetchImpl), (e) => e.kind === 'not-json' && /HTML page/.test(e.message));
  await assert.rejects(fetchStudioJson(BASE, '/api/other', fetchImpl), (e) => e.kind === 'http' && /HTTP 500/.test(e.message));
});

test('unlockStudio: POSTs {"pin"} to /pin with credentials: include; a rejection is a pin error', async () => {
  const { fetchImpl, calls } = fakeFetch(({ body }) => (body?.pin === '1234' ? { body: { ok: true } } : { status: 401, body: { error: 'pin required' } }));
  assert.equal(await unlockStudio(BASE, '1234', fetchImpl), undefined);
  assert.equal(calls[0].url, `${BASE}${STUDIO_AUTH.pinPath}`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].credentials, 'include');
  assert.equal(calls[0].headers.get('content-type'), 'application/json');
  assert.deepEqual(calls[0].body, { pin: '1234' });
  await assert.rejects(unlockStudio(BASE, '0000', fetchImpl), (e) => e.kind === 'pin' && e.message === 'Video Studio did not accept that PIN.');
  const soft = fakeFetch(() => ({ body: { ok: false } }));
  await assert.rejects(unlockStudio(BASE, '0000', soft.fetchImpl), (e) => e.kind === 'pin');
});

// ---------------------------------------------------------------------------
// Store: card thumbnails + PIN replay
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const cardsRoutes = (call) => {
  if (call.url.endsWith('/api/guide-data')) return { body: { previews: { 'a.safetensors': { file: 'a.jpg' } } } };
  if (call.url.endsWith('/config/lora_cards.json')) return { status: 404, body: { error: 'no such file' } };
  if (call.url.endsWith('/api/workflows/cards')) return { body: { library: [{ id: '1', card: { thumb: 'wf_1.jpg', examples: ['wf_1_1.png'] } }] } };
  if (call.url.endsWith('/api/copies/cards')) return { body: { workflows: [{ id: '9', title: 'Nine', preview: { poster: '9.jpg', video: '9.mp4' } }] } };
  return { status: 404, body: {} };
};

beforeEach(() => {
  globalThis.fetch = realFetch;
  useStudioMediaStore.setState({
    baseUrl: BASE,
    pin: null,
    locked: false,
    unlockError: null,
    unlocking: false,
    cards: { loraPreviews: {}, workflows: {}, copies: {}, counts: noCounts },
    cardsStatus: 'idle',
    cardsError: null,
    cardsErrorKind: null,
    cardsLoadedAt: null,
    hydrated: true,
  });
});

test('store.loadCards: the four card documents land in one index; a missing lora_cards.json is not fatal', async () => {
  const { fetchImpl, calls } = fakeFetch(cardsRoutes);
  globalThis.fetch = fetchImpl;
  assert.equal(await useStudioMediaStore.getState().loadCards(true), true);
  const s = useStudioMediaStore.getState();
  assert.equal(s.cardsStatus, 'ok');
  assert.equal(s.cardsErrorKind, null);
  assert.deepEqual(s.cards.counts, { loras: 1, workflows: 1, copies: 1 });
  assert.equal(studioLoraPreview(s.cards, 'a.safetensors'), '/lora-previews/a.jpg');
  assert.equal(studioWorkflowFor(s.cards, { id: '1', name: '' }).thumb, '/workflow-card-media/wf_1.jpg');
  assert.equal(studioCopyFor(s.cards, { id: '9', title: '' }).video, '/copy-previews/9.mp4');
  assert.deepEqual(
    calls.map((c) => c.url.slice(BASE.length)).sort(),
    ['/api/copies/cards', '/api/guide-data', '/api/workflows/cards', '/config/lora_cards.json'],
  );
  assert.ok(calls.every((c) => c.credentials === 'include' && c.method === 'GET'));
});

test('store.loadCards: "pin required" replays the stored PIN once to /pin, then the cards load', async () => {
  let cookieOk = false;
  const { fetchImpl, calls } = fakeFetch((call) => {
    if (call.url.endsWith(STUDIO_AUTH.pinPath)) {
      if (call.body?.pin === '2468') {
        cookieOk = true;
        return { body: { ok: true } };
      }
      return { status: 401, body: { error: 'pin required' } };
    }
    if (!cookieOk) return { status: 401, body: { error: 'pin required' } };
    return cardsRoutes(call);
  });
  globalThis.fetch = fetchImpl;
  useStudioMediaStore.setState({ pin: '2468' });
  assert.equal(await useStudioMediaStore.getState().loadCards(true), true);
  const s = useStudioMediaStore.getState();
  assert.equal(s.locked, false);
  assert.equal(s.cardsStatus, 'ok');
  assert.deepEqual(s.cards.counts, { loras: 1, workflows: 1, copies: 1 });
  const pinPosts = calls.filter((c) => c.url.endsWith(STUDIO_AUTH.pinPath));
  assert.equal(pinPosts.length, 1); // four concurrent 401s share one unlock
  assert.deepEqual(pinPosts[0].body, { pin: '2468' });
  // the PIN itself is only ever in the /pin body
  assert.ok(calls.filter((c) => c.body?.pin).every((c) => c.url.endsWith(STUDIO_AUTH.pinPath)));
});

test('store.loadCards: with no stored PIN the gate locks the store and reports the PIN prompt', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 401, body: { error: 'pin required' } }));
  globalThis.fetch = fetchImpl;
  assert.equal(await useStudioMediaStore.getState().loadCards(true), false);
  const s = useStudioMediaStore.getState();
  assert.equal(s.locked, true);
  assert.equal(s.cardsStatus, 'error');
  assert.equal(s.cardsErrorKind, 'pin');
  assert.equal(s.cardsError, 'Video Studio wants your PIN.');
  assert.ok(!calls.some((c) => c.url.endsWith(STUDIO_AUTH.pinPath)));
});

test('store.unlock: stores the PIN on the device, posts it to /pin and loads the cards; a wrong PIN stays locked', async () => {
  const { fetchImpl, calls } = fakeFetch((call) => {
    if (call.url.endsWith(STUDIO_AUTH.pinPath)) return call.body?.pin === '2468' ? { body: { ok: true } } : { status: 401, body: { error: 'pin required' } };
    return cardsRoutes(call);
  });
  globalThis.fetch = fetchImpl;
  assert.equal(await useStudioMediaStore.getState().unlock('0000'), false);
  assert.equal(useStudioMediaStore.getState().locked, true);
  assert.equal(useStudioMediaStore.getState().unlockError, 'Video Studio did not accept that PIN.');
  assert.equal(await useStudioMediaStore.getState().unlock(' 2468 '), true);
  await new Promise((r) => setTimeout(r, 10));
  const s = useStudioMediaStore.getState();
  assert.equal(s.pin, '2468');
  assert.equal(s.locked, false);
  assert.equal(s.cardsStatus, 'ok');
  assert.deepEqual(calls.filter((c) => c.url.endsWith(STUDIO_AUTH.pinPath)).map((c) => c.body), [{ pin: '0000' }, { pin: '2468' }]);
  useStudioMediaStore.getState().forgetPin();
  assert.equal(useStudioMediaStore.getState().pin, null);
});

test('store persists only the URL and the PIN, and migrates a v1 proxy URL back to 8140', () => {
  const opts = useStudioMediaStore.persist.getOptions();
  assert.deepEqual(Object.keys(opts.partialize(useStudioMediaStore.getState())).sort(), ['baseUrl', 'pin']);
  assert.equal(opts.migrate({ baseUrl: 'http://100.89.112.7:8152/vs', pin: '2468', session: 'tok' }, 1).baseUrl, DEFAULT_VIDEO_STUDIO_URL);
  assert.equal(opts.migrate({ baseUrl: 'http://100.89.112.7:8152/vs', pin: '2468' }, 1).pin, '2468');
  assert.equal(opts.migrate({ baseUrl: 'http://mac.local:8140' }, 1).baseUrl, 'http://mac.local:8140');
});

// ---------------------------------------------------------------------------
// App gallery: permanent delete of this app's outputs through ComfyUI
// ---------------------------------------------------------------------------

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
