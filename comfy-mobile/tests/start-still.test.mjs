/**
 * Start stills: one closed image graph per author scene, for every copy card
 * and workflow run. A link to a node that is not in the graph fails the test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJobFile } from '../src/core/content/studioRun.ts';
import { authorGenerateSteps } from '../src/core/content/inCardGenerate.ts';
import { buildStartStills, collectStartStills, scenesInAuthorPrompt } from '../src/core/content/startStill.ts';

const root = new URL('../public/studio-thumbs/', import.meta.url);
const TEXT = 'nude adult woman, bare breasts, explicit, on a hotel balcony at night';
const DEMO = /red dress|stands by the window|soft daylight|score_9, score_8_up/;

function load(name) {
  return parseJobFile(readFileSync(new URL(name, root), 'utf8'));
}

function missingLinks(prompt) {
  const bad = [];
  for (const [id, node] of Object.entries(prompt)) {
    for (const [field, value] of Object.entries(node.inputs ?? {})) {
      if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'number' && !prompt[value[0]]) {
        bad.push(`${id}.${field}->${value[0]}`);
      }
    }
  }
  return bad;
}

function fileNames(prompt) {
  const found = [];
  const walk = (value, key) => {
    if (typeof value === 'string' && key && /unet|ckpt|model|lora/i.test(key) && /\.(safetensors|ckpt|gguf|sft)$/i.test(value)) {
      found.push(value.split(/[/\\]/).pop());
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
    }
  };
  for (const node of Object.values(prompt)) walk(node.inputs, '');
  return found;
}

function base(file) {
  return file.split(/[/\\]/).pop();
}

test('balcony stills use each step engine and LoRAs, one graph per scene', () => {
  const raw = load('runs/c-137836687.json');
  const steps = authorGenerateSteps(raw);
  const stills = buildStartStills(raw, TEXT, 42);
  const expected = steps.reduce((sum, step) => sum + scenesInAuthorPrompt(step.authorPrompt), 0);
  assert.equal(scenesInAuthorPrompt(steps[0].authorPrompt), 1);
  assert.equal(scenesInAuthorPrompt(steps[1].authorPrompt), 4);
  assert.equal(stills.length, expected);
  assert.equal(stills.length, 5);

  const image = stills[0];
  assert.equal(image.kind, 'image');
  assert.equal(image.engine, 'Pony');
  assert.equal(image.nsfw, true);
  assert.equal(image.text, TEXT);
  assert.equal(image.scene, 1);
  assert.equal(image.prompt[steps[0].nodeId].inputs[steps[0].field], TEXT);
  const imageFiles = fileNames(image.prompt);
  assert.ok(imageFiles.some((file) => file.toLowerCase().includes('pony') && !/lora/i.test(file)));
  assert.ok(image.loras.some((lora) => imageFiles.includes(base(lora.file))));
  assert.equal(imageFiles.some((file) => file.toLowerCase().includes('sulphur')), false);
  assert.deepEqual(missingLinks(image.prompt), []);
  assert.ok(image.prompt.incard_save);

  for (const still of stills.slice(1)) {
    assert.equal(still.kind, 'video');
    assert.equal(still.engine, 'Sulphur');
    assert.equal(still.nsfw, true);
    assert.equal(still.text, TEXT);
    assert.equal(still.prompt[steps[1].nodeId].inputs[steps[1].field], TEXT);
    const files = fileNames(still.prompt);
    assert.ok(files.some((file) => file.toLowerCase().includes('sulphur')));
    for (const lora of still.loras) assert.ok(files.includes(base(lora.file)), lora.file);
    assert.equal(files.includes(base(steps[0].engineFile)), false);
    assert.deepEqual(missingLinks(still.prompt), []);
    assert.doesNotMatch(JSON.stringify(still.prompt), DEMO);
  }
  assert.doesNotMatch(JSON.stringify(image.prompt), DEMO);
});

test('every copy card and workflow run returns a closed still per scene', () => {
  const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
  const named = new Map();
  for (const row of [...index.copies, ...index.workflows]) {
    if (!row.workflowFile) continue;
    const file = row.workflowFile.replace(/^.*studio-thumbs\//, '');
    named.set(file, row);
  }
  for (const file of readdirSync(new URL('runs/', root))) {
    if (file.endsWith('.json')) named.set(`runs/${file}`, named.get(`runs/${file}`) ?? { name: file });
  }

  const failures = [];
  const notes = [];
  let graphs = 0;
  let cards = 0;
  for (const [file, row] of named) {
    let raw;
    try {
      raw = load(file);
    } catch (err) {
      failures.push(`${file} unreadable: ${err.message}`);
      continue;
    }
    const steps = authorGenerateSteps(raw);
    let stills;
    let skipped;
    try {
      const built = collectStartStills(raw, TEXT, 7);
      stills = built.stills;
      skipped = built.skipped;
    } catch (err) {
      failures.push(`${file} ${row.name ?? ''}: ${err.message}`);
      continue;
    }
    const expected = steps.reduce((sum, step) => sum + scenesInAuthorPrompt(step.authorPrompt), 0);
    if (stills.length + skipped.length !== expected) {
      failures.push(`${file} returned ${stills.length} stills and skipped ${skipped.length}, author scenes ${expected}`);
      continue;
    }
    for (const skip of skipped) notes.push(`${file} ${row.name ?? ''} ${skip.stepId} scene ${skip.scene}: ${skip.reason}`);
    if (!stills.length) continue;
    cards += 1;
    const engineFiles = steps.map((step) => (step.engineFile ? base(step.engineFile) : '')).filter(Boolean);
    for (const still of stills) {
      graphs += 1;
      const step = steps.find((item) => item.id === still.stepId);
      const bad = missingLinks(still.prompt);
      if (bad.length) failures.push(`${file} ${still.stepId} scene ${still.scene} broken ${bad.slice(0, 4).join(', ')}`);
      if (!still.prompt.incard_save) failures.push(`${file} ${still.stepId} has no SaveImage`);
      if (still.nsfw !== true) failures.push(`${file} ${still.stepId} is not NSFW`);
      if (still.text !== TEXT) failures.push(`${file} ${still.stepId} dropped the rewritten sentence`);
      const written = step ? still.prompt[step.nodeId]?.inputs?.[step.field] : undefined;
      if (written !== TEXT) failures.push(`${file} ${still.stepId} text was ${JSON.stringify(written)?.slice(0, 80)}`);
      const files = fileNames(still.prompt);
      if (step?.engineFile && !files.includes(base(step.engineFile))) {
        notes.push(`${file} ${still.stepId} scene ${still.scene}: missing engine ${base(step.engineFile)}`);
      }
      for (const lora of step?.loras ?? []) {
        if (!files.includes(base(lora.file))) notes.push(`${file} ${still.stepId} scene ${still.scene}: missing LoRA ${base(lora.file)}`);
      }
      for (const other of engineFiles) {
        if (!step?.engineFile || other === base(step.engineFile)) continue;
        if (files.includes(other)) failures.push(`${file} ${still.stepId} pulled the other engine ${other}`);
      }
      if (scenesInAuthorPrompt(step?.authorPrompt ?? '') > 1 && still.scene < 1) {
        failures.push(`${file} ${still.stepId} collapsed a multi-scene prompt`);
      }
    }
  }
  assert.equal(failures.length, 0, failures.slice(0, 12).join('\n'));
  assert.ok(cards > 100, `only ${cards} cards produced stills`);
  assert.ok(graphs > cards, `graphs ${graphs} cards ${cards}`);
  assert.equal(notes.length, 6, notes.slice(0, 8).join('\n'));
});
