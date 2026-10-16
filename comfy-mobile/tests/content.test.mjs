/**
 * My Studio content: bundle normalisation, LoRA matching by file key,
 * trigger-word injection for selected LoRAs, author-settings → template
 * mapping, and the LoRA-meta mirror that must never clobber local edits.
 */
import './browser-stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseBundle, ContentBundleError, detectWorkflowFormat, words } from '../src/core/content/schema.ts';
import { buildLoraIndex, loraKey, matchServerLoras, triggerWordsForLora } from '../src/core/content/triggers.ts';
import { activeLoraFiles, joinPrompt, loraSlotsFor, mapSettingsToTemplate } from '../src/core/content/apply.ts';
import { normalizeContentUrl, useContentStore } from '../src/core/content/store.ts';
import { useLorasStore } from '../src/core/store/loras.ts';
import { useServerStore } from '../src/core/store/server.ts';
import { getTemplate } from '../src/core/templates/index.ts';
import { bindTriggerWords } from '../src/core/recipes/schema.ts';

const sample = {
  schema: 'comfy-mobile-content',
  version: 1,
  exportedAt: '2026-10-16T12:00:00+00:00',
  exporter: { name: 'export_video_studio.py', version: '1.0.0', root: '/Users/b/archon-staging/video-studio', host: 'brads-Mini-2' },
  copyCards: [
    { id: 'copy-1', source: 'copies/a.json[0]', title: 'Golden hour', text: 'golden hour, warm rim light', tags: 'lighting, warm' },
    { id: 'copy-2', source: 'copies/a.json[1]', text: '' }, // dropped: no text
  ],
  recipes: [
    {
      id: 'r1', source: 'config/workflow_part_docs.json[x]', name: 'lora_part_01.safetensors',
      trained_words: ['trigger1', 'style1, cinematic'], loras: [{ file: 'lora_part_01.safetensors', strength: 0.8, triggerWords: ['trigger1'] }],
      author_settings: { steps: 20, cfg: 3.5, sampler: 'euler', shift: 5, Strength: '0.8', frames: 81, mystery: 1 },
    },
  ],
  loras: [
    { id: 'l1', source: 'adapter_cards.py', file: 'SVI_v2_PRO_Wan2.2_I2V_high.safetensors', rating: 9, benched: 1, triggerWords: 'svi, smooth', notes: 'best' },
    { id: 'l2', source: 'adapter_cards.py', filename: 'subdir/old_style.safetensors', rating: '2' },
    { id: 'l3', source: 'adapter_cards.py', name: 'no file here' }, // dropped
  ],
  workflows: [
    { id: 'w1', source: 'workflows/x.json', name: 'x', workflow: { nodes: [{ id: 1 }, { id: 2 }], links: [] } },
    { id: 'w2', source: 'workflows/api.json', name: 'api', workflow: { 3: { class_type: 'KSampler', inputs: {} } } },
    { id: 'w3', source: 'bad', name: 'bad', workflow: 'nope' }, // dropped
  ],
  presets: [{ id: 'p1', source: 's', name: 'Fast', values: { steps: 4, cfg: 1 } }],
  raw: { 'misc.json': { source: 'misc.json', kind: 'json', shape: { a: 'int' }, data: { a: 1 } } },
  skipped: [{ source: 'big.json', reason: 'too big' }],
};

test('normaliseBundle tolerates loose input and drops unusable records', () => {
  const b = normaliseBundle(JSON.stringify(sample));
  assert.equal(b.copyCards.length, 1);
  assert.deepEqual(b.copyCards[0].tags, ['lighting', 'warm']);
  assert.equal(b.recipes[0].triggerWords.join('|'), 'trigger1|style1|cinematic');
  assert.equal(b.recipes[0].settings.steps, 20);
  assert.equal(b.loras.length, 2);
  assert.equal(b.loras[0].rating, 4.5, '0–10 scale is rescaled to 0–5');
  assert.equal(b.loras[0].benched, true);
  assert.deepEqual(b.loras[0].triggerWords, ['svi', 'smooth']);
  assert.equal(b.loras[1].rating, 2);
  assert.equal(b.workflows.length, 2);
  assert.equal(b.workflows[0].format, 'ui');
  assert.equal(b.workflows[0].nodeCount, 2);
  assert.equal(b.workflows[1].format, 'api');
  assert.equal(b.workflows[1].nodeCount, 1);
  assert.equal(b.presets[0].values.cfg, 1);
  assert.equal(Object.keys(b.raw).length, 1);
  assert.deepEqual(b.counts, { copyCards: 1, recipes: 1, loras: 2, workflows: 2, presets: 1, characters: 0, assets: 0, raw: 1, skipped: 1 });
});

test('normaliseBundle rejects non-bundles but accepts section-only objects', () => {
  assert.throws(() => normaliseBundle('{"hello": 1}'), ContentBundleError);
  assert.throws(() => normaliseBundle('not json'), ContentBundleError);
  const b = normaliseBundle({ copyCards: [{ text: 'x' }] });
  assert.equal(b.copyCards[0].title, 'x');
  assert.equal(b.copyCards[0].id, 'copy-0');
});

test('words() splits lists only when they look like lists', () => {
  assert.deepEqual(words('a, b;c\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(words('one phrase with spaces'), ['one phrase with spaces']);
  assert.deepEqual(words(['A', 'a', { word: 'b' }, null]), ['A', 'b']);
  assert.equal(detectWorkflowFormat({ nodes: [] }), 'ui');
  assert.equal(detectWorkflowFormat({ 1: { class_type: 'X' } }), 'api');
  assert.equal(detectWorkflowFormat({ foo: 1 }), 'unknown');
});

test('loraKey matches across folders, case and extension', () => {
  assert.equal(loraKey('subdir/SVI_v2_PRO_Wan2.2_I2V_high.safetensors'), 'svi_v2_pro_wan2.2_i2v_high');
  assert.equal(loraKey('svi_v2_pro_wan2.2_i2v_high'), 'svi_v2_pro_wan2.2_i2v_high');
  assert.equal(loraKey('C:\\models\\x.PT'), 'x');
});

test('LoRA index merges card + recipe trigger words and maps to server files', () => {
  const b = normaliseBundle(sample);
  const idx = buildLoraIndex(b);
  assert.equal(idx.size, 3);
  assert.deepEqual(triggerWordsForLora(idx, 'wan/lora_part_01.safetensors'), ['trigger1', 'style1', 'cinematic']);
  assert.deepEqual(triggerWordsForLora(idx, 'unknown.safetensors'), []);
  const m = matchServerLoras(idx, ['video/svi_v2_pro_wan2.2_i2v_high.safetensors', 'lora_part_01.safetensors', 'other.safetensors']);
  assert.equal(m.matched, 2);
  assert.equal(m.unmatched, 1);
  assert.equal(m.keyToServerFile['svi_v2_pro_wan2.2_i2v_high'], 'video/svi_v2_pro_wan2.2_i2v_high.safetensors');
});

test('author settings map onto the Wan template by key, role and fragment', () => {
  const t = getTemplate('wan22-txt2video');
  const b = normaliseBundle(sample);
  const r = mapSettingsToTemplate(t, b.recipes[0].settings);
  const byParam = Object.fromEntries(r.applied.map((a) => [a.param, a.value]));
  assert.equal(byParam.steps, 20);
  assert.equal(byParam.cfg, 3.5);
  assert.equal(byParam.shift, 5);
  assert.equal(byParam.frames, 81);
  assert.ok(r.ignored.includes('mystery'), 'unknown keys are reported, not guessed');
  assert.ok(!('positive' in byParam), 'prompts are never mapped as settings');
});

test('LoRA slots + toggles decide which selected LoRAs inject trigger words', () => {
  const t = getTemplate('wan22-txt2video');
  const slots = loraSlotsFor(t);
  assert.deepEqual(slots.map((s) => s.param.key), ['lora_high', 'lora_low']);
  assert.deepEqual(slots.map((s) => s.toggleKey), ['lightning', 'lightning']);
  assert.deepEqual(activeLoraFiles(t, { lora_high: 'a.safetensors', lora_low: 'b.safetensors', lightning: true }), ['a.safetensors', 'b.safetensors']);
  assert.deepEqual(activeLoraFiles(t, { lora_high: 'a.safetensors', lightning: false }), [], 'bypassed LoRA nodes inject nothing');

  const idx = buildLoraIndex(normaliseBundle(sample));
  const wordsFor = activeLoraFiles(t, { lora_high: 'lora_part_01.safetensors', lightning: true }).flatMap((f) => triggerWordsForLora(idx, f));
  const prompt = bindTriggerWords('a boat at dawn, cinematic', { triggerWords: wordsFor, loras: [] });
  assert.equal(prompt, 'trigger1, style1, a boat at dawn, cinematic', 'already-present words are not duplicated');
});

test('joinPrompt appends once and trims trailing commas', () => {
  assert.equal(joinPrompt('', 'x'), 'x');
  assert.equal(joinPrompt('a, b, ', 'c'), 'a, b, c');
  assert.equal(joinPrompt('a, Golden Hour', 'golden hour'), 'a, Golden Hour');
});

test('normalizeContentUrl fills scheme and file name', () => {
  assert.equal(normalizeContentUrl('100.89.112.7:8152'), 'http://100.89.112.7:8152/bundle.json');
  assert.equal(normalizeContentUrl('http://mac:8152/'), 'http://mac:8152/bundle.json');
  assert.equal(normalizeContentUrl('http://mac:8152/custom.json'), 'http://mac:8152/custom.json');
  assert.equal(normalizeContentUrl(''), 'http://100.89.112.7:8152/bundle.json');
});

beforeEach(() => {
  useLorasStore.setState({ meta: {} });
  useContentStore.setState({ bundle: null, synced: {}, status: 'idle', error: null });
});

test('importText caches the bundle and mirrors ratings into the LoRA picker store for server files only', async () => {
  useServerStore.setState({ modelLists: { loras: ['video/svi_v2_pro_wan2.2_i2v_high.safetensors', 'lora_part_01.safetensors', 'other.safetensors'] } });
  assert.equal(await useContentStore.getState().importText(JSON.stringify(sample)), true);
  const s = useContentStore.getState();
  assert.equal(s.status, 'ok');
  assert.equal(s.origin, 'file');
  const meta = useLorasStore.getState().meta;
  assert.equal(meta['video/svi_v2_pro_wan2.2_i2v_high.safetensors'].rating, 4.5);
  assert.deepEqual(meta['video/svi_v2_pro_wan2.2_i2v_high.safetensors'].triggerWords, ['svi', 'smooth']);
  assert.deepEqual(meta['lora_part_01.safetensors'].triggerWords, ['trigger1', 'style1', 'cinematic']);
  assert.equal(meta['other.safetensors'], undefined, 'files without a card are left alone');
  assert.equal(meta['subdir/old_style.safetensors'], undefined, 'cards without a server file are not written');
});

test('a locally edited rating survives a re-sync; untouched ones follow the bundle', async () => {
  useServerStore.setState({ modelLists: { loras: ['video/svi_v2_pro_wan2.2_i2v_high.safetensors', 'lora_part_01.safetensors'] } });
  await useContentStore.getState().importText(JSON.stringify(sample));
  useLorasStore.getState().setMeta('video/svi_v2_pro_wan2.2_i2v_high.safetensors', { rating: 1 });

  const updated = structuredClone(sample);
  updated.loras[0].rating = 10;
  updated.recipes[0].trained_words = ['newword'];
  updated.recipes[0].loras[0].triggerWords = [];
  await useContentStore.getState().importText(JSON.stringify(updated));

  const meta = useLorasStore.getState().meta;
  assert.equal(meta['video/svi_v2_pro_wan2.2_i2v_high.safetensors'].rating, 1, 'local edit wins');
  assert.deepEqual(meta['lora_part_01.safetensors'].triggerWords, ['newword'], 'untouched entry follows the new bundle');
});

test('importText rejects junk without losing the loaded bundle', async () => {
  await useContentStore.getState().importText(JSON.stringify(sample));
  assert.equal(await useContentStore.getState().importText('{"nope": true}'), false);
  const s = useContentStore.getState();
  assert.equal(s.status, 'ok');
  assert.match(s.error, /not a My Studio bundle/);
  assert.equal(s.bundle.copyCards.length, 1);
});

test('refresh reports unreachable hosts with the serve hint and keeps state', async () => {
  globalThis.fetch = async () => {
    throw Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
  };
  useContentStore.getState().setSourceUrl('http://100.89.112.7:8152/bundle.json');
  assert.equal(await useContentStore.getState().refresh(), false);
  const s = useContentStore.getState();
  assert.equal(s.status, 'error');
  assert.match(s.error, /export_video_studio\.py --serve/);

  globalThis.fetch = async () => new Response(JSON.stringify(sample), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.equal(await useContentStore.getState().refresh(), true);
  assert.equal(useContentStore.getState().origin, 'url');
  assert.equal(useContentStore.getState().bundle.recipes.length, 1);
});
