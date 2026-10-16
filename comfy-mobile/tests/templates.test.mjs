/**
 * Template round-trip: applyTemplate(values) -> readTemplateValues(workflow)
 * must return the same values, including params that are bound only through
 * a transform (seconds -> frames, half, +1). Guards the Studio "Reuse
 * settings" and Graph -> Studio sync paths.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInfo, MODELS } from '../mock-server/object-info.mjs';
import {
  applyTemplate,
  readTemplateValues,
  defaultValues,
  bakedValues,
  getTemplate,
  allTemplates,
  missingReferenceInputs,
  serverModelDefault,
  validateTemplate,
} from '../src/core/templates/index.ts';
import { graphToPrompt } from '../src/core/graph/prompt.ts';

const info = buildObjectInfo();

test('every bundled template round-trips its default values', () => {
  for (const t of allTemplates()) {
    const values = defaultValues(t, info);
    const back = readTemplateValues(t, applyTemplate(t, values, info));
    for (const p of t.params) {
      if (values[p.key] === undefined) continue;
      assert.equal(String(back[p.key]), String(values[p.key]), `${t.id}.${p.key}`);
    }
  }
});

test('Wan 2.2 dual-sampler template round-trips custom values (half-split steps)', () => {
  const t = getTemplate('wan22-txt2video');
  const input = { ...defaultValues(t, info), steps: 8, cfg: 1, fps: 24, frames: 49, width: 1280, height: 720, lightning: true, shift: 5 };
  const back = readTemplateValues(t, applyTemplate(t, input, info));
  for (const k of ['steps', 'cfg', 'fps', 'frames', 'width', 'height', 'lightning', 'shift']) {
    assert.equal(String(back[k]), String(input[k]), k);
  }
});

test('params whose only binding is transformed are inverted on read-back', () => {
  const base = getTemplate('wan22-txt2video');
  const t = {
    ...base,
    params: [
      { key: 'fps', label: 'FPS', type: 'number', bindings: [{ node: { id: 12 }, widget: 'fps' }] },
      { key: 'duration', label: 'Seconds', type: 'number', bindings: [{ node: { id: 8 }, widget: 'length', transform: 'seconds_to_frames' }] },
      { key: 'steps_half', label: 'Half', type: 'number', bindings: [{ node: { id: 9 }, widget: 'end_at_step', transform: 'half' }] },
      { key: 'frames_p1', label: 'Plus one', type: 'number', bindings: [{ node: { id: 10 }, widget: 'start_at_step', transform: 'frames_plus_one' }] },
    ],
  };
  const input = { fps: 16, duration: 5, steps_half: 20, frames_p1: 3 };
  const back = readTemplateValues(t, applyTemplate(t, input, info));
  assert.deepEqual(back, input);
});

test('a transformed first binding does not shadow a later plain binding', () => {
  const base = getTemplate('wan22-txt2video');
  const t = {
    ...base,
    params: [
      {
        key: 'steps',
        label: 'Steps',
        type: 'number',
        bindings: [
          { node: { id: 9 }, widget: 'end_at_step', transform: 'half' },
          { node: { id: 9 }, widget: 'steps' },
        ],
      },
    ],
  };
  const back = readTemplateValues(t, applyTemplate(t, { steps: 7 }, info));
  // 7 -> half = round(3.5) = 4 -> *2 = 8 would be wrong; the plain binding must win.
  assert.equal(back.steps, 7);
});

// ---------------------------------------------------------------------------
// Template widget arrays vs the real node schemas (ComfyUI 0.38)
// ---------------------------------------------------------------------------

test('CreateVideo templates spell out all four widgets [fps, bit_depth, color_space, codec]', () => {
  const expectedFps = { 'wan22-txt2video': 16, 'wan22-img2video': 16, 'ltx2-txt2video': 24, 'ltx2-img2video': 24, 'hunyuan15-txt2video': 24 };
  for (const [id, fps] of Object.entries(expectedFps)) {
    const node = getTemplate(id).workflow.nodes.find((n) => n.type === 'CreateVideo');
    assert.deepEqual(node.widgets_values, [fps, 'auto', 'sRGB', 'none'], id);
    const wf = applyTemplate(getTemplate(id), defaultValues(getTemplate(id), info), info);
    const live = wf.nodes.find((n) => n.type === 'CreateVideo');
    assert.equal(live.widgets.length, live.widgets_values.length, `${id}: one value per widget`);
    assert.deepEqual(graphToPrompt(wf).prompt[String(live.id)].inputs.fps, fps, id);
  }
});

test('LoadImage templates carry a single, empty image value (no legacy 2nd entry, no example.png)', () => {
  for (const t of allTemplates()) {
    for (const node of t.workflow.nodes.filter((n) => n.type === 'LoadImage')) {
      assert.deepEqual(node.widgets_values, [''], `${t.id} node ${node.id}`);
    }
  }
  for (const id of ['wan22-img2video', 'ltx2-img2video', 'default-img2img']) {
    assert.equal(defaultValues(getTemplate(id), info).image, '', id);
  }
});

test('missingReferenceInputs: empty or unknown reference files block, server files and fresh uploads pass', () => {
  const t = getTemplate('wan22-img2video');
  const base = defaultValues(t, info);
  // Unknown until object_info is loaded
  assert.deepEqual(missingReferenceInputs(t, base, null), []);
  // Nothing chosen yet
  let missing = missingReferenceInputs(t, base, info);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].param.key, 'image');
  assert.equal(missing[0].value, '');
  // A stale default the server does not have (what the old templates shipped)
  missing = missingReferenceInputs(t, { ...base, image: 'not-there.png' }, info);
  assert.deepEqual(missing.map((m) => m.value), ['not-there.png']);
  // A file in the server's LoadImage combo (its input folder at connect time)
  assert.deepEqual(missingReferenceInputs(t, { ...base, image: 'example.png' }, info), []);
  // A file uploaded this session, not yet in the object_info snapshot
  assert.deepEqual(missingReferenceInputs(t, { ...base, image: 'phone-shot.jpg' }, info, ['phone-shot.jpg']), []);
  // Text-to-video templates have nothing to upload
  assert.deepEqual(missingReferenceInputs(getTemplate('wan22-txt2video'), {}, info), []);
});

// ---------------------------------------------------------------------------
// Server-aware model defaults
// ---------------------------------------------------------------------------

test('image templates default ckpt_name to the first server checkpoint when the baked one is absent', () => {
  const skytechLike = { checkpoints: ['NoobAI-XL-Vpred-v1.0.safetensors', 'flux1-schnell-fp8.safetensors', 'ltx-2.3-22b-dev-fp8.safetensors'] };
  for (const id of ['default-txt2img', 'default-img2img']) {
    const t = getTemplate(id);
    assert.equal(bakedValues(t, info).model, 'v1-5-pruned-emaonly.safetensors', `${id} baked`);
    const values = defaultValues(t, info, skytechLike);
    assert.equal(values.model, 'NoobAI-XL-Vpred-v1.0.safetensors', `${id} falls back to the first /models/checkpoints entry`);
    const wf = applyTemplate(t, values, info);
    const ckpt = wf.nodes.find((n) => n.type === 'CheckpointLoaderSimple');
    assert.equal(graphToPrompt(wf).prompt[String(ckpt.id)].inputs.ckpt_name, 'NoobAI-XL-Vpred-v1.0.safetensors');
    // The amber "model not found" badge follows the effective value, not the baked file.
    const v = validateTemplate(t, info, skytechLike, values);
    assert.deepEqual(v.missingModels, [], `${id} validation`);
  }
});

test('the baked checkpoint is kept when the server has it, and without a list the widget combo decides', () => {
  const t = getTemplate('default-txt2img');
  // Mock server has v1-5 on disk (and in the CheckpointLoaderSimple combo)
  assert.equal(defaultValues(t, info, { checkpoints: MODELS.checkpoints }).model, 'v1-5-pruned-emaonly.safetensors');
  assert.equal(defaultValues(t, info).model, 'v1-5-pruned-emaonly.safetensors');
  // Not connected: nothing to compare against, no substitution
  const modelParam = t.params.find((p) => p.key === 'model');
  assert.equal(serverModelDefault(modelParam, t, 'v1-5-pruned-emaonly.safetensors', null, { checkpoints: ['other.safetensors'] }), undefined);
  // Empty folder on the server: nothing sensible to pick, keep the baked value
  assert.equal(defaultValues(t, info, { checkpoints: [] }).model, 'v1-5-pruned-emaonly.safetensors');
});

test('video templates whose files exist on the server are untouched by the model fallback', () => {
  const lists = Object.fromEntries(Object.entries(MODELS));
  for (const id of ['wan22-txt2video', 'ltx2-txt2video', 'hunyuan15-txt2video']) {
    const t = getTemplate(id);
    assert.deepEqual(defaultValues(t, info, lists), bakedValues(t, info), id);
    assert.deepEqual(validateTemplate(t, info, lists, defaultValues(t, info, lists)).missingModels, [], id);
  }
});

test('validateTemplate without values still reports the baked file (legacy callers)', () => {
  const t = getTemplate('default-txt2img');
  const v = validateTemplate(t, info, { checkpoints: ['other.safetensors'] });
  assert.deepEqual(v.missingModels, [{ folder: 'checkpoints', file: 'v1-5-pruned-emaonly.safetensors' }]);
  // With values pointing at a file that is also missing, the effective file is reported.
  const v2 = validateTemplate(t, info, { checkpoints: ['other.safetensors'] }, { model: 'gone.safetensors' });
  assert.deepEqual(v2.missingModels, [{ folder: 'checkpoints', file: 'gone.safetensors' }]);
});
