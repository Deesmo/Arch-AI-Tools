/**
 * COMFY_DYNAMICCOMBO_V3 handling (ComfyUI V3 `io.DynamicCombo`, used by
 * SaveVideo.format/codec). The server addresses nested inputs by dotted path
 * (`{"rows": "on", "rows.x": 0.5}` in ComfyUI's dynamic_inputs_test.py) and
 * only the selected option's inputs are live; the official frontend stores
 * nested widget values flat after the parent in `widgets_values`.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInfo } from '../mock-server/object-info.mjs';
import { applyTemplate, defaultValues, getTemplate } from '../src/core/templates/index.ts';
import { graphToPrompt } from '../src/core/graph/prompt.ts';
import { createNode, setWidgetValue } from '../src/core/graph/model.ts';
import { parseWorkflow } from '../src/core/graph/serialize.ts';
import { emptyWorkflow } from '../src/core/graph/types.ts';
import { comboValues, isComboSpec, isWidgetInput, shapeFromDef } from '../src/core/graph/widgets.ts';

const info = buildObjectInfo();
const names = (node) => node.widgets.map((w) => w.name);

test('mock SaveVideo mirrors the real V3 schema (format/codec are COMFY_DYNAMICCOMBO_V3, codec hidden)', () => {
  const def = info.SaveVideo;
  assert.deepEqual(def.input_order, { required: ['video', 'filename_prefix', 'format'], optional: ['codec'] });
  assert.equal(def.input.required.format[0], 'COMFY_DYNAMICCOMBO_V3');
  assert.equal(def.input.optional.codec[0], 'COMFY_DYNAMICCOMBO_V3');
  assert.equal(def.input.optional.codec[1].hidden, true);
  assert.deepEqual(def.input.required.format[1].options.map((o) => o.key), ['auto', 'mp4', 'mkv', 'webm']);
  assert.deepEqual(Object.keys(def.input.required.format[1].options[0].inputs.required), ['codec']);
});

test('a dynamic combo spec is a widget whose values are options[].key', () => {
  const spec = info.SaveVideo.input.required.format;
  assert.equal(isComboSpec(spec), true);
  assert.equal(isWidgetInput(spec), true);
  assert.deepEqual(comboValues(spec), ['auto', 'mp4', 'mkv', 'webm']);
});

test('shapeFromDef expands the selected option; the hidden legacy codec is neither widget nor slot', () => {
  const shape = shapeFromDef(info.SaveVideo);
  assert.deepEqual(shape.widgets.map((w) => w.name), ['filename_prefix', 'format', 'format.codec']);
  assert.deepEqual(shape.widgetValues, ['video/ComfyUI', 'auto', 'auto']);
  assert.deepEqual(shape.inputs.map((s) => s.name), ['video']);
  const codec = shape.widgets[2];
  assert.equal(codec.label, 'codec');
  assert.equal(codec.kind, 'combo');
  assert.deepEqual(codec.options.values, ['auto', 'h264', 'av1']);
  assert.equal(shape.widgets[1].options.dynamic, true);
});

test('stored widgets_values drive the expansion (flat, parent then nested)', () => {
  const shape = shapeFromDef(info.SaveVideo, ['video/x', 'webm', 'av1', 're-encode', 30]);
  assert.deepEqual(
    shape.widgets.map((w) => w.name),
    ['filename_prefix', 'format', 'format.codec', 'format.codec.encoding', 'format.codec.encoding.crf'],
  );
  assert.deepEqual(shape.widgetValues, ['video/x', 'webm', 'av1', 're-encode', 30]);
  // webm only offers auto/av1
  assert.deepEqual(shape.widgets[2].options.values, ['auto', 'av1']);
});

test('the 3-value SaveVideo template lines up and the prompt carries format + format.codec', () => {
  const t = getTemplate('wan22-txt2video');
  const wf = applyTemplate(t, defaultValues(t, info), info);
  const save = wf.nodes.find((n) => n.type === 'SaveVideo');
  assert.deepEqual(names(save), ['filename_prefix', 'format', 'format.codec']);
  assert.deepEqual(save.widgets_values, ['video/ComfyUI', 'auto', 'auto']);
  const inputs = graphToPrompt(wf).prompt[String(save.id)].inputs;
  assert.deepEqual(inputs, { filename_prefix: 'video/ComfyUI', format: 'auto', 'format.codec': 'auto', video: [String(wf.nodes.find((n) => n.type === 'CreateVideo').id), 0] });
  assert.equal('codec' in inputs, false, 'hidden legacy codec must not be sent');
});

test('every video template that saves through SaveVideo sends format + format.codec', () => {
  for (const id of ['wan22-txt2video', 'wan22-img2video', 'ltx2-txt2video', 'ltx2-img2video', 'hunyuan15-txt2video']) {
    const t = getTemplate(id);
    const wf = applyTemplate(t, defaultValues(t, info), info);
    const save = wf.nodes.find((n) => n.type === 'SaveVideo');
    const inputs = graphToPrompt(wf).prompt[String(save.id)].inputs;
    assert.equal(inputs.format, 'auto', id);
    assert.equal(inputs['format.codec'], 'auto', id);
  }
});

test('changing the parent combo rebuilds the nested chain and resets stale nested values', () => {
  let wf = createNode(emptyWorkflow(), 'SaveVideo', [0, 0], info).wf;
  const id = wf.nodes[0].id;
  const node = () => wf.nodes.find((n) => n.id === id);

  wf = setWidgetValue(wf, id, 'format', 'webm', info);
  wf = setWidgetValue(wf, id, 'format.codec', 'av1', info);
  wf = setWidgetValue(wf, id, 'format.codec.encoding', 're-encode', info);
  assert.deepEqual(names(node()), ['filename_prefix', 'format', 'format.codec', 'format.codec.encoding', 'format.codec.encoding.crf']);
  assert.deepEqual(node().widgets_values, ['video/ComfyUI', 'webm', 'av1', 're-encode', 24]);
  assert.deepEqual(graphToPrompt(wf).prompt[String(id)].inputs, {
    filename_prefix: 'video/ComfyUI',
    format: 'webm',
    'format.codec': 'av1',
    'format.codec.encoding': 're-encode',
    'format.codec.encoding.crf': 24,
  });

  // Back to mp4: nested values under `format` start over at the option's defaults,
  // unrelated widgets keep their values.
  wf = setWidgetValue(wf, id, 'filename_prefix', 'video/keep', info);
  wf = setWidgetValue(wf, id, 'format', 'mp4', info);
  assert.deepEqual(names(node()), ['filename_prefix', 'format', 'format.codec']);
  assert.deepEqual(node().widgets_values, ['video/keep', 'mp4', 'auto']);

  // Same value again is a no-op for the shape.
  const before = node();
  wf = setWidgetValue(wf, id, 'format', 'mp4', info);
  assert.deepEqual(node().widgets_values, before.widgets_values);
});

test('setWidgetValue without object_info still stores the value (no reshape possible)', () => {
  let wf = createNode(emptyWorkflow(), 'SaveVideo', [0, 0], info).wf;
  const id = wf.nodes[0].id;
  wf = setWidgetValue(wf, id, 'format', 'mkv');
  assert.deepEqual(wf.nodes[0].widgets_values, ['video/ComfyUI', 'mkv', 'auto']);
});

test('object_info arriving later re-shapes a SaveVideo loaded from workflow JSON', () => {
  const json = {
    nodes: [{ id: 1, type: 'SaveVideo', pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, inputs: [{ name: 'video', type: 'VIDEO', link: null }], outputs: [], properties: {}, widgets_values: ['video/ComfyUI', 'mkv', 'h264', 'auto'] }],
    links: [],
  };
  const cold = parseWorkflow(json, null);
  assert.equal(cold.nodes[0].missing, false);
  const warm = parseWorkflow(json, info);
  assert.deepEqual(names(warm.nodes[0]), ['filename_prefix', 'format', 'format.codec', 'format.codec.encoding']);
  assert.deepEqual(warm.nodes[0].widgets_values, ['video/ComfyUI', 'mkv', 'h264', 'auto']);
});

test('CreateVideo: V3 combo with non-string choices is sent with the server type', () => {
  const t = getTemplate('wan22-txt2video');
  let wf = applyTemplate(t, defaultValues(t, info), info);
  const cv = wf.nodes.find((n) => n.type === 'CreateVideo');
  assert.deepEqual(names(cv), ['fps', 'bit_depth', 'color_space', 'codec']);
  assert.deepEqual(cv.widgets_values, [16, 'auto', 'sRGB', 'none']);
  assert.deepEqual(cv.widgets[1].options.values, ['auto', '8', '10']);
  assert.deepEqual(cv.widgets[1].options.rawValues, ['auto', 8, 10]);
  wf = setWidgetValue(wf, cv.id, 'bit_depth', '10', info);
  const inputs = graphToPrompt(wf).prompt[String(cv.id)].inputs;
  assert.equal(inputs.bit_depth, 10);
  assert.equal(typeof inputs.bit_depth, 'number');
  assert.equal(inputs.color_space, 'sRGB');
  assert.equal(inputs.codec, 'none');
});
