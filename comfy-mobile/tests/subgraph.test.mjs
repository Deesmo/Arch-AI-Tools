/**
 * Subgraph expansion when building the API prompt.
 *
 * ComfyUI's frontend serialises subgraphs as `definitions.subgraphs[]` and
 * places instance nodes whose `type` is the definition's UUID. The server
 * never sees that UUID: the frontend flattens instances into concrete nodes
 * with `instanceId:innerId` ids before POST /prompt. Posting the UI graph
 * unexpanded leaves a hole where the instance was, and the server fails with
 * `Exception when validating node: '117'` / `KeyError('117')`.
 */
import './browser-stubs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildObjectInfo } from '../mock-server/object-info.mjs';
import { graphToPrompt, unexpandedMessage } from '../src/core/graph/prompt.ts';
import { exportWorkflow, parseWorkflow } from '../src/core/graph/serialize.ts';
import { SUBGRAPH_TYPE_RE } from '../src/core/graph/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures', 'subgraph-system-settings.json');
const SUBGRAPH_ID = 'e77fc8b8-0940-4c2c-bf84-656a62159ae1';

const info = buildObjectInfo();
const loadFixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'));

test('fixture: one subgraph instance (node 117, "System Settings") typed by its definition UUID', () => {
  const raw = loadFixture();
  const inst = raw.nodes.find((n) => n.id === 117);
  assert.equal(inst.type, SUBGRAPH_ID);
  assert.match(inst.type, SUBGRAPH_TYPE_RE);
  assert.equal(raw.definitions.subgraphs.length, 1);
  assert.equal(raw.definitions.subgraphs[0].name, 'System Settings');
  assert.equal(SUBGRAPH_ID in info, false, 'the UUID is not a server class');
});

test('parseWorkflow keeps definitions and does not flag the instance as a missing node', () => {
  const wf = parseWorkflow(loadFixture(), info);
  assert.equal(wf.definitions?.subgraphs.length, 1);
  const def = wf.definitions.subgraphs[0];
  assert.equal(def.id, SUBGRAPH_ID);
  assert.deepEqual(def.nodes.map((n) => n.type), ['KSampler', 'VAEDecode']);
  assert.equal(def.links.length, 8);
  assert.deepEqual(def.inputs.map((i) => i.name), ['model', 'positive', 'negative', 'latent', 'vae', 'steps']);
  const inst = wf.nodes.find((n) => n.id === 117);
  assert.equal(inst.missing, false);
  // Inner nodes are resolved against object_info like root nodes.
  assert.equal(def.nodes[0].missing, false);
  assert.ok(def.nodes[0].widgets.some((w) => w.name === 'steps'));
});

test('queued prompt contains only real class types — no UUID class_type, no hole where the instance was', () => {
  const wf = parseWorkflow(loadFixture(), info);
  const { prompt, expanded, unexpanded } = graphToPrompt(wf);

  assert.deepEqual(unexpanded, []);
  assert.deepEqual(expanded, [{ id: '117', name: 'System Settings', nodes: 2 }]);

  for (const [id, node] of Object.entries(prompt)) {
    assert.doesNotMatch(node.class_type, SUBGRAPH_TYPE_RE, `${id} has a UUID class_type`);
    assert.ok(node.class_type in info, `${id}: ${node.class_type} is not in object_info`);
  }
  assert.equal('117' in prompt, false, 'the instance itself is never sent');
  assert.deepEqual(Object.keys(prompt).sort(), ['117:5', '117:6', '219', '4', '5', '6', '7']);

  // Every link target exists in the prompt (this is exactly what the server validates).
  for (const [id, node] of Object.entries(prompt)) {
    for (const [key, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') {
        assert.ok(v[0] in prompt, `${id}.${key} points at missing node ${v[0]}`);
      }
    }
  }
});

test('links are rewired across the subgraph boundary and widgets carried through', () => {
  const wf = parseWorkflow(loadFixture(), info);
  const { prompt } = graphToPrompt(wf);

  // Outer consumer → inner producer (PreviewImage 219 ← VAEDecode inside 117).
  assert.deepEqual(prompt['219'].inputs.images, ['117:6', 0]);

  // Inner consumers → outer producers through the subgraph's input node (-10).
  const ks = prompt['117:5'];
  assert.equal(ks.class_type, 'KSampler');
  assert.deepEqual(ks.inputs.model, ['4', 0]);
  assert.deepEqual(ks.inputs.positive, ['6', 0]);
  assert.deepEqual(ks.inputs.negative, ['7', 0]);
  assert.deepEqual(ks.inputs.latent_image, ['5', 0]);
  assert.deepEqual(prompt['117:6'].inputs.vae, ['4', 2]);
  assert.deepEqual(prompt['117:6'].inputs.samples, ['117:5', 0]);

  // Promoted widget on the instance (steps=30) overrides the inner default (20).
  assert.equal(ks.inputs.steps, 30);
  // The inner node's own widgets are still sent; control widgets are not.
  assert.equal(ks.inputs.cfg, 7.5);
  assert.equal(ks.inputs.sampler_name, 'dpmpp_2m');
  assert.equal(ks.inputs.scheduler, 'karras');
  assert.equal(ks.inputs.seed, 156680208700286);
  assert.equal('seed_control' in ks.inputs, false);

  // Titles name the subgraph so the queue history reads sensibly.
  assert.equal(ks._meta.title, 'System Settings › KSampler');
});

test('a linked promoted input wins over the instance widget value', () => {
  const raw = loadFixture();
  // Feed "steps" from a PrimitiveNode on the outside.
  raw.nodes.push({
    id: 300,
    type: 'PrimitiveNode',
    pos: [600, 800],
    size: [210, 82],
    flags: {},
    order: 6,
    mode: 0,
    inputs: [],
    outputs: [{ name: 'INT', type: 'INT', links: [40], widget: { name: 'steps' } }],
    properties: {},
    widgets_values: [12, 'fixed'],
  });
  raw.nodes.find((n) => n.id === 117).inputs[5].link = 40;
  raw.links.push([40, 300, 0, 117, 5, 'INT']);
  const { prompt } = graphToPrompt(parseWorkflow(raw, info));
  assert.equal(prompt['117:5'].inputs.steps, 12);
  assert.equal('300' in prompt, false, 'PrimitiveNode is virtual');
});

test('nested subgraphs flatten to instance:inner:inner ids', () => {
  const raw = loadFixture();
  const inner = raw.definitions.subgraphs[0];
  // Wrap the "System Settings" instance in an outer subgraph "Pipeline" with the same slots.
  const OUTER = 'f0e1d2c3-b4a5-4687-9abc-def012345678';
  const outer = {
    id: OUTER,
    name: 'Pipeline',
    version: 1,
    state: {},
    config: {},
    inputNode: { id: -10 },
    outputNode: { id: -20 },
    inputs: inner.inputs.map((i, k) => ({ ...i, id: `o${k}`, linkIds: [100 + k] })),
    outputs: [{ id: 'oo', name: 'IMAGE', type: 'IMAGE', linkIds: [120] }],
    nodes: [
      {
        ...raw.nodes.find((n) => n.id === 117),
        id: 9,
        inputs: inner.inputs.map((i, k) => ({ name: i.name, type: i.type, link: 100 + k, ...(i.name === 'steps' ? { widget: { name: 'steps' } } : {}) })),
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [120] }],
        widgets_values: [45],
      },
    ],
    links: [...inner.inputs.map((i, k) => [100 + k, -10, k, 9, k, i.type]), [120, 9, 0, -20, 0, 'IMAGE']],
  };
  raw.definitions.subgraphs.push(outer);
  const rootInst = raw.nodes.find((n) => n.id === 117);
  rootInst.type = OUTER;
  rootInst.title = 'Pipeline';
  rootInst.inputs[5].link = null;

  const { prompt, expanded, unexpanded } = graphToPrompt(parseWorkflow(raw, info));
  assert.deepEqual(unexpanded, []);
  assert.deepEqual(
    expanded.map((e) => e.id),
    ['117', '117:9'],
  );
  assert.deepEqual(Object.keys(prompt).sort(), ['117:9:5', '117:9:6', '219', '4', '5', '6', '7']);
  assert.deepEqual(prompt['219'].inputs.images, ['117:9:6', 0]);
  assert.deepEqual(prompt['117:9:5'].inputs.model, ['4', 0]);
  // The outermost promoted value (root instance steps=30) drives the chain.
  assert.equal(prompt['117:9:5'].inputs.steps, 30);
  assert.equal(prompt['117:9:5']._meta.title, 'System Settings › KSampler');
  for (const node of Object.values(prompt)) assert.ok(node.class_type in info);

  // With no value on the root instance, the nearest instance's promoted value (45) applies.
  rootInst.widgets_values = [];
  assert.equal(graphToPrompt(parseWorkflow(raw, info)).prompt['117:9:5'].inputs.steps, 45);
});

test('missing definition: nothing is queued and the error names the subgraph, not the node id', () => {
  const raw = loadFixture();
  delete raw.definitions;
  const wf = parseWorkflow(raw, info);
  const { prompt, unexpanded } = graphToPrompt(wf);

  assert.equal(unexpanded.length, 1);
  assert.deepEqual(unexpanded[0], { id: '117', type: SUBGRAPH_ID, name: 'System Settings' });
  assert.equal('117' in prompt, false);
  for (const node of Object.values(prompt)) assert.doesNotMatch(node.class_type, SUBGRAPH_TYPE_RE);

  const msg = unexpandedMessage(unexpanded);
  assert.ok(msg.startsWith("Can't run this yet — subgraph System Settings didn't expand"), msg);
  assert.equal(msg.includes("'117'"), false);
  assert.equal(msg.includes(SUBGRAPH_ID), false);
});

test('an untitled unexpanded instance falls back to its UUID so the error is still actionable', () => {
  const raw = loadFixture();
  delete raw.definitions;
  delete raw.nodes.find((n) => n.id === 117).title;
  const { unexpanded } = graphToPrompt(parseWorkflow(raw, info));
  assert.equal(unexpanded[0].name, SUBGRAPH_ID);
  assert.ok(unexpandedMessage(unexpanded).includes(SUBGRAPH_ID));
});

test('a muted instance is skipped, not reported as unexpanded', () => {
  const raw = loadFixture();
  raw.nodes.find((n) => n.id === 117).mode = 2;
  const { prompt, skipped, unexpanded, expanded } = graphToPrompt(parseWorkflow(raw, info));
  assert.deepEqual(unexpanded, []);
  assert.deepEqual(expanded, []);
  assert.ok(skipped.includes('117'));
  assert.equal('117:5' in prompt, false);
  // PreviewImage loses its input; the server reports that one as a required-input error.
  assert.equal('images' in prompt['219'].inputs, false);
});

test('exportWorkflow round-trips definitions.subgraphs with their extra keys', () => {
  const raw = loadFixture();
  const wf = parseWorkflow(raw, info);
  const out = exportWorkflow(wf);
  assert.equal(out.definitions.subgraphs.length, 1);
  const def = out.definitions.subgraphs[0];
  assert.equal(def.id, SUBGRAPH_ID);
  assert.equal(def.name, 'System Settings');
  assert.deepEqual(def.inputNode, raw.definitions.subgraphs[0].inputNode);
  assert.deepEqual(def.state, raw.definitions.subgraphs[0].state);
  assert.deepEqual(def.links, raw.definitions.subgraphs[0].links);
  assert.deepEqual(def.inputs.map((i) => [i.id, i.name, i.type, i.linkIds]), raw.definitions.subgraphs[0].inputs.map((i) => [i.id, i.name, i.type, i.linkIds]));
  assert.deepEqual(def.nodes.map((n) => [n.id, n.type]), [[5, 'KSampler'], [6, 'VAEDecode']]);
  assert.equal('widgets' in def.nodes[0], false, 'derived widget defs are not serialised');
  assert.equal(out.nodes.find((n) => n.id === 117).type, SUBGRAPH_ID);

  // Re-parsing the export builds the same prompt.
  const again = graphToPrompt(parseWorkflow(JSON.parse(JSON.stringify(out)), info));
  assert.deepEqual(again.prompt, graphToPrompt(wf).prompt);
});
