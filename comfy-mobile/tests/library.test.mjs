/**
 * Library: model-folder enumeration (`GET /models` → `GET /models/<folder>`),
 * user-data workflows (`GET /api/userdata?dir=workflows&recurse=true`,
 * `GET /api/userdata/workflows%2F<name>`), loader-node lookup and the
 * Studio LoRA stack injection. The HTTP tests run against the bundled mock
 * server on a random port.
 */
import './browser-stubs.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildObjectInfo, MODELS } from '../mock-server/object-info.mjs';
import {
  embeddingToken,
  filterModelGroups,
  groupModelFolders,
  inputImages,
  loaderFor,
  matchesQuery,
  parseUserdataList,
  studioTargetFor,
  totalModelCount,
  userWorkflowPath,
} from '../src/core/library/index.ts';
import { applyTemplate, defaultValues, getTemplate } from '../src/core/templates/index.ts';
import { MAX_STUDIO_LORAS, STUDIO_LORA_PROP, addLora, modelRoots, readStudioLoras, stripStudioLoras, supportsStudioLoras, withStudioLoras } from '../src/core/templates/loras.ts';
import { graphToPrompt } from '../src/core/graph/prompt.ts';
import { parseWorkflow } from '../src/core/graph/serialize.ts';
import { api } from '../src/core/api/client.ts';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { useServerStore } from '../src/core/store/server.ts';
import { useLibraryStore } from '../src/core/store/library.ts';

const info = buildObjectInfo();
const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('groupModelFolders orders known folders first, labels them, and keeps counts', () => {
  const groups = groupModelFolders(['zzz_custom', 'vae', 'loras', 'checkpoints'], { loras: ['a', 'b'], checkpoints: ['c'], vae: [] });
  assert.deepEqual(
    groups.map((g) => g.folder),
    ['checkpoints', 'loras', 'vae', 'zzz_custom'],
  );
  assert.equal(groups[0].label, 'Checkpoints');
  assert.equal(groups[1].count, 2);
  assert.equal(groups[2].count, 0);
  assert.equal(groups[2].loading, false);
  assert.equal(groups[3].loading, true, 'folder without a list yet is loading');
  assert.equal(groups[3].label, 'Zzz custom');
  assert.deepEqual(
    groupModelFolders(['vae', 'loras'], { loras: ['a'], vae: [] }, { hideEmpty: true }).map((g) => g.folder),
    ['loras'],
  );
});

test('filterModelGroups does a word-AND match across every group and drops empty groups', () => {
  const groups = groupModelFolders(['loras', 'checkpoints'], { loras: ['wan/film_grain_v3.safetensors', 'sdxl/film_grain_v3.safetensors', 'add_detail.safetensors'], checkpoints: ['dreamshaper_8.safetensors'] });
  assert.equal(totalModelCount(groups), 4);
  const hit = filterModelGroups(groups, 'wan grain');
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].files, ['wan/film_grain_v3.safetensors']);
  assert.equal(filterModelGroups(groups, '').length, 2);
  assert.ok(matchesQuery('Wan_Cinematic_Drone_v2.safetensors', 'DRONE cinematic'));
  assert.ok(!matchesQuery('add_detail.safetensors', 'drone'));
});

test('loaderFor picks the core loader whose combo lists the file, scans object_info for custom folders, null for embeddings', () => {
  assert.deepEqual(loaderFor('loras', 'add_detail.safetensors', info), { type: 'LoraLoaderModelOnly', widget: 'lora_name' });
  assert.deepEqual(loaderFor('checkpoints', 'dreamshaper_8.safetensors', info), { type: 'CheckpointLoaderSimple', widget: 'ckpt_name' });
  assert.deepEqual(loaderFor('diffusion_models', MODELS.diffusion_models[0], info), { type: 'UNETLoader', widget: 'unet_name' });
  assert.deepEqual(loaderFor('controlnet', MODELS.controlnet[0], info), { type: 'ControlNetLoader', widget: 'control_net_name' });
  // Unknown folder name, but some node's combo lists the file → found by scanning.
  assert.deepEqual(loaderFor('weird_pack_folder', MODELS.upscale_models[0], info), { type: 'UpscaleModelLoader', widget: 'model_name' });
  // Folder exists but nothing on this server loads it (IP-Adapter pack not installed in the mock).
  assert.equal(loaderFor('ipadapter', MODELS.ipadapter[0], info), null);
  assert.equal(loaderFor('embeddings', 'easynegative.safetensors', info), null);
  assert.equal(embeddingToken('easynegative.safetensors'), 'embedding:easynegative');
  // Without object_info we still offer the conventional loader.
  assert.deepEqual(loaderFor('vae', 'x.safetensors', null), { type: 'VAELoader', widget: 'vae_name' });
});

test('parseUserdataList accepts both response shapes, keeps .json only, newest first', () => {
  const full = parseUserdataList([
    { path: 'old.json', size: 10, modified: 1000 },
    { path: 'video/new.json', size: 20, modified: 2000 },
    { path: 'notes.txt', size: 1, modified: 3000 },
    { path: 'sub\\win.json', size: 5, modified: 1500 },
  ]);
  assert.deepEqual(
    full.map((w) => w.name),
    ['video/new', 'sub/win', 'old'],
  );
  assert.equal(full[0].size, 20);
  const bare = parseUserdataList(['b.json', 'a.json', 'readme.md']);
  assert.deepEqual(
    bare.map((w) => w.path),
    ['a.json', 'b.json'],
  );
  assert.deepEqual(parseUserdataList({ nope: true }), []);
  assert.equal(userWorkflowPath({ path: 'video/new.json' }), 'workflows/video/new.json');
});

test('studioTargetFor routes LoRAs to the stack / slot, model files to the matching model param, embeddings to the prompt', () => {
  const wan = getTemplate('wan22-txt2video');
  const lists = Object.fromEntries(Object.entries(MODELS));
  assert.deepEqual(studioTargetFor(wan, 'loras', 'add_detail.safetensors', info, lists, { stackSupported: true }), { kind: 'stack' });
  assert.deepEqual(studioTargetFor(wan, 'loras', 'add_detail.safetensors', info, lists), { kind: 'param', key: 'lora_high', label: 'High-noise LoRA' });
  assert.deepEqual(studioTargetFor(wan, 'diffusion_models', MODELS.diffusion_models[1], info, lists), { kind: 'param', key: 'model_high', label: 'High-noise model' });
  assert.deepEqual(studioTargetFor(wan, 'embeddings', 'easynegative.safetensors', info, lists), { kind: 'prompt', token: 'embedding:easynegative' });
  assert.equal(studioTargetFor(wan, 'checkpoints', 'dreamshaper_8.safetensors', info, lists).kind, 'none', 'Wan has no checkpoint param');
  const sd = getTemplate('default-txt2img');
  assert.deepEqual(studioTargetFor(sd, 'checkpoints', 'dreamshaper_8.safetensors', info, lists), { kind: 'param', key: 'model', label: 'Checkpoint' });
  assert.equal(studioTargetFor(sd, 'loras', 'add_detail.safetensors', info, lists).kind, 'none', 'image template has no LoRA slot');
});

test('inputImages merges the LoadImage combo with session uploads, images only', () => {
  const list = inputImages(info, ['fresh_upload.png', 'clip.mp4', 'example.png']);
  assert.ok(list.includes('example.png'));
  assert.ok(list.includes('portrait_ref.png'));
  assert.ok(list.includes('fresh_upload.png'));
  assert.ok(!list.includes('clip.mp4'));
  assert.equal(list.filter((f) => f === 'example.png').length, 1);
  assert.deepEqual(inputImages(null, ['a.png']), ['a.png']);
});

// ---------------------------------------------------------------------------
// Studio LoRA stack
// ---------------------------------------------------------------------------

test('addLora de-duplicates and caps at MAX_STUDIO_LORAS', () => {
  let list = [];
  for (let i = 0; i < 6; i++) list = addLora(list, `l${i}.safetensors`, 0.8);
  assert.equal(list.length, MAX_STUDIO_LORAS);
  assert.equal(addLora(list, 'l0.safetensors'), list, 'duplicate returns the same array');
  assert.equal(addLora(list, 'l9.safetensors'), list, 'full stack returns the same array');
  assert.equal(addLora([], '', 1).length, 0);
  assert.deepEqual(addLora([], 'x.safetensors', 123.456), [{ file: 'x.safetensors', strength: 100 }], 'strength is clamped to the widget range');
});

test('withStudioLoras chains LoraLoaderModelOnly after every model loader and the prompt wires through them', () => {
  const t = getTemplate('wan22-txt2video');
  const base = applyTemplate(t, { ...defaultValues(t, info), lightning: true }, info);
  assert.equal(modelRoots(base).length, 2, 'two UNETLoaders');
  assert.ok(supportsStudioLoras(t.kind, base, info));

  const stack = [
    { file: 'wan_cinematic_drone_v2.safetensors', strength: 0.7 },
    { file: 'wan/film_grain_v3.safetensors', strength: 1.25 },
  ];
  const wf = withStudioLoras(base, stack, info);
  const injected = wf.nodes.filter((n) => n.properties[STUDIO_LORA_PROP]);
  assert.equal(injected.length, 4, '2 LoRAs × 2 model roots');
  assert.equal(wf.nodes.length, base.nodes.length + 4);

  const { prompt } = graphToPrompt(wf);
  // Each root's downstream (the template's Lightning loaders, ids 3 and 4) now takes its model from the last injected node.
  for (const [rootId, lightningId] of [
    [1, 3],
    [2, 4],
  ]) {
    const chain = [];
    let feed = prompt[String(lightningId)].inputs.model;
    while (feed && prompt[feed[0]].class_type === 'LoraLoaderModelOnly' && wf.nodes.find((n) => n.id === Number(feed[0])).properties[STUDIO_LORA_PROP]) {
      chain.unshift(prompt[feed[0]]);
      feed = prompt[feed[0]].inputs.model;
    }
    assert.equal(chain.length, 2, `root ${rootId} has a 2-deep stack`);
    assert.deepEqual(feed, [String(rootId), 0], 'stack starts at the model loader');
    assert.equal(chain[0].inputs.lora_name, 'wan_cinematic_drone_v2.safetensors');
    assert.equal(chain[0].inputs.strength_model, 0.7);
    assert.equal(chain[1].inputs.lora_name, 'wan/film_grain_v3.safetensors');
    assert.equal(chain[1].inputs.strength_model, 1.25);
  }

  // Re-applying with a shorter stack removes nodes; an empty stack restores the original wiring.
  const one = withStudioLoras(wf, stack.slice(0, 1), info);
  assert.equal(one.nodes.filter((n) => n.properties[STUDIO_LORA_PROP]).length, 2);
  const none = withStudioLoras(wf, [], info);
  assert.equal(none.nodes.length, base.nodes.length);
  assert.deepEqual(graphToPrompt(none).prompt['3'].inputs.model, ['1', 0]);
  assert.deepEqual(graphToPrompt(none).prompt['4'].inputs.model, ['2', 0]);
  assert.deepEqual(stripStudioLoras(none), none, 'nothing to strip returns the same object');

  // Round-trip: the stack can be read back from the workflow (e.g. after a Graph-mode edit) and survives serialisation.
  assert.deepEqual(readStudioLoras(wf), stack);
  const reparsed = parseWorkflow(JSON.parse(JSON.stringify({ ...wf, nodes: wf.nodes.map((n) => ({ ...n, widgets: undefined })) })), info);
  assert.deepEqual(readStudioLoras(reparsed), stack);
});

test('supportsStudioLoras is video-only and requires a model root', () => {
  const img = getTemplate('default-txt2img');
  assert.equal(supportsStudioLoras(img.kind, applyTemplate(img, defaultValues(img, info), info), info), false);
  const ltx = getTemplate('ltx2-txt2video');
  assert.equal(supportsStudioLoras(ltx.kind, applyTemplate(ltx, defaultValues(ltx, info), info), info), true, 'CheckpointLoaderSimple is a model root');
});

// ---------------------------------------------------------------------------
// Against the mock server
// ---------------------------------------------------------------------------

let child;
let port;

before(async () => {
  child = spawn(process.execPath, [join(here, '..', 'mock-server', 'server.mjs')], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('mock server did not start')), 8000);
    child.stdout.on('data', (buf) => {
      const m = /listening on http:\/\/[^:]+:(\d+)/.exec(String(buf));
      if (m) {
        clearTimeout(timer);
        resolvePort(Number(m[1]));
      }
    });
  });
  useSettingsStore.getState().set({ serverUrl: `http://127.0.0.1:${port}` });
});

after(() => {
  child?.kill();
});

test('mock: GET /models then GET /models/<folder> enumerates every folder with the fixture counts', async () => {
  const folders = await api.getModelFolders();
  assert.deepEqual(folders, Object.keys(MODELS));
  const lists = Object.fromEntries(await Promise.all(folders.map(async (f) => [f, await api.getModels(f)])));
  for (const f of folders) assert.deepEqual(lists[f], MODELS[f], f);
  const groups = groupModelFolders(folders, lists);
  assert.equal(totalModelCount(groups), Object.values(MODELS).reduce((n, l) => n + l.length, 0));
  assert.ok(groups.find((g) => g.folder === 'loras').count > 60, 'enough LoRAs for search to matter');
});

test('mock: userdata list + fetch round-trips a saved workflow that parses and queues', async () => {
  const list = parseUserdataList(await api.listUserdata('workflows', true));
  assert.deepEqual(
    list.map((w) => w.path).sort(),
    ['sd15_distiller_portrait.json', 'video/wan22_coastal_drive.json'],
  );
  assert.ok(list.every((w) => typeof w.size === 'number' && typeof w.modified === 'number'), 'full_info fields present');
  const nested = list.find((w) => w.path.startsWith('video/'));
  const raw = await api.getUserdata(userWorkflowPath(nested));
  const wf = parseWorkflow(raw, info);
  assert.equal(wf.nodes.length, 16);
  const { prompt } = graphToPrompt(wf);
  assert.ok(Object.values(prompt).some((n) => n.class_type === 'SaveVideo'));
  const res = await api.queuePrompt(prompt, 'test-client');
  assert.ok(res.prompt_id);
  await api.clearQueue();
});

test('mock: userdata errors — 404 unknown dir / file, 403 path escape', async () => {
  await assert.rejects(api.listUserdata('does-not-exist'), (e) => e.status === 404);
  await assert.rejects(api.getUserdata('workflows/nope.json'), (e) => e.status === 404);
  await assert.rejects(api.getUserdata('../package.json'), (e) => e.status === 403);
});

test('library store: refreshAll fills folders + modelLists + workflows, 404 dir is treated as empty, server switch resets', async () => {
  const lib = useLibraryStore.getState();
  await lib.refreshAll();
  let s = useLibraryStore.getState();
  assert.deepEqual(s.folders, Object.keys(MODELS));
  assert.equal(s.workflows.length, 2);
  assert.equal(s.foldersError, null);
  assert.equal(s.workflowsError, null);
  const lists = useServerStore.getState().modelLists;
  for (const f of Object.keys(MODELS)) assert.deepEqual(lists[f], MODELS[f], f);
  assert.deepEqual(await s.fetchWorkflow(s.workflows.find((w) => !w.path.includes('/'))), JSON.parse(JSON.stringify(await api.getUserdata('workflows/sd15_distiller_portrait.json'))));

  // Switching servers must not leave the previous server's library on screen.
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  useSettingsStore.getState().set({ serverUrl: 'http://127.0.0.1:9' });
  s = useLibraryStore.getState();
  assert.equal(s.folders, null);
  assert.equal(s.workflows, null);
  assert.deepEqual(useServerStore.getState().modelLists, {});
});
