/**
 * Run a My Studio card: parse the index fields, patch only the named widgets,
 * and load the workflow JSON from /studio-thumbs/.
 */
import './browser-stubs.mjs';
import { fakeLocation } from './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInfo } from '../mock-server/object-info.mjs';
import { absoluteServerUrl, api } from '../src/core/api/client.ts';
import { absoluteStudioUrl, parseStudioThumbIndex, safeImageType, safeUploadName } from '../src/core/content/studioThumbs.ts';
import { useSettingsStore } from '../src/core/store/settings.ts';
import {
  GALLERY_NOT_IN_BUILD,
  SETTINGS_NOT_IN_BUILD,
  applyStudioRunEdits,
  galleryWindow,
  loadStudioGallery,
  loadStudioWorkflowFile,
  parseStudioGallery,
  patchStudioRunFile,
  peekStudioGallery,
  primeStudioGallery,
  resetStudioGallerySession,
  scrubUrlError,
  studioPhotoStatus,
  studioRunEdits,
  submitSavedStudioPrompt,
} from '../src/core/content/studioRun.ts';
import { joinHttpUrl } from '../src/core/httpUrl.ts';
import { visibleQueueItems } from '../src/screens/queueList.ts';
import { graphToPrompt } from '../src/core/graph/prompt.ts';
import { parseWorkflow } from '../src/core/graph/serialize.ts';

const info = buildObjectInfo();
const SUB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function node(id, type, widgets_values) {
  return {
    id,
    type,
    pos: [0, 0],
    size: [200, 80],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values,
  };
}

const saved = {
  last_node_id: 10,
  last_link_id: 0,
  nodes: [
    node(1, 'CLIPTextEncode', ['old prompt']),
    node(2, 'LoadImage', ['card.png']),
    node(3, 'KSampler', [111, 'fixed', 20, 8, 'euler', 'normal', 1]),
    node(10, SUB, []),
  ],
  links: [],
  definitions: {
    subgraphs: [
      {
        id: SUB,
        name: 'Inner',
        nodes: [node(8, 'CLIPTextEncode', ['inner prompt'])],
        links: [],
        inputs: [],
        outputs: [],
      },
    ],
  },
};

test('parseStudioThumbIndex reads run fields and drops an unsafe workflow file', () => {
  const cat = parseStudioThumbIndex({
    copies: [
      {
        name: 'Night',
        preview: 'copies/night.mp4',
        workflowFile: './studio-thumbs/runs/night.json',
        prompt: 'a night drive',
        promptNodeId: '6',
        promptField: 'text',
        imageNodeId: 2,
        imageField: 'image',
      },
      {
        name: 'No file',
        workflowFile: null,
        promptNodeId: null,
        imageField: '',
      },
      { name: 'Off site', workflowFile: '../secret.json', prompt: 'nope' },
    ],
    workflows: [{ name: 'Coast', workflowFile: '/studio-thumbs/runs/coast.json', promptNodeId: 4.5 }],
    loras: [{ name: 'Style', file: 'a.safetensors' }],
  });
  assert.equal(cat.copies[0].workflowFile, 'runs/night.json');
  assert.equal(cat.copies[0].prompt, 'a night drive');
  assert.equal(cat.copies[0].promptNodeId, 6);
  assert.equal(cat.copies[0].promptField, 'text');
  assert.equal(cat.copies[0].imageNodeId, 2);
  assert.equal(cat.copies[0].imageField, 'image');
  assert.equal(cat.copies[1].workflowFile, null);
  assert.equal(cat.copies[1].prompt, '');
  assert.equal(cat.copies[1].promptNodeId, null);
  assert.equal(cat.copies[1].imageField, null);
  assert.equal(cat.copies[2].workflowFile, null);
  assert.equal(cat.workflows[0].workflowFile, 'runs/coast.json');
  assert.equal(cat.workflows[0].promptNodeId, null);
  assert.equal(cat.loras[0].workflowFile, undefined);
});

test('applyStudioRunEdits changes only the named widgets', () => {
  const wf = parseWorkflow(structuredClone(saved), info);
  const seedBefore = wf.nodes.find((n) => n.id === 3).widgets_values.slice();
  const imageBefore = wf.nodes.find((n) => n.id === 2).widgets_values.slice();
  const { workflow, missed } = applyStudioRunEdits(wf, {
    prompt: { nodeId: 1, field: 'text', value: 'a new night' },
    image: null,
  });
  assert.deepEqual(missed, []);
  const { prompt } = graphToPrompt(workflow);
  assert.equal(prompt['1'].inputs.text, 'a new night');
  assert.equal(prompt['2'].inputs.image, 'card.png');
  assert.equal(prompt['3'].inputs.seed, 111);
  assert.equal(prompt['10:8'].inputs.text, 'inner prompt');
  assert.deepEqual(workflow.nodes.find((n) => n.id === 3).widgets_values, seedBefore);
  assert.deepEqual(workflow.nodes.find((n) => n.id === 2).widgets_values, imageBefore);
  assert.equal(wf.nodes.find((n) => n.id === 1).widgets_values[0], 'old prompt');
});

test('a new photo is written and a missing widget is not queued as a silent miss', () => {
  const wf = parseWorkflow(structuredClone(saved), info);
  const { workflow, missed } = applyStudioRunEdits(wf, {
    prompt: { nodeId: 1, field: 'text', value: 'kept' },
    image: { nodeId: 2, field: 'image', value: 'uploaded.png' },
  });
  assert.deepEqual(missed, []);
  assert.equal(graphToPrompt(workflow).prompt['2'].inputs.image, 'uploaded.png');
  assert.equal(graphToPrompt(workflow).prompt['3'].inputs.seed, 111);

  const absent = applyStudioRunEdits(wf, {
    prompt: { nodeId: 1, field: 'nope', value: 'x' },
  });
  assert.deepEqual(absent.missed, ['prompt']);
  assert.equal(absent.workflow.nodes.find((n) => n.id === 1).widgets_values[0], 'old prompt');
});

test('a prompt node inside a subgraph is updated when the root has no match', () => {
  const wf = parseWorkflow(structuredClone(saved), info);
  const { workflow, missed } = applyStudioRunEdits(wf, {
    prompt: { nodeId: 8, field: 'text', value: 'from the sheet' },
  });
  assert.deepEqual(missed, []);
  const inner = workflow.definitions.subgraphs[0].nodes.find((n) => n.id === 8);
  assert.equal(inner.widgets_values[0], 'from the sheet');
  assert.equal(graphToPrompt(workflow).prompt['10:8'].inputs.text, 'from the sheet');
  assert.equal(workflow.nodes.find((n) => n.id === 1).widgets_values[0], 'old prompt');
  assert.equal(workflow.nodes.find((n) => n.id === 3).widgets_values[0], 111);
});

test('UI graph sets widgets_values_named and leaves every other widget', () => {
  const raw = {
    nodes: [
      {
        id: 1,
        type: 'CLIPTextEncode',
        widgets_values: ['stale positional', false],
        widgets_values_named: { text: 'from named', dynamic_prompts: false },
      },
      node(3, 'KSampler', [111, 'fixed', 20, 8, 'euler', 'normal', 1]),
    ],
  };
  raw.nodes[1].widgets_values_named = { seed: 111, steps: 20 };
  const patched = patchStudioRunFile(raw, {
    prompt: { nodeId: 1, field: 'text', value: 'a night drive' },
  });
  assert.equal(patched.format, 'ui');
  const promptNode = patched.workflow.nodes.find((n) => n.id === 1);
  assert.equal(promptNode.widgets_values_named.text, 'a night drive');
  assert.equal(promptNode.widgets_values_named.dynamic_prompts, false);
  assert.equal(promptNode.widgets_values[1], false);
  const sampler = patched.workflow.nodes.find((n) => n.id === 3);
  assert.equal(sampler.widgets_values_named.seed, 111);
  assert.equal(sampler.widgets_values[1], 'fixed');

  const wf = parseWorkflow(patched.workflow, info);
  const { prompt } = graphToPrompt(wf);
  assert.equal(prompt['1'].inputs.text, 'a night drive');
  assert.equal(prompt['3'].inputs.seed, 111);
  assert.equal(raw.nodes[0].widgets_values_named.text, 'from named');
});

test('PixaromaText replaces the string widget and leaves the other value', () => {
  const pix = {
    ...info,
    PixaromaText: {
      input: { required: { text: ['STRING', { multiline: true }], dynamic_prompts: ['BOOLEAN', { default: false }] } },
      input_order: { required: ['text', 'dynamic_prompts'] },
      output: ['STRING'],
      output_is_list: [false],
      output_name: ['STRING'],
      name: 'PixaromaText',
      display_name: 'Text Pixaroma',
      description: '',
      python_module: 'custom_nodes.PixaromaText',
      category: 'pixaroma',
      output_node: false,
    },
  };
  const raw = {
    nodes: [
      {
        id: 4,
        type: 'PixaromaText',
        inputs: [{ name: 'text', type: 'STRING', widget: { name: 'text' }, link: null }],
        widgets_values: ['saved words', false],
      },
      node(3, 'KSampler', [111, 'fixed', 20, 8, 'euler', 'normal', 1]),
    ],
  };
  const patched = patchStudioRunFile(raw, {
    prompt: { nodeId: 4, field: 'text', value: 'new words' },
  });
  assert.equal(patched.format, 'ui');
  const text = patched.workflow.nodes.find((n) => n.id === 4);
  assert.deepEqual(text.widgets_values, ['new words', false]);
  assert.equal(patched.workflow.nodes.find((n) => n.id === 3).widgets_values[0], 111);
  const { prompt } = graphToPrompt(parseWorkflow(patched.workflow, pix));
  assert.equal(prompt['4'].inputs.text, 'new words');
  assert.equal(prompt['4'].inputs.dynamic_prompts, false);
  assert.equal(prompt['3'].inputs.seed, 111);
});

test('API prompt sets the prompt input and the image input only when a photo was picked', () => {
  const raw = {
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['4', 1] } },
    2: { class_type: 'LoadImage', inputs: { image: 'card.png' } },
    3: { class_type: 'KSampler', inputs: { seed: 111, steps: 20, sampler_name: 'euler' } },
  };
  const wordsOnly = patchStudioRunFile(raw, {
    prompt: { nodeId: 6, field: 'text', value: 'a night drive' },
    image: null,
  });
  assert.equal(wordsOnly.format, 'api');
  assert.deepEqual(wordsOnly.missed, []);
  assert.equal(wordsOnly.prompt['6'].inputs.text, 'a night drive');
  assert.deepEqual(wordsOnly.prompt['6'].inputs.clip, ['4', 1]);
  assert.equal(wordsOnly.prompt['2'].inputs.image, 'card.png');
  assert.equal(wordsOnly.prompt['3'].inputs.seed, 111);

  const withPhoto = patchStudioRunFile(raw, {
    prompt: { nodeId: 6, field: 'text', value: 'a night drive' },
    image: { nodeId: 2, field: 'image', value: 'uploaded.png' },
  });
  assert.equal(withPhoto.prompt['2'].inputs.image, 'uploaded.png');
  assert.equal(withPhoto.prompt['3'].inputs.sampler_name, 'euler');
  assert.equal(raw['2'].inputs.image, 'card.png');
});

test('loadStudioWorkflowFile fetches the same-origin workflow and fails closed', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('missing.json')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({ nodes: [] }) };
  };
  const body = await loadStudioWorkflowFile('runs/night.json', fetchImpl);
  assert.deepEqual(body, { nodes: [] });
  assert.equal(calls[0].url, 'http://localhost:5173/studio-thumbs/runs/night.json');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  await assert.rejects(() => loadStudioWorkflowFile('runs/missing.json', fetchImpl), { message: SETTINGS_NOT_IN_BUILD });
  await assert.rejects(() => loadStudioWorkflowFile('https://other.example/w.json', fetchImpl), { message: SETTINGS_NOT_IN_BUILD });
  assert.equal(calls.length, 2);
});

test('an API prompt keeps every input except the edited words and chosen photo', () => {
  const timeline = { tracks: [{ id: 'a', frames: [1, 2] }] };
  const builder = { version: 3, nodes: { x: true } };
  const raw = {
    12: {
      class_type: 'MiniMaxH3Director',
      inputs: { text: 'saved words', timeline_data: timeline, builder_state: builder, clip: ['4', 1] },
    },
    9: {
      class_type: 'DaSiWa_EnhancedVideoCombine',
      inputs: { images: ['12', 0], frame_rate: 16, extra: { keep: true } },
    },
  };
  const untouched = studioRunEdits({
    words: 'saved words',
    savedWords: 'saved words',
    promptNodeId: 12,
    promptField: 'text',
    imageName: null,
    imageNodeId: 2,
    imageField: 'image',
  });
  assert.deepEqual(untouched, { prompt: null, image: null });
  const same = patchStudioRunFile(raw, untouched);
  assert.equal(same.format, 'api');
  assert.deepEqual(same.prompt, raw);

  const words = studioRunEdits({
    words: 'a night drive',
    savedWords: 'saved words',
    promptNodeId: 12,
    promptField: 'text',
    imageName: 'shot.png',
    imageNodeId: 9,
    imageField: 'images',
  });
  const patched = patchStudioRunFile(raw, words);
  assert.equal(patched.format, 'api');
  assert.deepEqual(Object.keys(patched.prompt).sort(), ['12', '9']);
  assert.equal(patched.prompt['12'].inputs.text, 'a night drive');
  assert.deepEqual(patched.prompt['12'].inputs.timeline_data, timeline);
  assert.deepEqual(patched.prompt['12'].inputs.builder_state, builder);
  assert.deepEqual(patched.prompt['12'].inputs.clip, ['4', 1]);
  assert.equal(patched.prompt['12'].class_type, 'MiniMaxH3Director');
  assert.deepEqual(patched.prompt['9'].inputs.extra, { keep: true });
  assert.equal(patched.prompt['9'].inputs.frame_rate, 16);
  assert.equal(patched.prompt['9'].inputs.images, 'shot.png');
  assert.deepEqual(raw['12'].inputs.timeline_data, timeline);
  assert.equal(raw['12'].inputs.text, 'saved words');

  const missed = patchStudioRunFile(raw, { prompt: { nodeId: 99, field: 'text', value: 'nope' } });
  assert.deepEqual(missed.missed, ['prompt']);
  assert.deepEqual(missed.prompt, raw);
  assert.equal(Object.keys(missed.prompt).length, 2);
});

test('gallery.json is a same-origin list of thumb and file', async () => {
  const parsed = parseStudioGallery([
    { thumb: 'gallery/thumbs/night.webp', file: 'gallery/night.png' },
    { thumb: 'https://other.example/a.webp', file: 'gallery/../secret.png' },
    { file: 'gallery/only.png' },
  ]);
  assert.deepEqual(parsed, [
    { thumb: '/studio-thumbs/gallery/thumbs/night.webp', file: '/studio-thumbs/gallery/night.png', name: 'night.png' },
    { thumb: '/studio-thumbs/gallery/only.png', file: '/studio-thumbs/gallery/only.png', name: 'only.png' },
  ]);
  const wrapped = parseStudioGallery({ images: [{ thumb: 'gallery/a.webp', file: 'gallery/a.png' }] });
  assert.equal(wrapped[0].name, 'a.png');

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('missing')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => [{ thumb: 'gallery/t.webp', file: 'gallery/t.png' }] };
  };
  const images = await loadStudioGallery(fetchImpl);
  assert.equal(images[0].file, '/studio-thumbs/gallery/t.png');
  assert.equal(calls[0].url, 'http://localhost:5173/studio-thumbs/gallery.json');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  await assert.rejects(() => loadStudioGallery(async () => ({ ok: false, status: 404, json: async () => ({}) })), { message: GALLERY_NOT_IN_BUILD });
  await assert.rejects(
    () => loadStudioGallery(async () => ({ ok: true, json: async () => ({ not: 'a list' }) })),
    { message: GALLERY_NOT_IN_BUILD },
  );
});

test('gallery.json is fetched once per session and only the on-screen window is decoded', async () => {
  resetStudioGallerySession();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const images = Array.from({ length: 2730 }, (_, i) => ({ thumb: `g/t${i}.webp`, file: `g/${i}.png` }));
    return { ok: true, json: async () => images };
  };
  const first = await primeStudioGallery(fetchImpl);
  const second = await primeStudioGallery(async () => {
    calls += 1;
    throw new Error('refetch');
  });
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(peekStudioGallery()?.length, 2730);
  const top = galleryWindow(2730, 0, 240, 96, 3);
  assert.equal(top.start, 0);
  assert.ok(top.end <= 15);
  assert.ok(top.end >= 9);
  const mid = galleryWindow(2730, 10000, 240, 96, 3);
  assert.ok(mid.start > 100);
  assert.ok(mid.end - mid.start <= 18);
  assert.ok(mid.end < 2730);
  resetStudioGallerySession();
});

test('a gallery photo is fetched from an absolute URL and the sheet shows one photo line', () => {
  assert.equal(
    absoluteStudioUrl('/studio-thumbs/gallery/copies_start_261015_141131_c4392a.png', 'http://phone.local:8152'),
    'http://phone.local:8152/studio-thumbs/gallery/copies_start_261015_141131_c4392a.png',
  );
  assert.equal(absoluteStudioUrl('http://phone.local/studio-thumbs/a.png', 'http://other'), 'http://phone.local/studio-thumbs/a.png');
  assert.equal(safeUploadName('copies/copies_start_261015_141131_c4392a.png'), 'copies_start_261015_141131_c4392a.png');
  assert.equal(safeImageType('image/png; charset=utf-8'), 'image/png');
  assert.equal(safeImageType('not a type'), 'image/png');
  assert.equal(studioPhotoStatus('copies_start_261015_141131_c4392a.png', true), "Using copies_start_261015_141131_c4392a.png instead of the card's image.");
  assert.equal(studioPhotoStatus('copies_start_261015_141131_c4392a.png', false), "This photo stays as saved in the workflow.");
  assert.equal(studioPhotoStatus(null, true), "Keeping the card's image.");
});

test('a saved API prompt with angle brackets posts to an absolute URL', async () => {
  const words = '<Picture 1> standing in the doorway';
  const saved = {
    6: { class_type: 'CLIPTextEncode', inputs: { text: words, clip: ['4', 1] } },
    2: { class_type: 'LoadImage', inputs: { image: 'card.png' } },
  };
  const OriginalURL = globalThis.URL;
  const seen = [];
  globalThis.URL = class extends OriginalURL {
    constructor(input, base) {
      const value = String(input);
      seen.push(value);
      if (base !== undefined || /[<>]/.test(value) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        throw new TypeError('The string did not match the expected pattern.');
      }
      super(value);
    }
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError('The string did not match the expected pattern.');
    }
    if ((init.method ?? 'GET') === 'POST') {
      return new Response(JSON.stringify({ prompt_id: 'accepted' }), { status: 200 });
    }
    return new Response(JSON.stringify(saved), { status: 200 });
  };
  const previousOrigin = fakeLocation.origin;
  fakeLocation.origin = 'http://phone.local:8152';
  try {
    assert.throws(() => joinHttpUrl('http://phone.local:8152', words), (err) => {
      assert.equal(/did not match the expected pattern/.test(err.message), false);
      assert.match(err.message, /prompt/i);
      return true;
    });
    const result = await submitSavedStudioPrompt({
      workflowFile: 'runs/copy.json',
      serverUrl: '100.103.142.118:8188',
      pageOrigin: 'http://phone.local:8152',
      fetchImpl,
      clientId: 'phone',
    });
    assert.equal(calls[0].url, 'http://phone.local:8152/studio-thumbs/runs/copy.json');
    assert.equal(calls[0].method, 'GET');
    assert.equal(result.postUrl, 'http://100.103.142.118:8188/prompt');
    assert.equal(calls[1].url, result.postUrl);
    assert.equal(calls[1].method, 'POST');
    const posted = JSON.parse(calls[1].body);
    assert.equal(posted.prompt['6'].inputs.text, words);
    assert.equal(posted.prompt['2'].inputs.image, 'card.png');
    assert.equal(result.promptId, 'accepted');
    assert.equal(result.postUrl.includes('<'), false);
    assert.equal(result.postUrl.includes('Picture'), false);
    assert.equal(seen.some((value) => value.includes('<') || value.includes('Picture') || value === '/prompt' || value === '100.103.142.118:8188'), false);
    assert.equal(calls.some((call) => /did not match the expected pattern/.test(JSON.stringify(call))), false);
    assert.equal(scrubUrlError('The string did not match the expected pattern.'), 'ComfyUI address is not a full URL');
    assert.equal(/did not match the expected pattern/.test(result.body) && result.body.includes('http'), false);
    assert.match(result.body, /<Picture 1>/);
  } finally {
    globalThis.URL = OriginalURL;
    fakeLocation.origin = previousOrigin;
  }
});

test('Run posts to the node-list server when the saved address has no scheme', async () => {
  const saved = useSettingsStore.getState().serverUrl;
  useSettingsStore.getState().set({ serverUrl: '100.103.142.118:8188' });
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    return new Response(JSON.stringify({ prompt_id: 'accepted', number: 1, node_errors: {} }), { status: 200 });
  };
  try {
    assert.equal(absoluteServerUrl('/object_info'), 'http://100.103.142.118:8188/object_info');
    assert.equal(absoluteServerUrl('/prompt'), 'http://100.103.142.118:8188/prompt');
    const res = await api.queuePrompt(
      { 6: { class_type: 'CLIPTextEncode', inputs: { text: '<Picture 1> standing in the doorway' } } },
      'phone',
    );
    assert.equal(res.prompt_id, 'accepted');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'http://100.103.142.118:8188/prompt');
    const posted = JSON.parse(calls[0].body);
    assert.equal(posted.prompt['6'].inputs.text, '<Picture 1> standing in the doorway');
    assert.equal(calls[0].url.includes('<'), false);
  } finally {
    globalThis.fetch = previousFetch;
    useSettingsStore.getState().set({ serverUrl: saved });
  }
});

test('an accepted prompt stays visible on the live queue before refresh', () => {
  const running = [[1, 'running-id', {}, {}, []]];
  const pending = [[2, 'pending-id', {}, {}, []]];
  const withFocus = visibleQueueItems(running, pending, 'new-id');
  assert.equal(withFocus[0].placeholder, true);
  assert.equal(withFocus[0].item[1], 'new-id');
  assert.equal(withFocus.length, 3);
  const landed = visibleQueueItems(running, [[3, 'new-id', {}, {}, []]], 'new-id');
  assert.equal(landed.some((row) => row.placeholder), false);
  assert.equal(landed.filter((row) => row.item[1] === 'new-id').length, 1);
});
