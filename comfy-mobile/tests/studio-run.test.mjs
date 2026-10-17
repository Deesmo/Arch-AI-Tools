/**
 * Run a My Studio card: parse the index fields, patch only the named widgets,
 * and load the workflow JSON from /studio-thumbs/.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectInfo } from '../mock-server/object-info.mjs';
import { parseStudioThumbIndex } from '../src/core/content/studioThumbs.ts';
import { SETTINGS_NOT_IN_BUILD, applyStudioRunEdits, loadStudioWorkflowFile, patchStudioRunFile } from '../src/core/content/studioRun.ts';
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
  assert.equal(calls[0].url, '/studio-thumbs/runs/night.json');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  await assert.rejects(() => loadStudioWorkflowFile('runs/missing.json', fetchImpl), { message: SETTINGS_NOT_IN_BUILD });
  await assert.rejects(() => loadStudioWorkflowFile('https://other.example/w.json', fetchImpl), { message: SETTINGS_NOT_IN_BUILD });
  assert.equal(calls.length, 2);
});
