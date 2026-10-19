/**
 * One plain blurb per workflow, taken from that workflow's graph.
 * Run from comfy-mobile/: node --import ./tests/register.mjs tools/workflow-blurbs.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseStudioThumbIndex } from '../src/core/content/studioThumbs.ts';
import { parseJobFile } from '../src/core/content/studioRun.ts';
import { describeWorkflow } from '../src/core/content/inCardGenerate.ts';

const index = JSON.parse(readFileSync(new URL('../public/studio-thumbs/index.json', import.meta.url), 'utf8'));
const catalog = parseStudioThumbIndex(index);
const blurbs = {};
for (const card of catalog.workflows) {
  if (!card.workflowFile) continue;
  try {
    const raw = parseJobFile(readFileSync(new URL(`../public/studio-thumbs/${card.workflowFile}`, import.meta.url), 'utf8'));
    blurbs[card.workflowFile] = describeWorkflow(raw).blurb;
  } catch {
    blurbs[card.workflowFile] = 'This workflow file could not be read.';
  }
}
writeFileSync(new URL('../public/studio-thumbs/workflow-blurbs.json', import.meta.url), JSON.stringify(blurbs));
console.log(`wrote ${Object.keys(blurbs).length} blurbs`);
