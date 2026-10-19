/**
 * Bundled IMAGE templates: the classic ComfyUI default txt2img graph (same
 * node ids/positions as the web UI's default) and a simple img2img.
 */
import { buildWorkflow } from '../builder';
import type { StudioTemplate } from '../schema';

const SD_PRESETS = [
  { label: 'Square 512', width: 512, height: 512 },
  { label: 'Portrait 512x768', width: 512, height: 768 },
  { label: 'Landscape 768x512', width: 768, height: 512 },
  { label: 'SDXL 1024', width: 1024, height: 1024 },
];

export const defaultTxt2Img: StudioTemplate = {
  id: 'default-txt2img',
  name: 'Text to Image (ComfyUI default)',
  description: 'The default ComfyUI graph: checkpoint → CLIP text encode → KSampler → VAE decode → save.',
  kind: 'txt2img',
  engine: 'SD1.5',
  tags: ['image', 'default'],
  requires: ['CheckpointLoaderSimple', 'KSampler', 'SaveImage'],
  models: [{ folder: 'checkpoints', file: 'uberRealisticPornMerge_v23Final.safetensors' }],
  resolutionPresets: SD_PRESETS,
  params: [
    { key: 'prompt', label: 'Prompt', type: 'text', role: 'positive_prompt', bindings: [{ node: { id: 6 }, widget: 'text' }] },
    { key: 'negative', label: 'Negative prompt', type: 'text', role: 'negative_prompt', bindings: [{ node: { id: 7 }, widget: 'text' }] },
    { key: 'model', label: 'Checkpoint', type: 'combo', role: 'model', bindings: [{ node: { id: 4 }, widget: 'ckpt_name' }] },
    { key: 'width', label: 'Width', type: 'number', role: 'width', min: 64, max: 2048, step: 8, bindings: [{ node: { id: 5 }, widget: 'width' }] },
    { key: 'height', label: 'Height', type: 'number', role: 'height', min: 64, max: 2048, step: 8, bindings: [{ node: { id: 5 }, widget: 'height' }] },
    { key: 'batch', label: 'Batch size', type: 'number', min: 1, max: 16, step: 1, advanced: true, bindings: [{ node: { id: 5 }, widget: 'batch_size' }] },
    { key: 'steps', label: 'Steps', type: 'number', role: 'steps', min: 1, max: 150, step: 1, bindings: [{ node: { id: 3 }, widget: 'steps' }] },
    { key: 'cfg', label: 'CFG', type: 'number', role: 'cfg', min: 1, max: 30, step: 0.5, bindings: [{ node: { id: 3 }, widget: 'cfg' }] },
    { key: 'seed', label: 'Seed', type: 'seed', role: 'seed', bindings: [{ node: { id: 3 }, widget: 'seed' }] },
    { key: 'sampler', label: 'Sampler', type: 'combo', advanced: true, bindings: [{ node: { id: 3 }, widget: 'sampler_name' }] },
    { key: 'scheduler', label: 'Scheduler', type: 'combo', advanced: true, bindings: [{ node: { id: 3 }, widget: 'scheduler' }] },
  ],
  workflow: buildWorkflow(
    [
      { id: 4, type: 'CheckpointLoaderSimple', pos: [26, 474], size: [315, 98], widgets_values: ['uberRealisticPornMerge_v23Final.safetensors'], outputs: [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']] },
      { id: 6, type: 'CLIPTextEncode', title: 'CLIP Text Encode (Prompt)', pos: [415, 186], size: [422, 164], widgets_values: ['beautiful scenery nature glass bottle landscape, purple galaxy bottle,'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']] },
      { id: 7, type: 'CLIPTextEncode', title: 'CLIP Text Encode (Prompt)', pos: [413, 389], size: [425, 180], widgets_values: ['text, watermark'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']] },
      { id: 5, type: 'EmptyLatentImage', pos: [473, 609], size: [315, 106], widgets_values: [512, 512, 1], outputs: [['LATENT', 'LATENT']] },
      { id: 3, type: 'KSampler', pos: [863, 186], size: [315, 262], widgets_values: [156680208700286, 'randomize', 20, 8, 'euler', 'normal', 1], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 8, type: 'VAEDecode', pos: [1209, 188], size: [210, 46], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
      { id: 9, type: 'SaveImage', pos: [1451, 189], size: [210, 58], widgets_values: ['ComfyUI'], inputs: [['images', 'IMAGE']] },
    ],
    [
      [4, 0, 3, 'model', 'MODEL'],
      [4, 1, 6, 'clip', 'CLIP'],
      [4, 1, 7, 'clip', 'CLIP'],
      [6, 0, 3, 'positive', 'CONDITIONING'],
      [7, 0, 3, 'negative', 'CONDITIONING'],
      [5, 0, 3, 'latent_image', 'LATENT'],
      [3, 0, 8, 'samples', 'LATENT'],
      [4, 2, 8, 'vae', 'VAE'],
      [8, 0, 9, 'images', 'IMAGE'],
    ],
  ),
};

export const defaultImg2Img: StudioTemplate = {
  id: 'default-img2img',
  name: 'Image to Image',
  description: 'Load an image, encode it to latent, and re-sample it with a prompt at a chosen denoise.',
  kind: 'img2img',
  engine: 'SD1.5',
  tags: ['image', 'img2img'],
  requires: ['CheckpointLoaderSimple', 'LoadImage', 'VAEEncode', 'KSampler', 'SaveImage'],
  models: [{ folder: 'checkpoints', file: 'uberRealisticPornMerge_v23Final.safetensors' }],
  params: [
    { key: 'image', label: 'Source image', type: 'image', role: 'reference_image', bindings: [{ node: { id: 10 }, widget: 'image' }] },
    { key: 'prompt', label: 'Prompt', type: 'text', role: 'positive_prompt', bindings: [{ node: { id: 6 }, widget: 'text' }] },
    { key: 'negative', label: 'Negative prompt', type: 'text', role: 'negative_prompt', bindings: [{ node: { id: 7 }, widget: 'text' }] },
    { key: 'model', label: 'Checkpoint', type: 'combo', role: 'model', bindings: [{ node: { id: 4 }, widget: 'ckpt_name' }] },
    { key: 'denoise', label: 'Denoise', type: 'number', role: 'strength', min: 0, max: 1, step: 0.05, bindings: [{ node: { id: 3 }, widget: 'denoise' }] },
    { key: 'steps', label: 'Steps', type: 'number', role: 'steps', min: 1, max: 150, step: 1, bindings: [{ node: { id: 3 }, widget: 'steps' }] },
    { key: 'cfg', label: 'CFG', type: 'number', role: 'cfg', min: 1, max: 30, step: 0.5, bindings: [{ node: { id: 3 }, widget: 'cfg' }] },
    { key: 'seed', label: 'Seed', type: 'seed', role: 'seed', bindings: [{ node: { id: 3 }, widget: 'seed' }] },
  ],
  workflow: buildWorkflow(
    [
      { id: 4, type: 'CheckpointLoaderSimple', pos: [40, 420], widgets_values: ['uberRealisticPornMerge_v23Final.safetensors'], outputs: [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']] },
      { id: 10, type: 'LoadImage', pos: [40, 60], widgets_values: [''], outputs: [['IMAGE', 'IMAGE'], ['MASK', 'MASK']] },
      { id: 11, type: 'VAEEncode', pos: [400, 60], inputs: [['pixels', 'IMAGE'], ['vae', 'VAE']], outputs: [['LATENT', 'LATENT']] },
      { id: 6, type: 'CLIPTextEncode', title: 'Positive Prompt', pos: [400, 200], size: [320, 0], widgets_values: ['a painting in the style of van gogh'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#232', bgcolor: '#353' },
      { id: 7, type: 'CLIPTextEncode', title: 'Negative Prompt', pos: [400, 400], size: [320, 0], widgets_values: ['text, watermark, blurry'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#322', bgcolor: '#533' },
      { id: 3, type: 'KSampler', pos: [780, 200], widgets_values: [0, 'randomize', 20, 7, 'dpmpp_2m', 'karras', 0.6], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 8, type: 'VAEDecode', pos: [1080, 200], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
      { id: 9, type: 'SaveImage', pos: [1080, 320], widgets_values: ['img2img'], inputs: [['images', 'IMAGE']] },
    ],
    [
      [4, 0, 3, 'model', 'MODEL'],
      [4, 1, 6, 'clip', 'CLIP'],
      [4, 1, 7, 'clip', 'CLIP'],
      [10, 0, 11, 'pixels', 'IMAGE'],
      [4, 2, 11, 'vae', 'VAE'],
      [11, 0, 3, 'latent_image', 'LATENT'],
      [6, 0, 3, 'positive', 'CONDITIONING'],
      [7, 0, 3, 'negative', 'CONDITIONING'],
      [3, 0, 8, 'samples', 'LATENT'],
      [4, 2, 8, 'vae', 'VAE'],
      [8, 0, 9, 'images', 'IMAGE'],
    ],
  ),
};

export const imageTemplates: StudioTemplate[] = [defaultTxt2Img, defaultImg2Img];
