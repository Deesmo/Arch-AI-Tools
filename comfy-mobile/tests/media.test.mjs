/**
 * Output classification: core `images` (+`animated`), VideoHelperSuite
 * `gifs`, SaveVideo `video`, custom-node `videos`, and `audio`.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFromOutput, mediaFromHistoryEntry } from '../src/core/media.ts';

const ref = (filename, extra = {}) => ({ filename, subfolder: '', type: 'output', ...extra });

test('SaveVideo `video` array is surfaced as video items', () => {
  const items = mediaFromOutput({ video: [ref('ComfyUI_00001_.mp4', { format: 'video/h264-mp4', frame_rate: 24 })] }, '9', 'p1');
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'video');
  assert.equal(items[0].frameRate, 24);
  assert.equal(items[0].nodeId, '9');
  assert.equal(items[0].promptId, 'p1');
  assert.match(items[0].url, /\/view\?/);
});

test('`videos`, `gifs`, `images` and `audio` keep working side by side', () => {
  const items = mediaFromOutput({
    images: [ref('frame.png'), ref('anim.webp')],
    animated: [false, true],
    gifs: [ref('vhs_00001.mp4', { format: 'video/h264-mp4' })],
    videos: [ref('custom.webm')],
    audio: [ref('voice.flac')],
  });
  assert.deepEqual(
    items.map((i) => [i.ref.filename, i.kind, i.animated]),
    [
      ['frame.png', 'image', false],
      ['anim.webp', 'image', true],
      ['vhs_00001.mp4', 'video', false],
      ['custom.webm', 'video', false],
      ['voice.flac', 'audio', false],
    ],
  );
});

test('entries without a filename are skipped and history entries flatten per node', () => {
  const entry = { outputs: { 1: { video: [{}] }, 2: { images: [ref('a.png')] } }, status: { completed: true } };
  const items = mediaFromHistoryEntry('p2', entry);
  assert.deepEqual(items.map((i) => [i.nodeId, i.ref.filename]), [['2', 'a.png']]);
});
