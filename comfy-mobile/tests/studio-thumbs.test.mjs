/**
 * Same-origin My Studio pictures: `/studio-thumbs/index.json` only.
 * No network. fetch is stubbed.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSING_PICTURES,
  cardImage,
  cardMeta,
  copyExtras,
  copyMainClip,
  loadStudioThumbs,
  parseStudioThumbIndex,
  studioThumbUrl,
} from '../src/core/content/studioThumbs.ts';

const sample = {
  loras: [
    { name: 'Flux Style', file: 'loras/Flux Style.safetensors', thumb: 'loras/flux style.jpg', trigger: 'fluxstyle', rating: 4.5, favorite: true, model: 'Flux' },
    { name: 'Dropped', file: 'x.safetensors', thumb: 'https://some-model-site.example/a.jpg', trigger: ['a', 'b'], rating: '3' },
    { name: 'No still', file: 'n.safetensors', thumb: null },
  ],
  workflows: [
    { name: 'Coast', thumb: null, examples: ['wf/coast.mp4', 'wf/coast.jpg'], favourite: true },
    { name: 'Skip me' },
  ],
  copies: [
    {
      name: 'Night drive',
      poster: 'copies/night.jpg',
      preview: 'copies/night.mp4',
      examples: ['copies/night.mp4', 'copies/night-2.jpg', '../secret.mp4', 'https://cdn.example/x.mp4'],
      author: 'Ada',
      duration: 4,
      civitai: { id: 99 },
      favorite: true,
    },
    { title: 'Poster only', poster: 'copies/still.png', examples: [] },
  ],
};

test('studioThumbUrl stays under /studio-thumbs/ and drops off-site paths', () => {
  assert.equal(studioThumbUrl('loras/flux style.jpg'), '/studio-thumbs/loras/flux%20style.jpg');
  assert.equal(studioThumbUrl('/studio-thumbs/wf/coast.jpg'), '/studio-thumbs/wf/coast.jpg');
  assert.equal(studioThumbUrl('./copies/night.mp4'), '/studio-thumbs/copies/night.mp4');
  assert.equal(studioThumbUrl('https://some-model-site.example/a.jpg'), null);
  assert.equal(studioThumbUrl('//cdn.example/x.mp4'), null);
  assert.equal(studioThumbUrl('../secret.mp4'), null);
  assert.equal(studioThumbUrl('a\\b.png'), null);
  assert.equal(studioThumbUrl(''), null);
  assert.equal(studioThumbUrl(null), null);
});

test('parseStudioThumbIndex keeps the catalog shape and optional fields', () => {
  const cat = parseStudioThumbIndex(sample);
  assert.equal(cat.loras.length, 3);
  assert.equal(cat.loras[0].thumb, 'loras/flux style.jpg');
  assert.equal(cat.loras[0].favorite, true);
  assert.equal(cat.loras[0].rating, 4.5);
  assert.equal(cat.loras[0].model, 'Flux');
  assert.equal(cat.loras[1].thumb, null);
  assert.equal(cat.loras[1].trigger, 'a, b');
  assert.equal(cat.loras[1].rating, 3);
  assert.equal(cat.workflows.length, 2);
  assert.equal(cat.workflows[0].thumb, null);
  assert.deepEqual(cat.workflows[0].examples, ['wf/coast.mp4', 'wf/coast.jpg']);
  assert.equal(cat.workflows[0].favorite, true);
  assert.equal(cat.workflows[1].thumb, null);
  assert.equal(cat.copies[0].preview, 'copies/night.mp4');
  assert.deepEqual(cat.copies[0].examples, ['copies/night.mp4', 'copies/night-2.jpg']);
  assert.equal(cat.copies[0].author, 'Ada');
  assert.equal(cat.copies[0].duration, '4');
  assert.equal(cat.copies[0].civitaiId, '99');
  assert.equal(cat.copies[0].favorite, true);
  assert.equal(cat.copies[1].name, 'Poster only');
  assert.equal(MISSING_PICTURES, 'pictures are not in this build.');
});

test('copy cards play preview, else the first example; extras omit the playing clip', () => {
  const cat = parseStudioThumbIndex(sample);
  const main = copyMainClip(cat.copies[0]);
  assert.equal(main.src, '/studio-thumbs/copies/night.mp4');
  assert.equal(main.poster, '/studio-thumbs/copies/night.jpg');
  assert.deepEqual(copyExtras(cat.copies[0]), ['/studio-thumbs/copies/night-2.jpg']);
  const fallback = parseStudioThumbIndex({ copies: [{ name: 'A', examples: ['clips/a.mp4', 'clips/b.jpg'] }] });
  assert.equal(copyMainClip(fallback.copies[0]).src, '/studio-thumbs/clips/a.mp4');
  assert.deepEqual(copyExtras(fallback.copies[0]), ['/studio-thumbs/clips/b.jpg']);
});

test('cardImage uses the thumb, and a null workflow thumb falls through to a still example', () => {
  const cat = parseStudioThumbIndex(sample);
  assert.equal(cardImage(cat.loras[0].thumb), '/studio-thumbs/loras/flux%20style.jpg');
  assert.equal(cardImage(cat.workflows[0].thumb, cat.workflows[0].examples), '/studio-thumbs/wf/coast.jpg');
  assert.equal(cardImage(null, ['only.mp4']), null);
  assert.equal(cardMeta(cat.copies[0]), 'Ada · 4 · civitai 99');
});

test('loadStudioThumbs fetches only the index, with no cookies, and treats a missing file as missing', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (!String(url).endsWith('/studio-thumbs/index.json')) return new Response('no', { status: 404 });
    return new Response(JSON.stringify(sample), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ok = await loadStudioThumbs(fetchImpl);
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:5173/studio-thumbs/index.json');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(ok.catalog.copies.length, 2);

  const missing = await loadStudioThumbs(async () => new Response('no', { status: 404 }));
  assert.deepEqual(missing, { ok: false, missing: true });

  const down = await loadStudioThumbs(async () => {
    throw new TypeError('failed');
  });
  assert.equal(down.ok, false);

  const empty = await loadStudioThumbs(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.equal(empty.ok, false);
});
