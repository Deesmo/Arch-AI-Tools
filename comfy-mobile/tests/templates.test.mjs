/**
 * Template round-trip: applyTemplate(values) -> readTemplateValues(workflow)
 * must return the same values, including params that are bound only through
 * a transform (seconds -> frames, half, +1). Guards the Studio "Reuse
 * settings" and Graph -> Studio sync paths.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInfo } from '../mock-server/object-info.mjs';
import { applyTemplate, readTemplateValues, defaultValues, getTemplate, allTemplates } from '../src/core/templates/index.ts';

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
