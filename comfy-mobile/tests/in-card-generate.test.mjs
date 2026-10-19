/**
 * In-card generate: author-format rewrite, one still per step, full graph kept.
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJobFile } from '../src/core/content/studioRun.ts';
import {
  applyApprovedRun,
  applyMatchedLora,
  authorGenerateSteps,
  buildStepStill,
  describeWorkflow,
  publishedImageNegative,
  rewriteInAuthorStyle,
  spokenLines,
} from '../src/core/content/inCardGenerate.ts';
import { matchPromptLora } from '../src/core/content/promptLora.ts';

const root = new URL('../public/studio-thumbs/runs/', import.meta.url);

function load(name) {
  return parseJobFile(readFileSync(new URL(name, root), 'utf8'));
}

const balcony = load('c-137836687.json');
const h3 = load('c-144131390.json');
const WORDS = 'nude adult woman, bare breasts, explicit, on a hotel balcony at night';

test('balcony card has an image step then a video step, with the author LoRAs', () => {
  const steps = authorGenerateSteps(balcony);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].kind, 'image');
  assert.equal(steps[0].engine, 'Pony');
  assert.ok(steps[0].loras.some((lora) => lora.file.includes('PonyV7base')));
  assert.equal(steps[1].kind, 'video');
  assert.equal(steps[1].engine, 'Sulphur');
  const files = steps[1].loras.map((lora) => lora.file).join(' ');
  assert.match(files, /ltx_2\.3_22b_distilled/);
  assert.match(files, /gemma-3-12b-it-abliterated/);
});

test('rewrite waits for words and keeps the author format', () => {
  const steps = authorGenerateSteps(balcony);
  assert.equal(rewriteInAuthorStyle(steps[0].authorPrompt, '', 0), steps[0].authorPrompt);
  const once = rewriteInAuthorStyle(steps[0].authorPrompt, WORDS, 0, { kind: 'image', engine: steps[0].engine });
  const twice = rewriteInAuthorStyle(steps[0].authorPrompt, WORDS, 1, { kind: 'image', engine: steps[0].engine });
  assert.match(once, /score_9, score_8_up, score_7_up, BREAK,/);
  assert.match(once, /nude adult female/);
  assert.match(once, /bare breasts/);
  assert.match(once, /explicit/);
  assert.notEqual(once, twice);
  assert.doesNotMatch(once, /sports bra/);
  assert.doesNotMatch(once, /red dress/);
  assert.doesNotMatch(once, /stands by the window/);
  const video = rewriteInAuthorStyle(steps[1].authorPrompt, WORDS, 0, { kind: 'video', engine: steps[1].engine });
  assert.match(video, /0-3s: She starts bouncing her ass/);
  assert.match(video, /bounces faster/);
  assert.match(video, /look back/);
  assert.match(video, /slow sensual hip movements/);
  assert.doesNotMatch(video, /sports bra|thong/);
});

test('a sulphur clip with time beats stays one prompt and keeps the author actions', () => {
  const step = authorGenerateSteps(balcony)[1];
  const video = rewriteInAuthorStyle(step.authorPrompt, WORDS, 0, { kind: 'video', engine: 'Sulphur' });
  const again = rewriteInAuthorStyle(step.authorPrompt, WORDS, 1, { kind: 'video', engine: 'Sulphur' });
  assert.equal(authorGenerateSteps(balcony).length, 2);
  assert.equal(video, again);
  assert.match(video, new RegExp(`^${WORDS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Immediate action\\.`));
  assert.match(video, /0-3s:/);
  assert.match(video, /3-7s:/);
  assert.match(video, /7-11s:/);
  assert.match(video, /11-15s:/);
  assert.match(video, /bouncing her ass firmly/);
  assert.match(video, /bounces faster/);
  assert.match(video, /look back/);
  assert.match(video, /slow sensual hip movements/);
  assert.doesNotMatch(video, /sports bra|black lace thong|Blonde/);
  assert.equal(video.split(/0-3s:/).length, 2);
});

test('H3 video rewrite uses the published fields and keeps the user quote', () => {
  const steps = authorGenerateSteps(h3);
  const step = steps.find((item) => item.kind === 'video') ?? steps[0];
  const rewritten = rewriteInAuthorStyle(step.authorPrompt, 'explicit nude woman in a steamy bathroom', 0, { kind: 'video', engine: step.engine });
  assert.match(rewritten, /integrated_multimodal_description:/);
  assert.match(rewritten, /\[Shot 1\]/);
  assert.match(rewritten, /explicit nude woman in a steamy bathroom/);
  assert.match(rewritten, /For the target video/);
  assert.doesNotMatch(rewritten, /Weren't you taught/);
  assert.doesNotMatch(rewritten, /<d>/);
  const swapped = rewriteInAuthorStyle(step.authorPrompt, 'explicit nude woman. she says "knock first"', 0, { kind: 'video', engine: step.engine });
  assert.match(swapped, /<d>\[English\] knock first<\/d>/);
  const rolled = rewriteInAuthorStyle(step.authorPrompt, 'explicit nude woman in a steamy bathroom', 1, { kind: 'video', engine: step.engine });
  assert.notEqual(rolled, rewritten);
  assert.match(rolled, /explicit nude woman in a steamy bathroom/);
});

test('Wan and LTX and Hunyuan follow the published video styles', () => {
  const sentence = 'She sits on the couch, leans toward the camera, and says "come here".';
  assert.equal(rewriteInAuthorStyle('anything', sentence, 0, { kind: 'video', engine: 'Wan' }), sentence);
  const ltx = rewriteInAuthorStyle('anything', sentence, 0, { kind: 'video', engine: 'LTX' });
  assert.match(ltx, /Use the provided start image exactly as the first frame/);
  assert.match(ltx, /Performance: She sits on the couch, leans toward the camera, and says "come here"/);
  assert.match(ltx, /Dialogue: "come here"/);
  assert.doesNotMatch(ltx, /slow push-in|already seated/);
  const hunyuan = rewriteInAuthorStyle('anything', sentence, 0, { kind: 'video', engine: 'Hunyuan' });
  assert.match(hunyuan, /\(\[Action: She sits on the couch, leans toward the camera, and says "come here"\.\]:1\)/);
  assert.doesNotMatch(hunyuan, /\(\[Man:/);
  const nsfw = 'nude adult woman, bare breasts, explicit sex';
  const ltxNsfw = rewriteInAuthorStyle('anything', nsfw, 0, { kind: 'video', engine: 'LTX' });
  assert.match(ltxNsfw, /Performance: nude adult woman, bare breasts, explicit sex/);
  assert.doesNotMatch(ltxNsfw, /couch|come here|red dress/);
});

test('image rewrite keeps his scene and uses only the published shape', () => {
  const scene = 'nude adult woman, bare breasts, explicit, "look at me"';
  const pony = rewriteInAuthorStyle('author prompt', scene, 0, { kind: 'image', engine: 'Pony' });
  assert.match(pony, /^score_9, score_8_up, score_7_up, BREAK, /);
  assert.match(pony, /nude adult female/);
  assert.match(pony, /"look at me"/);
  assert.doesNotMatch(pony, /red dress|masterpiece|score_9, score_9/);
  const illustrious = rewriteInAuthorStyle('author prompt', scene, 0, { kind: 'image', engine: 'Illustrious' });
  assert.match(illustrious, /nude adult woman, bare breasts, explicit, "look at me",masterpiece,best quality,amazing quality,$/);
  assert.equal(publishedImageNegative('Illustrious')?.includes('nsfw'), false);
  const zimage = rewriteInAuthorStyle('author prompt', scene, 0, { kind: 'image', engine: 'Z-Image' });
  assert.equal(zimage, scene);
  assert.doesNotMatch(zimage, /score_9|masterpiece|soft daylight|red dress/);
  assert.equal(publishedImageNegative('Z-Image'), '');
  const klein = rewriteInAuthorStyle('author prompt', 'her panties are pulled down to her thighs', 0, { kind: 'image', engine: 'Flux' });
  assert.match(klein, /her panties are pulled down to her thighs/);
  assert.doesNotMatch(klein, /red dress/);
});

test('balcony description is taken from the graph', () => {
  const brief = describeWorkflow(balcony);
  assert.match(brief.blurb, /Pony/);
  assert.match(brief.blurb, /Sulphur/);
  assert.match(brief.blurb, /2 scenes/);
  assert.doesNotMatch(brief.blurb, /4 scenes/);
  assert.match(brief.blurb, /own start image/);
  assert.match(brief.blurb, /long video/);
  assert.match(brief.blurb, /15 seconds/);
  assert.doesNotMatch(brief.blurb, /needs a start image/);
  assert.match(brief.blurb, /hotel balcony/);
  assert.equal(brief.video, 'long');
});

test('H3 description names the engine, the shots, the start image, and the length', () => {
  const brief = describeWorkflow(h3);
  assert.match(brief.blurb, /MiniMax H3/);
  assert.match(brief.blurb, /needs a start image/);
  assert.match(brief.blurb, /long video/);
  assert.ok(brief.scenes >= 1);
  assert.match(brief.blurb, /bathroom|towel|blonde/i);
  assert.doesNotMatch(brief.blurb, /hotel balcony/);
});

test('image still uses the pony step only', () => {
  const step = authorGenerateSteps(balcony)[0];
  const text = rewriteInAuthorStyle(step.authorPrompt, WORDS, 0);
  const still = buildStepStill(balcony, step, text, 42, null);
  assert.ok(still);
  const nodes = Object.values(still.prompt);
  assert.ok(nodes.some((node) => node.class_type === 'CheckpointLoaderSimple' && String(node.inputs.ckpt_name).includes('pony')));
  assert.ok(nodes.some((node) => node.class_type === 'LoraLoader' && String(node.inputs.lora_name).includes('PonyV7base')));
  assert.ok(nodes.some((node) => node.class_type === 'SaveImage'));
  assert.equal(nodes.some((node) => node.class_type === 'UNETLoader'), false);
  const promptNode = still.prompt[step.nodeId];
  assert.equal(promptNode.inputs[step.field], text);
  const sampler = still.prompt[step.samplerId];
  assert.equal(sampler.inputs.seed, 42);
});

test('video still uses the sulphur step, the author LoRAs, and a short length', () => {
  const step = authorGenerateSteps(balcony)[1];
  const text = rewriteInAuthorStyle(step.authorPrompt, WORDS, 0);
  const still = buildStepStill(balcony, step, text, 99, 'incard-start.png');
  assert.ok(still);
  const nodes = Object.values(still.prompt);
  assert.ok(nodes.some((node) => String(node.inputs.unet_name ?? node.inputs.ckpt_name ?? '').includes('sulphur')));
  const loras = nodes.filter((node) => /LoraLoader/.test(node.class_type)).map((node) => String(node.inputs.lora_name));
  assert.ok(loras.some((file) => file.includes('ltx_2.3_22b_distilled')));
  assert.ok(loras.some((file) => file.includes('gemma-3-12b')));
  assert.equal(nodes.some((node) => String(node.inputs.ckpt_name ?? '').toLowerCase().includes('pony') || String(node.inputs.lora_name ?? '').includes('PonyV7')), false);
  assert.ok(nodes.some((node) => node.class_type === 'LoadImage' && node.inputs.image === 'incard-start.png'));
  const seconds = nodes.find((node) => node.class_type === 'PrimitiveInt' && node.inputs.value === 2);
  assert.ok(seconds);
});

test('the full run keeps the author length and the approved still', () => {
  const steps = authorGenerateSteps(balcony);
  const text = rewriteInAuthorStyle(steps[0].authorPrompt, WORDS, 0, { kind: 'image', engine: steps[0].engine });
  const full = applyApprovedRun(balcony, [
    { nodeId: steps[0].nodeId, field: steps[0].field, text, samplerId: steps[0].samplerId, seed: 7, image: 'kept.png', kind: 'image', engine: steps[0].engine },
    { nodeId: steps[1].nodeId, field: steps[1].field, text: rewriteInAuthorStyle(steps[1].authorPrompt, WORDS, 0, { kind: 'video', engine: steps[1].engine }), samplerId: steps[1].samplerId, seed: 8, image: null, kind: 'video' },
  ]);
  assert.ok(full);
  assert.equal(full[steps[0].nodeId].inputs[steps[0].field], text);
  const fifteen = Object.values(full).find((node) => node.class_type === 'PrimitiveInt' && node.inputs.value === 15);
  assert.ok(fifteen);
  assert.ok(Object.values(full).some((node) => node.class_type === 'LoadImage' && node.inputs.image === 'kept.png'));
  assert.equal(full[steps[1].nodeId].inputs[steps[1].field], rewriteInAuthorStyle(steps[1].authorPrompt, WORDS, 0, { kind: 'video', engine: steps[1].engine }));
  const negative = Object.values(full).find((node) => node.inputs.text === 'score_4, score_5, score_6' || node.inputs.value === 'score_4, score_5, score_6');
  assert.ok(negative);
  assert.equal(Object.values(full).some((node) => /nsfw/i.test(String(node.inputs.text ?? node.inputs.value ?? ''))), false);
});

test('a matched LoRA stays on its own engine', () => {
  const inventory = [
    { name: 'Pony bounce', file: 'pony_bounce.safetensors', trigger: 'bouncing her ass' },
    { name: 'Sulphur wind', file: 'sulphur_wind.safetensors', trigger: 'wind blows her hair' },
    { name: 'Both engines', file: 'pony_and_sulphur.safetensors', trigger: 'bouncing her ass' },
    { name: 'Not installed', file: '', trigger: 'bouncing her ass' },
  ];
  const words = 'nude adult woman bouncing her ass while the wind blows her hair';
  const steps = authorGenerateSteps(balcony);
  const pony = matchPromptLora(steps[0].engine, words, inventory);
  const sulphur = matchPromptLora(steps[1].engine, words, inventory);
  assert.equal(pony?.file, 'pony_bounce.safetensors');
  assert.equal(sulphur?.file, 'sulphur_wind.safetensors');
  assert.equal(matchPromptLora('Sulphur', words, inventory)?.file.includes('pony'), false);
  assert.equal(matchPromptLora('Pony', words, inventory)?.file.includes('sulphur'), false);

  const graph = applyApprovedRun(balcony, [
    { nodeId: steps[0].nodeId, field: steps[0].field, text: words, samplerId: steps[0].samplerId, seed: 1, image: null, kind: 'image', engine: steps[0].engine },
    { nodeId: steps[1].nodeId, field: steps[1].field, text: words, samplerId: steps[1].samplerId, seed: 2, image: null, kind: 'video', engine: steps[1].engine },
  ]);
  assert.ok(graph);
  const before = JSON.stringify(graph);
  assert.equal(applyMatchedLora(graph, steps[1].samplerId, { file: 'pony_bounce.safetensors', name: 'Pony bounce' }), false);
  assert.equal(applyMatchedLora(graph, steps[0].samplerId, { file: 'sulphur_wind.safetensors', name: 'Sulphur wind' }), false);
  assert.equal(JSON.stringify(graph), before);
  assert.equal(applyMatchedLora(graph, steps[1].samplerId, sulphur), true);
  assert.equal(applyMatchedLora(graph, steps[0].samplerId, pony), true);
  const added = Object.values(graph).filter((node) => node.class_type === 'LoraLoaderModelOnly' && (String(node.inputs.lora_name).includes('pony_bounce') || String(node.inputs.lora_name).includes('sulphur_wind')));
  assert.equal(added.length, 2);
  for (const node of added) {
    const loader = graph[node.inputs.model[0]];
    const ckpt = String(loader.inputs.ckpt_name ?? '');
    if (String(node.inputs.lora_name).includes('pony')) assert.match(ckpt, /pony/i);
    if (String(node.inputs.lora_name).includes('sulphur')) assert.match(ckpt, /sulphur/i);
  }
  const files = JSON.stringify(graph);
  assert.match(files, /ltx_2\.3_22b_distilled/);
  assert.match(files, /gemma-3-12b/);
  assert.match(files, /PonyV7base/);
});
