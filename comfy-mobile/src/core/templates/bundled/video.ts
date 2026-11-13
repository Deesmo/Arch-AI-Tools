/**
 * Bundled VIDEO templates, targeted at the stacks installed on the Skytech
 * ComfyUI server (Wan 2.2 14B fp8 T2V/I2V, LTX-2.x, HunyuanVideo 1.5) plus a
 * classic AnimateDiff + VideoHelperSuite graph.
 *
 * These are *skeletons*: node graphs follow the official ComfyUI example
 * workflows for each family, and model file names follow the official
 * example names. `validateTemplate()` diffs the node types and model files
 * against the live server and reports anything missing, so wrong file names
 * surface as a visible warning (and are editable in Studio / Graph mode)
 * instead of failing at queue time.
 */
import { buildWorkflow } from '../builder';
import type { StudioTemplate, TemplateParam } from '../schema';

const WAN_PRESETS = [
  { label: '480p landscape', width: 832, height: 480 },
  { label: '480p portrait', width: 480, height: 832 },
  { label: '720p landscape', width: 1280, height: 720 },
  { label: '704p (official)', width: 1280, height: 704 },
];

const promptParams = (posId: number, negId: number): TemplateParam[] => [
  { key: 'prompt', label: 'Prompt', type: 'text', role: 'positive_prompt', bindings: [{ node: { id: posId }, widget: 'text' }] },
  { key: 'negative', label: 'Negative prompt', type: 'text', role: 'negative_prompt', bindings: [{ node: { id: negId }, widget: 'text' }] },
];

const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

/** Shared KSamplerAdvanced pair + decode/save tail used by both Wan 2.2 templates. */
function wanSamplerParams(highId: number, lowId: number, fpsNode: number): TemplateParam[] {
  return [
    { key: 'steps', label: 'Steps (total)', type: 'number', role: 'steps', min: 2, max: 60, step: 2, description: 'Split evenly between the high-noise and low-noise models.', bindings: [
      { node: { id: highId }, widget: 'steps' },
      { node: { id: lowId }, widget: 'steps' },
      { node: { id: highId }, widget: 'end_at_step', transform: 'half' },
      { node: { id: lowId }, widget: 'start_at_step', transform: 'half' },
    ] },
    { key: 'cfg', label: 'CFG', type: 'number', role: 'cfg', min: 1, max: 12, step: 0.5, bindings: [{ node: { id: highId }, widget: 'cfg' }, { node: { id: lowId }, widget: 'cfg' }] },
    { key: 'seed', label: 'Seed', type: 'seed', role: 'seed', bindings: [{ node: { id: highId }, widget: 'noise_seed' }] },
    { key: 'fps', label: 'FPS', type: 'number', role: 'fps', min: 8, max: 30, step: 1, bindings: [{ node: { id: fpsNode }, widget: 'fps' }] },
    { key: 'sampler', label: 'Sampler', type: 'combo', advanced: true, bindings: [{ node: { id: highId }, widget: 'sampler_name' }, { node: { id: lowId }, widget: 'sampler_name' }] },
    { key: 'scheduler', label: 'Scheduler', type: 'combo', advanced: true, bindings: [{ node: { id: highId }, widget: 'scheduler' }, { node: { id: lowId }, widget: 'scheduler' }] },
  ];
}

// ---------------------------------------------------------------------------
// Wan 2.2 14B text-to-video (high-noise + low-noise experts)
// ---------------------------------------------------------------------------
export const wan22Txt2Video: StudioTemplate = {
  id: 'wan22-txt2video',
  name: 'Wan 2.2 Text to Video (14B)',
  description: 'Two-expert Wan 2.2 T2V: high-noise then low-noise 14B fp8 models, optional Lightning 4-step LoRAs.',
  kind: 'txt2video',
  engine: 'Wan 2.2',
  tags: ['video', 'wan', 't2v', 'primary'],
  requires: ['UNETLoader', 'LoraLoaderModelOnly', 'ModelSamplingSD3', 'CLIPLoader', 'EmptyHunyuanLatentVideo', 'KSamplerAdvanced', 'CreateVideo', 'SaveVideo'],
  models: [
    { folder: 'diffusion_models', file: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors' },
    { folder: 'diffusion_models', file: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors' },
    { folder: 'text_encoders', file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors' },
    { folder: 'vae', file: 'wan_2.1_vae.safetensors' },
    { folder: 'loras', file: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors' },
    { folder: 'loras', file: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors' },
  ],
  resolutionPresets: WAN_PRESETS,
  params: [
    ...promptParams(5, 6),
    { key: 'model_high', label: 'High-noise model', type: 'combo', role: 'model', bindings: [{ node: { id: 1 }, widget: 'unet_name' }] },
    { key: 'model_low', label: 'Low-noise model', type: 'combo', role: 'model', bindings: [{ node: { id: 2 }, widget: 'unet_name' }] },
    { key: 'width', label: 'Width', type: 'number', role: 'width', min: 256, max: 1280, step: 16, bindings: [{ node: { id: 8 }, widget: 'width' }] },
    { key: 'height', label: 'Height', type: 'number', role: 'height', min: 256, max: 1280, step: 16, bindings: [{ node: { id: 8 }, widget: 'height' }] },
    { key: 'frames', label: 'Frames', type: 'number', role: 'frames', min: 1, max: 161, step: 4, description: 'Wan uses 4n+1 frames (81 = 5s at 16fps).', bindings: [{ node: { id: 8 }, widget: 'length' }] },
    ...wanSamplerParams(9, 10, 12),
    { key: 'lightning', label: 'Lightning 4-step LoRAs', type: 'toggle', role: 'lora', description: 'Enables the lightx2v LoRA loaders. Use ~4 steps and CFG 1 when on.', bindings: [{ node: { id: 3 }, widget: '', target: 'mode' }, { node: { id: 4 }, widget: '', target: 'mode' }] },
    { key: 'lora_high', label: 'High-noise LoRA', type: 'lora', role: 'lora', advanced: true, bindings: [{ node: { id: 3 }, widget: 'lora_name' }] },
    { key: 'lora_low', label: 'Low-noise LoRA', type: 'lora', role: 'lora', advanced: true, bindings: [{ node: { id: 4 }, widget: 'lora_name' }] },
    { key: 'shift', label: 'Shift', type: 'number', min: 1, max: 20, step: 0.5, advanced: true, bindings: [{ node: { id: 17 }, widget: 'shift' }, { node: { id: 18 }, widget: 'shift' }] },
  ],
  workflow: buildWorkflow(
    [
      { id: 1, type: 'UNETLoader', title: 'High-noise model', pos: [40, 60], widgets_values: ['wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors', 'default'], outputs: [['MODEL', 'MODEL']] },
      { id: 2, type: 'UNETLoader', title: 'Low-noise model', pos: [40, 180], widgets_values: ['wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors', 'default'], outputs: [['MODEL', 'MODEL']] },
      { id: 3, type: 'LoraLoaderModelOnly', title: 'Lightning LoRA (high)', pos: [360, 60], mode: 4, widgets_values: ['wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors', 1.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 4, type: 'LoraLoaderModelOnly', title: 'Lightning LoRA (low)', pos: [360, 180], mode: 4, widgets_values: ['wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors', 1.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 17, type: 'ModelSamplingSD3', title: 'Shift (high)', pos: [680, 60], widgets_values: [8.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 18, type: 'ModelSamplingSD3', title: 'Shift (low)', pos: [680, 180], widgets_values: [8.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 7, type: 'CLIPLoader', title: 'Load CLIP', pos: [40, 320], widgets_values: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'wan', 'default'], outputs: [['CLIP', 'CLIP']] },
      { id: 5, type: 'CLIPTextEncode', title: 'Positive Prompt', pos: [360, 320], size: [320, 0], widgets_values: ['a cinematic drone shot over a misty forest at sunrise, soft volumetric light, slow smooth motion'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#232', bgcolor: '#353' },
      { id: 6, type: 'CLIPTextEncode', title: 'Negative Prompt', pos: [360, 520], size: [320, 0], widgets_values: [WAN_NEGATIVE], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#322', bgcolor: '#533' },
      { id: 8, type: 'EmptyHunyuanLatentVideo', title: 'Empty Video Latent', pos: [360, 720], widgets_values: [832, 480, 81, 1], outputs: [['LATENT', 'LATENT']] },
      { id: 9, type: 'KSamplerAdvanced', title: 'KSampler (high noise)', pos: [1020, 60], widgets_values: ['enable', 0, 'randomize', 20, 3.5, 'euler', 'simple', 0, 10, 'enable'], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 10, type: 'KSamplerAdvanced', title: 'KSampler (low noise)', pos: [1020, 420], widgets_values: ['disable', 0, 'fixed', 20, 3.5, 'euler', 'simple', 10, 10000, 'disable'], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 11, type: 'VAELoader', pos: [680, 720], widgets_values: ['wan_2.1_vae.safetensors'], outputs: [['VAE', 'VAE']] },
      { id: 13, type: 'VAEDecode', pos: [1340, 420], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
      { id: 12, type: 'CreateVideo', pos: [1340, 540], widgets_values: [16, 'auto', 'sRGB', 'none'], inputs: [['images', 'IMAGE'], ['audio', 'AUDIO']], outputs: [['VIDEO', 'VIDEO']] },
      { id: 14, type: 'SaveVideo', pos: [1340, 660], widgets_values: ['video/ComfyUI', 'auto', 'auto'], inputs: [['video', 'VIDEO']] },
    ],
    [
      [1, 0, 3, 'model', 'MODEL'],
      [2, 0, 4, 'model', 'MODEL'],
      [3, 0, 17, 'model', 'MODEL'],
      [4, 0, 18, 'model', 'MODEL'],
      [17, 0, 9, 'model', 'MODEL'],
      [18, 0, 10, 'model', 'MODEL'],
      [7, 0, 5, 'clip', 'CLIP'],
      [7, 0, 6, 'clip', 'CLIP'],
      [5, 0, 9, 'positive', 'CONDITIONING'],
      [6, 0, 9, 'negative', 'CONDITIONING'],
      [5, 0, 10, 'positive', 'CONDITIONING'],
      [6, 0, 10, 'negative', 'CONDITIONING'],
      [8, 0, 9, 'latent_image', 'LATENT'],
      [9, 0, 10, 'latent_image', 'LATENT'],
      [10, 0, 13, 'samples', 'LATENT'],
      [11, 0, 13, 'vae', 'VAE'],
      [13, 0, 12, 'images', 'IMAGE'],
      [12, 0, 14, 'video', 'VIDEO'],
    ],
  ),
};

// ---------------------------------------------------------------------------
// Wan 2.2 14B image-to-video
// ---------------------------------------------------------------------------
export const wan22Img2Video: StudioTemplate = {
  id: 'wan22-img2video',
  name: 'Wan 2.2 Image to Video (14B)',
  description: 'Animate a reference image with the Wan 2.2 I2V high/low-noise experts (WanImageToVideo).',
  kind: 'img2video',
  engine: 'Wan 2.2',
  tags: ['video', 'wan', 'i2v', 'primary'],
  requires: ['UNETLoader', 'LoraLoaderModelOnly', 'ModelSamplingSD3', 'CLIPLoader', 'LoadImage', 'WanImageToVideo', 'KSamplerAdvanced', 'CreateVideo', 'SaveVideo'],
  models: [
    { folder: 'diffusion_models', file: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors' },
    { folder: 'diffusion_models', file: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors' },
    { folder: 'text_encoders', file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors' },
    { folder: 'vae', file: 'wan_2.1_vae.safetensors' },
    { folder: 'loras', file: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors' },
    { folder: 'loras', file: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors' },
  ],
  resolutionPresets: WAN_PRESETS,
  params: [
    { key: 'image', label: 'Reference image', type: 'image', role: 'reference_image', bindings: [{ node: { id: 15 }, widget: 'image' }] },
    ...promptParams(5, 6),
    { key: 'model_high', label: 'High-noise model', type: 'combo', role: 'model', bindings: [{ node: { id: 1 }, widget: 'unet_name' }] },
    { key: 'model_low', label: 'Low-noise model', type: 'combo', role: 'model', bindings: [{ node: { id: 2 }, widget: 'unet_name' }] },
    { key: 'width', label: 'Width', type: 'number', role: 'width', min: 256, max: 1280, step: 16, bindings: [{ node: { id: 16 }, widget: 'width' }] },
    { key: 'height', label: 'Height', type: 'number', role: 'height', min: 256, max: 1280, step: 16, bindings: [{ node: { id: 16 }, widget: 'height' }] },
    { key: 'frames', label: 'Frames', type: 'number', role: 'frames', min: 1, max: 161, step: 4, description: 'Wan uses 4n+1 frames (81 = 5s at 16fps).', bindings: [{ node: { id: 16 }, widget: 'length' }] },
    ...wanSamplerParams(9, 10, 12),
    { key: 'lightning', label: 'Lightning 4-step LoRAs', type: 'toggle', role: 'lora', description: 'Enables the lightx2v LoRA loaders. Use ~4 steps and CFG 1 when on.', bindings: [{ node: { id: 3 }, widget: '', target: 'mode' }, { node: { id: 4 }, widget: '', target: 'mode' }] },
    { key: 'lora_high', label: 'High-noise LoRA', type: 'lora', role: 'lora', advanced: true, bindings: [{ node: { id: 3 }, widget: 'lora_name' }] },
    { key: 'lora_low', label: 'Low-noise LoRA', type: 'lora', role: 'lora', advanced: true, bindings: [{ node: { id: 4 }, widget: 'lora_name' }] },
    { key: 'shift', label: 'Shift', type: 'number', min: 1, max: 20, step: 0.5, advanced: true, bindings: [{ node: { id: 17 }, widget: 'shift' }, { node: { id: 18 }, widget: 'shift' }] },
  ],
  workflow: buildWorkflow(
    [
      { id: 1, type: 'UNETLoader', title: 'High-noise model', pos: [40, 60], widgets_values: ['wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', 'default'], outputs: [['MODEL', 'MODEL']] },
      { id: 2, type: 'UNETLoader', title: 'Low-noise model', pos: [40, 180], widgets_values: ['wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', 'default'], outputs: [['MODEL', 'MODEL']] },
      { id: 3, type: 'LoraLoaderModelOnly', title: 'Lightning LoRA (high)', pos: [360, 60], mode: 4, widgets_values: ['wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors', 1.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 4, type: 'LoraLoaderModelOnly', title: 'Lightning LoRA (low)', pos: [360, 180], mode: 4, widgets_values: ['wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors', 1.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 17, type: 'ModelSamplingSD3', title: 'Shift (high)', pos: [680, 60], widgets_values: [8.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 18, type: 'ModelSamplingSD3', title: 'Shift (low)', pos: [680, 180], widgets_values: [8.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 7, type: 'CLIPLoader', title: 'Load CLIP', pos: [40, 320], widgets_values: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'wan', 'default'], outputs: [['CLIP', 'CLIP']] },
      { id: 5, type: 'CLIPTextEncode', title: 'Positive Prompt', pos: [360, 320], size: [320, 0], widgets_values: ['the camera slowly pushes in, gentle wind moves the hair and clothing, natural motion, high detail'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#232', bgcolor: '#353' },
      { id: 6, type: 'CLIPTextEncode', title: 'Negative Prompt', pos: [360, 520], size: [320, 0], widgets_values: [WAN_NEGATIVE], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#322', bgcolor: '#533' },
      { id: 15, type: 'LoadImage', title: 'Reference Image', pos: [40, 480], widgets_values: [''], outputs: [['IMAGE', 'IMAGE'], ['MASK', 'MASK']] },
      { id: 11, type: 'VAELoader', pos: [40, 760], widgets_values: ['wan_2.1_vae.safetensors'], outputs: [['VAE', 'VAE']] },
      { id: 16, type: 'WanImageToVideo', pos: [700, 520], widgets_values: [832, 480, 81, 1], inputs: [['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['vae', 'VAE'], ['clip_vision_output', 'CLIP_VISION_OUTPUT'], ['start_image', 'IMAGE']], outputs: [['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent', 'LATENT']] },
      { id: 9, type: 'KSamplerAdvanced', title: 'KSampler (high noise)', pos: [1020, 60], widgets_values: ['enable', 0, 'randomize', 20, 3.5, 'euler', 'simple', 0, 10, 'enable'], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 10, type: 'KSamplerAdvanced', title: 'KSampler (low noise)', pos: [1020, 420], widgets_values: ['disable', 0, 'fixed', 20, 3.5, 'euler', 'simple', 10, 10000, 'disable'], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 13, type: 'VAEDecode', pos: [1340, 420], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
      { id: 12, type: 'CreateVideo', pos: [1340, 540], widgets_values: [16, 'auto', 'sRGB', 'none'], inputs: [['images', 'IMAGE'], ['audio', 'AUDIO']], outputs: [['VIDEO', 'VIDEO']] },
      { id: 14, type: 'SaveVideo', pos: [1340, 660], widgets_values: ['video/ComfyUI', 'auto', 'auto'], inputs: [['video', 'VIDEO']] },
    ],
    [
      [1, 0, 3, 'model', 'MODEL'],
      [2, 0, 4, 'model', 'MODEL'],
      [3, 0, 17, 'model', 'MODEL'],
      [4, 0, 18, 'model', 'MODEL'],
      [17, 0, 9, 'model', 'MODEL'],
      [18, 0, 10, 'model', 'MODEL'],
      [7, 0, 5, 'clip', 'CLIP'],
      [7, 0, 6, 'clip', 'CLIP'],
      [5, 0, 16, 'positive', 'CONDITIONING'],
      [6, 0, 16, 'negative', 'CONDITIONING'],
      [11, 0, 16, 'vae', 'VAE'],
      [15, 0, 16, 'start_image', 'IMAGE'],
      [16, 0, 9, 'positive', 'CONDITIONING'],
      [16, 1, 9, 'negative', 'CONDITIONING'],
      [16, 2, 9, 'latent_image', 'LATENT'],
      [16, 0, 10, 'positive', 'CONDITIONING'],
      [16, 1, 10, 'negative', 'CONDITIONING'],
      [9, 0, 10, 'latent_image', 'LATENT'],
      [10, 0, 13, 'samples', 'LATENT'],
      [11, 0, 13, 'vae', 'VAE'],
      [13, 0, 12, 'images', 'IMAGE'],
      [12, 0, 14, 'video', 'VIDEO'],
    ],
  ),
};

// ---------------------------------------------------------------------------
// LTX-2.x (checkpoint + LTXV core nodes + SamplerCustom)
// ---------------------------------------------------------------------------
const LTX_PRESETS = [
  { label: '768x512', width: 768, height: 512 },
  { label: '512x768', width: 512, height: 768 },
  { label: '1216x704', width: 1216, height: 704 },
  { label: '1280x720', width: 1280, height: 720 },
];

function ltxTail(kind: 'txt2video' | 'img2video'): StudioTemplate {
  const isI2V = kind === 'img2video';
  const latentNode = isI2V
    ? { id: 6, type: 'LTXVImgToVideo', pos: [740, 200] as [number, number], widgets_values: [768, 512, 97, 1, 1.0], inputs: [['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['vae', 'VAE'], ['image', 'IMAGE']] as [string, string][], outputs: [['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent', 'LATENT']] as [string, string][] }
    : { id: 6, type: 'EmptyLTXVLatentVideo', pos: [740, 480] as [number, number], widgets_values: [768, 512, 97, 1], inputs: [] as [string, string][], outputs: [['LATENT', 'LATENT']] as [string, string][] };

  return {
    id: isI2V ? 'ltx2-img2video' : 'ltx2-txt2video',
    name: isI2V ? 'LTX-2 Image to Video' : 'LTX-2 Text to Video',
    description: isI2V
      ? 'LTX-2.x I2V skeleton: single checkpoint, Gemma text encoder, LTXVImgToVideo + LTXVScheduler + SamplerCustom.'
      : 'LTX-2.x T2V skeleton: single checkpoint, Gemma text encoder, EmptyLTXVLatentVideo + LTXVScheduler + SamplerCustom.',
    kind,
    engine: 'LTX-2',
    tags: ['video', 'ltx', isI2V ? 'i2v' : 't2v', 'primary'],
    requires: ['CheckpointLoaderSimple', 'CLIPLoader', isI2V ? 'LTXVImgToVideo' : 'EmptyLTXVLatentVideo', 'LTXVConditioning', 'LTXVScheduler', 'KSamplerSelect', 'SamplerCustom', 'CreateVideo', 'SaveVideo'],
    models: [
      { folder: 'checkpoints', file: 'ltx-2.3-22b-dev-fp8.safetensors' },
      { folder: 'text_encoders', file: 'gemma_3_12B_it.safetensors' },
    ],
    resolutionPresets: LTX_PRESETS,
    params: [
      ...(isI2V ? [{ key: 'image', label: 'Reference image', type: 'image', role: 'reference_image', bindings: [{ node: { id: 5 }, widget: 'image' }] } as TemplateParam] : []),
      ...promptParams(3, 4),
      { key: 'model', label: 'Checkpoint', type: 'combo', role: 'model', bindings: [{ node: { id: 1 }, widget: 'ckpt_name' }] },
      { key: 'text_encoder', label: 'Text encoder', type: 'combo', role: 'model', advanced: true, bindings: [{ node: { id: 2 }, widget: 'clip_name' }] },
      { key: 'width', label: 'Width', type: 'number', role: 'width', min: 256, max: 1536, step: 32, bindings: [{ node: { id: 6 }, widget: 'width' }] },
      { key: 'height', label: 'Height', type: 'number', role: 'height', min: 256, max: 1536, step: 32, bindings: [{ node: { id: 6 }, widget: 'height' }] },
      { key: 'frames', label: 'Frames', type: 'number', role: 'frames', min: 9, max: 257, step: 8, description: 'LTX uses 8n+1 frames (97 = 4s at 24fps).', bindings: [{ node: { id: 6 }, widget: 'length' }] },
      { key: 'fps', label: 'FPS', type: 'number', role: 'fps', min: 8, max: 60, step: 1, bindings: [{ node: { id: 7 }, widget: 'frame_rate' }, { node: { id: 12 }, widget: 'fps' }] },
      ...(isI2V ? [{ key: 'strength', label: 'Image strength', type: 'number', role: 'strength', min: 0, max: 1, step: 0.05, bindings: [{ node: { id: 6 }, widget: 'strength' }] } as TemplateParam] : []),
      { key: 'steps', label: 'Steps', type: 'number', role: 'steps', min: 1, max: 100, step: 1, bindings: [{ node: { id: 8 }, widget: 'steps' }] },
      { key: 'cfg', label: 'CFG', type: 'number', role: 'cfg', min: 1, max: 20, step: 0.5, bindings: [{ node: { id: 10 }, widget: 'cfg' }] },
      { key: 'seed', label: 'Seed', type: 'seed', role: 'seed', bindings: [{ node: { id: 10 }, widget: 'noise_seed' }] },
      { key: 'sampler', label: 'Sampler', type: 'combo', advanced: true, bindings: [{ node: { id: 9 }, widget: 'sampler_name' }] },
    ],
    workflow: buildWorkflow(
      [
        { id: 1, type: 'CheckpointLoaderSimple', title: 'LTX-2 checkpoint', pos: [40, 60], widgets_values: ['ltx-2.3-22b-dev-fp8.safetensors'], outputs: [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']] },
        { id: 2, type: 'CLIPLoader', title: 'Text encoder', pos: [40, 220], widgets_values: ['gemma_3_12B_it.safetensors', 'ltxv', 'default'], outputs: [['CLIP', 'CLIP']] },
        { id: 3, type: 'CLIPTextEncode', title: 'Positive Prompt', pos: [360, 60], size: [320, 0], widgets_values: ['a woman with long brown hair smiles and turns toward the camera, warm afternoon light, shallow depth of field, gentle camera movement'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#232', bgcolor: '#353' },
        { id: 4, type: 'CLIPTextEncode', title: 'Negative Prompt', pos: [360, 260], size: [320, 0], widgets_values: ['low quality, worst quality, deformed, distorted, disfigured, motion smear, motion artifacts, fused fingers, bad anatomy, weird hand, ugly'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#322', bgcolor: '#533' },
        ...(isI2V ? [{ id: 5, type: 'LoadImage', title: 'Reference Image', pos: [40, 400] as [number, number], widgets_values: [''], outputs: [['IMAGE', 'IMAGE'], ['MASK', 'MASK']] as [string, string][] }] : []),
        latentNode,
        { id: 7, type: 'LTXVConditioning', pos: [1040, 200], widgets_values: [24.0], inputs: [['positive', 'CONDITIONING'], ['negative', 'CONDITIONING']], outputs: [['positive', 'CONDITIONING'], ['negative', 'CONDITIONING']] },
        { id: 8, type: 'LTXVScheduler', pos: [740, 680], widgets_values: [30, 2.05, 0.95, true, 0.1], inputs: [['latent', 'LATENT']], outputs: [['SIGMAS', 'SIGMAS']] },
        { id: 9, type: 'KSamplerSelect', pos: [740, 860], widgets_values: ['euler'], outputs: [['SAMPLER', 'SAMPLER']] },
        { id: 10, type: 'SamplerCustom', pos: [1340, 200], widgets_values: [true, 0, 'randomize', 3.0], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['sampler', 'SAMPLER'], ['sigmas', 'SIGMAS'], ['latent_image', 'LATENT']], outputs: [['output', 'LATENT'], ['denoised_output', 'LATENT']] },
        { id: 11, type: 'VAEDecode', pos: [1660, 200], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
        { id: 12, type: 'CreateVideo', pos: [1660, 320], widgets_values: [24, 'auto', 'sRGB', 'none'], inputs: [['images', 'IMAGE'], ['audio', 'AUDIO']], outputs: [['VIDEO', 'VIDEO']] },
        { id: 13, type: 'SaveVideo', pos: [1660, 440], widgets_values: ['video/ComfyUI', 'auto', 'auto'], inputs: [['video', 'VIDEO']] },
      ],
      [
        [1, 0, 10, 'model', 'MODEL'],
        [2, 0, 3, 'clip', 'CLIP'],
        [2, 0, 4, 'clip', 'CLIP'],
        ...(isI2V
          ? ([
              [3, 0, 6, 'positive', 'CONDITIONING'],
              [4, 0, 6, 'negative', 'CONDITIONING'],
              [1, 2, 6, 'vae', 'VAE'],
              [5, 0, 6, 'image', 'IMAGE'],
              [6, 0, 7, 'positive', 'CONDITIONING'],
              [6, 1, 7, 'negative', 'CONDITIONING'],
              [6, 2, 8, 'latent', 'LATENT'],
              [6, 2, 10, 'latent_image', 'LATENT'],
            ] as [number, number, number, string, string][])
          : ([
              [3, 0, 7, 'positive', 'CONDITIONING'],
              [4, 0, 7, 'negative', 'CONDITIONING'],
              [6, 0, 8, 'latent', 'LATENT'],
              [6, 0, 10, 'latent_image', 'LATENT'],
            ] as [number, number, number, string, string][])),
        [7, 0, 10, 'positive', 'CONDITIONING'],
        [7, 1, 10, 'negative', 'CONDITIONING'],
        [8, 0, 10, 'sigmas', 'SIGMAS'],
        [9, 0, 10, 'sampler', 'SAMPLER'],
        [10, 0, 11, 'samples', 'LATENT'],
        [1, 2, 11, 'vae', 'VAE'],
        [11, 0, 12, 'images', 'IMAGE'],
        [12, 0, 13, 'video', 'VIDEO'],
      ],
    ),
  };
}

export const ltx2Txt2Video = ltxTail('txt2video');
export const ltx2Img2Video = ltxTail('img2video');

// ---------------------------------------------------------------------------
// HunyuanVideo 1.5 text-to-video
// ---------------------------------------------------------------------------
export const hunyuan15Txt2Video: StudioTemplate = {
  id: 'hunyuan15-txt2video',
  name: 'HunyuanVideo 1.5 Text to Video',
  description: 'HunyuanVideo 1.5 skeleton: UNETLoader + DualCLIPLoader (Qwen2.5-VL + byT5) + EmptyHunyuanLatentVideo + KSampler.',
  kind: 'txt2video',
  engine: 'HunyuanVideo 1.5',
  tags: ['video', 'hunyuan', 't2v', 'primary'],
  requires: ['UNETLoader', 'DualCLIPLoader', 'ModelSamplingSD3', 'EmptyHunyuanLatentVideo', 'KSampler', 'CreateVideo', 'SaveVideo'],
  models: [
    { folder: 'diffusion_models', file: 'hunyuanvideo1.5_720p_t2v_fp16.safetensors' },
    { folder: 'text_encoders', file: 'qwen_2.5_vl_7b_fp8_scaled.safetensors' },
    { folder: 'text_encoders', file: 'byt5_small_glyphxl_fp16.safetensors' },
    { folder: 'vae', file: 'hunyuanvideo15_vae_fp16.safetensors' },
  ],
  resolutionPresets: [
    { label: '480p landscape', width: 848, height: 480 },
    { label: '480p portrait', width: 480, height: 848 },
    { label: '720p landscape', width: 1280, height: 720 },
    { label: '720p portrait', width: 720, height: 1280 },
  ],
  params: [
    ...promptParams(3, 4),
    { key: 'model', label: 'Diffusion model', type: 'combo', role: 'model', bindings: [{ node: { id: 1 }, widget: 'unet_name' }] },
    { key: 'width', label: 'Width', type: 'number', role: 'width', min: 256, max: 1280, step: 16, bindings: [{ node: { id: 6 }, widget: 'width' }] },
    { key: 'height', label: 'Height', type: 'number', role: 'height', min: 256, max: 1280, step: 16, bindings: [{ node: { id: 6 }, widget: 'height' }] },
    { key: 'frames', label: 'Frames', type: 'number', role: 'frames', min: 1, max: 129, step: 4, description: '4n+1 frames (121 = 5s at 24fps).', bindings: [{ node: { id: 6 }, widget: 'length' }] },
    { key: 'fps', label: 'FPS', type: 'number', role: 'fps', min: 8, max: 60, step: 1, bindings: [{ node: { id: 11 }, widget: 'fps' }] },
    { key: 'steps', label: 'Steps', type: 'number', role: 'steps', min: 1, max: 100, step: 1, bindings: [{ node: { id: 7 }, widget: 'steps' }] },
    { key: 'cfg', label: 'CFG', type: 'number', role: 'cfg', min: 1, max: 20, step: 0.5, bindings: [{ node: { id: 7 }, widget: 'cfg' }] },
    { key: 'seed', label: 'Seed', type: 'seed', role: 'seed', bindings: [{ node: { id: 7 }, widget: 'seed' }] },
    { key: 'shift', label: 'Shift', type: 'number', min: 1, max: 20, step: 0.5, advanced: true, bindings: [{ node: { id: 5 }, widget: 'shift' }] },
    { key: 'sampler', label: 'Sampler', type: 'combo', advanced: true, bindings: [{ node: { id: 7 }, widget: 'sampler_name' }] },
    { key: 'scheduler', label: 'Scheduler', type: 'combo', advanced: true, bindings: [{ node: { id: 7 }, widget: 'scheduler' }] },
  ],
  workflow: buildWorkflow(
    [
      { id: 1, type: 'UNETLoader', title: 'Load Diffusion Model', pos: [40, 60], widgets_values: ['hunyuanvideo1.5_720p_t2v_fp16.safetensors', 'default'], outputs: [['MODEL', 'MODEL']] },
      { id: 2, type: 'DualCLIPLoader', title: 'Text encoders', pos: [40, 200], widgets_values: ['qwen_2.5_vl_7b_fp8_scaled.safetensors', 'byt5_small_glyphxl_fp16.safetensors', 'hunyuan_video_15', 'default'], outputs: [['CLIP', 'CLIP']] },
      { id: 3, type: 'CLIPTextEncode', title: 'Positive Prompt', pos: [360, 200], size: [320, 0], widgets_values: ['a close-up of a hummingbird hovering at a red flower, wings a blur, morning dew, macro cinematic'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#232', bgcolor: '#353' },
      { id: 4, type: 'CLIPTextEncode', title: 'Negative Prompt', pos: [360, 400], size: [320, 0], widgets_values: ['blurry, low quality, distorted, watermark, text, static'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#322', bgcolor: '#533' },
      { id: 5, type: 'ModelSamplingSD3', pos: [360, 60], widgets_values: [7.0], inputs: [['model', 'MODEL']], outputs: [['MODEL', 'MODEL']] },
      { id: 6, type: 'EmptyHunyuanLatentVideo', pos: [360, 600], widgets_values: [848, 480, 73, 1], outputs: [['LATENT', 'LATENT']] },
      { id: 7, type: 'KSampler', pos: [740, 200], widgets_values: [0, 'randomize', 30, 6.0, 'euler', 'simple', 1.0], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 9, type: 'VAELoader', pos: [740, 560], widgets_values: ['hunyuanvideo15_vae_fp16.safetensors'], outputs: [['VAE', 'VAE']] },
      { id: 10, type: 'VAEDecode', pos: [1040, 200], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
      { id: 11, type: 'CreateVideo', pos: [1040, 320], widgets_values: [24, 'auto', 'sRGB', 'none'], inputs: [['images', 'IMAGE'], ['audio', 'AUDIO']], outputs: [['VIDEO', 'VIDEO']] },
      { id: 12, type: 'SaveVideo', pos: [1040, 440], widgets_values: ['video/ComfyUI', 'auto', 'auto'], inputs: [['video', 'VIDEO']] },
    ],
    [
      [1, 0, 5, 'model', 'MODEL'],
      [5, 0, 7, 'model', 'MODEL'],
      [2, 0, 3, 'clip', 'CLIP'],
      [2, 0, 4, 'clip', 'CLIP'],
      [3, 0, 7, 'positive', 'CONDITIONING'],
      [4, 0, 7, 'negative', 'CONDITIONING'],
      [6, 0, 7, 'latent_image', 'LATENT'],
      [7, 0, 10, 'samples', 'LATENT'],
      [9, 0, 10, 'vae', 'VAE'],
      [10, 0, 11, 'images', 'IMAGE'],
      [11, 0, 12, 'video', 'VIDEO'],
    ],
  ),
};

// ---------------------------------------------------------------------------
// AnimateDiff-Evolved + VideoHelperSuite text-to-video (SD1.5)
// ---------------------------------------------------------------------------
export const animateDiffTxt2Video: StudioTemplate = {
  id: 'animatediff-txt2video',
  name: 'AnimateDiff Text to Video (SD1.5)',
  description: 'Classic SD1.5 + AnimateDiff-Evolved motion module, combined to mp4 with VideoHelperSuite.',
  kind: 'txt2video',
  engine: 'AnimateDiff',
  tags: ['video', 'animatediff', 'vhs', 'sd15'],
  requires: ['ADE_AnimateDiffLoaderGen1', 'VHS_VideoCombine'],
  models: [
    { folder: 'checkpoints', file: 'v1-5-pruned-emaonly.safetensors' },
    { folder: 'animatediff_models', file: 'mm_sd_v15_v2.ckpt' },
  ],
  resolutionPresets: [
    { label: 'Square 512', width: 512, height: 512 },
    { label: '768x432', width: 768, height: 432 },
    { label: '432x768', width: 432, height: 768 },
  ],
  params: [
    ...promptParams(3, 4),
    { key: 'model', label: 'Checkpoint', type: 'combo', role: 'model', bindings: [{ node: { id: 1 }, widget: 'ckpt_name' }] },
    { key: 'motion', label: 'Motion module', type: 'combo', bindings: [{ node: { id: 2 }, widget: 'model_name' }] },
    { key: 'width', label: 'Width', type: 'number', role: 'width', min: 256, max: 1024, step: 8, bindings: [{ node: { id: 5 }, widget: 'width' }] },
    { key: 'height', label: 'Height', type: 'number', role: 'height', min: 256, max: 1024, step: 8, bindings: [{ node: { id: 5 }, widget: 'height' }] },
    { key: 'frames', label: 'Frames', type: 'number', role: 'frames', min: 8, max: 64, step: 1, bindings: [{ node: { id: 5 }, widget: 'batch_size' }] },
    { key: 'fps', label: 'FPS', type: 'number', role: 'fps', min: 1, max: 30, step: 1, bindings: [{ node: { id: 8 }, widget: 'frame_rate' }] },
    { key: 'steps', label: 'Steps', type: 'number', role: 'steps', min: 1, max: 100, step: 1, bindings: [{ node: { id: 6 }, widget: 'steps' }] },
    { key: 'cfg', label: 'CFG', type: 'number', role: 'cfg', min: 1, max: 20, step: 0.5, bindings: [{ node: { id: 6 }, widget: 'cfg' }] },
    { key: 'seed', label: 'Seed', type: 'seed', role: 'seed', bindings: [{ node: { id: 6 }, widget: 'seed' }] },
    { key: 'format', label: 'Output format', type: 'combo', advanced: true, bindings: [{ node: { id: 8 }, widget: 'format' }] },
  ],
  workflow: buildWorkflow(
    [
      { id: 1, type: 'CheckpointLoaderSimple', pos: [40, 60], widgets_values: ['v1-5-pruned-emaonly.safetensors'], outputs: [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']] },
      { id: 2, type: 'ADE_AnimateDiffLoaderGen1', title: 'AnimateDiff Loader', pos: [360, 60], widgets_values: ['mm_sd_v15_v2.ckpt', 'autoselect'], inputs: [['model', 'MODEL'], ['context_options', 'CONTEXT_OPTIONS'], ['motion_lora', 'MOTION_LORA'], ['ad_settings', 'AD_SETTINGS'], ['sample_settings', 'SAMPLE_SETTINGS'], ['ad_keyframes', 'AD_KEYFRAMES']], outputs: [['MODEL', 'MODEL']] },
      { id: 3, type: 'CLIPTextEncode', title: 'Positive Prompt', pos: [360, 280], size: [320, 0], widgets_values: ['masterpiece, best quality, a golden retriever running through autumn leaves, dynamic motion'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#232', bgcolor: '#353' },
      { id: 4, type: 'CLIPTextEncode', title: 'Negative Prompt', pos: [360, 480], size: [320, 0], widgets_values: ['(worst quality, low quality:1.4), blurry, watermark, text'], inputs: [['clip', 'CLIP']], outputs: [['CONDITIONING', 'CONDITIONING']], color: '#322', bgcolor: '#533' },
      { id: 5, type: 'EmptyLatentImage', title: 'Frames (batch = frames)', pos: [360, 680], widgets_values: [512, 512, 16], outputs: [['LATENT', 'LATENT']] },
      { id: 6, type: 'KSampler', pos: [740, 200], widgets_values: [0, 'randomize', 20, 7.0, 'euler_ancestral', 'normal', 1.0], inputs: [['model', 'MODEL'], ['positive', 'CONDITIONING'], ['negative', 'CONDITIONING'], ['latent_image', 'LATENT']], outputs: [['LATENT', 'LATENT']] },
      { id: 7, type: 'VAEDecode', pos: [1040, 200], inputs: [['samples', 'LATENT'], ['vae', 'VAE']], outputs: [['IMAGE', 'IMAGE']] },
      { id: 8, type: 'VHS_VideoCombine', title: 'Video Combine', pos: [1040, 320], size: [300, 0], widgets_values: { frame_rate: 8, loop_count: 0, filename_prefix: 'AnimateDiff', format: 'video/h264-mp4', pingpong: false, save_output: true }, inputs: [['images', 'IMAGE'], ['audio', 'AUDIO'], ['meta_batch', 'VHS_BatchManager'], ['vae', 'VAE']], outputs: [['Filenames', 'VHS_FILENAMES']] },
    ],
    [
      [1, 0, 2, 'model', 'MODEL'],
      [2, 0, 6, 'model', 'MODEL'],
      [1, 1, 3, 'clip', 'CLIP'],
      [1, 1, 4, 'clip', 'CLIP'],
      [3, 0, 6, 'positive', 'CONDITIONING'],
      [4, 0, 6, 'negative', 'CONDITIONING'],
      [5, 0, 6, 'latent_image', 'LATENT'],
      [6, 0, 7, 'samples', 'LATENT'],
      [1, 2, 7, 'vae', 'VAE'],
      [7, 0, 8, 'images', 'IMAGE'],
    ],
  ),
};

export const videoTemplates: StudioTemplate[] = [
  wan22Txt2Video,
  wan22Img2Video,
  ltx2Txt2Video,
  ltx2Img2Video,
  hunyuan15Txt2Video,
  animateDiffTxt2Video,
];
