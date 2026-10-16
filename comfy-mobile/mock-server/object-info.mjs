/**
 * Recorded-shape `/object_info` for the node types the bundled templates use,
 * matching ComfyUI 0.3.x core definitions (input order, defaults, ranges) and
 * the two custom-node packs used by the AnimateDiff template.
 *
 * Set MOCK_ALL_NODES=1 to include the custom packs (ADE_*, VHS_*); by default
 * they are omitted so the app's "missing node types" diagnostics are visible.
 */

const SAMPLERS = ['euler', 'euler_cfg_pp', 'euler_ancestral', 'heun', 'heunpp2', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'ddpm', 'lcm', 'res_multistep', 'gradient_estimation', 'er_sde', 'ddim', 'uni_pc', 'uni_pc_bh2'];
const SCHEDULERS = ['simple', 'sgm_uniform', 'karras', 'exponential', 'ddim_uniform', 'beta', 'normal', 'linear_quadratic', 'kl_optimal'];
const CLIP_TYPES = ['stable_diffusion', 'stable_cascade', 'sd3', 'stable_audio', 'mochi', 'ltxv', 'pixart', 'cosmos', 'lumina2', 'wan', 'hidream', 'chroma', 'ace', 'omnigen2', 'qwen_image', 'hunyuan_image', 'flux2'];
const DUAL_CLIP_TYPES = ['sdxl', 'sd3', 'flux', 'hunyuan_video', 'hidream', 'hunyuan_image', 'hunyuan_video_15'];

/** What's "installed" on the mock machine. Deliberately missing a few template defaults. */
export const MODELS = {
  checkpoints: ['v1-5-pruned-emaonly.safetensors', 'ltx-2.3-22b-dev-fp8.safetensors', 'dreamshaper_8.safetensors'],
  diffusion_models: [
    'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
    'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
    'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
    'hunyuanvideo1.5_720p_t2v_fp16.safetensors',
  ],
  text_encoders: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'gemma_3_12B_it.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'byt5_small_glyphxl_fp16.safetensors'],
  clip: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'gemma_3_12B_it.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'byt5_small_glyphxl_fp16.safetensors'],
  vae: ['wan_2.1_vae.safetensors', 'hunyuanvideo15_vae_fp16.safetensors', 'vae-ft-mse-840000-ema-pruned.safetensors'],
  loras: [
    'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
    'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
    'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
    'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
    'wan_cinematic_drone_v2.safetensors',
    'add_detail.safetensors',
  ],
  animatediff_models: ['mm_sd_v15_v2.ckpt'],
  upscale_models: ['RealESRGAN_x4plus.pth'],
  embeddings: [],
};

const INPUT_IMAGES = ['example.png', 'sample.png'];

const INT = (def, min, max, step = 1, extra = {}) => ['INT', { default: def, min, max, step, ...extra }];
const FLOAT = (def, min, max, step = 0.01, extra = {}) => ['FLOAT', { default: def, min, max, step, ...extra }];
const STRING = (def = '', extra = {}) => ['STRING', { default: def, ...extra }];
const BOOL = (def, extra = {}) => ['BOOLEAN', { default: def, ...extra }];
const COMBO = (values, extra = {}) => [values, extra];
const SEED = () => INT(0, 0, 0xffffffffffffffff, 1, { control_after_generate: true, tooltip: 'The random seed used for creating the noise.' });

function def(name, { category, display, desc = '', required = {}, optional = {}, output = [], outputName, outputNode = false, isList = [] }) {
  return {
    input: { required, ...(Object.keys(optional).length ? { optional } : {}) },
    input_order: { required: Object.keys(required), ...(Object.keys(optional).length ? { optional: Object.keys(optional) } : {}) },
    output,
    output_is_list: output.map((_, i) => isList[i] ?? false),
    output_name: outputName ?? output,
    name,
    display_name: display ?? name,
    description: desc,
    python_module: category.startsWith('custom') ? 'custom_nodes.' + name : 'nodes',
    category: category.replace(/^custom:/, ''),
    output_node: outputNode,
  };
}

const core = {
  CheckpointLoaderSimple: def('CheckpointLoaderSimple', {
    category: 'loaders', display: 'Load Checkpoint', desc: 'Loads a diffusion model checkpoint, diffusion models are used to denoise latents.',
    required: { ckpt_name: COMBO(MODELS.checkpoints, { tooltip: 'The name of the checkpoint (model) to load.' }) },
    output: ['MODEL', 'CLIP', 'VAE'],
  }),
  UNETLoader: def('UNETLoader', {
    category: 'advanced/loaders', display: 'Load Diffusion Model',
    required: { unet_name: COMBO(MODELS.diffusion_models), weight_dtype: COMBO(['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2']) },
    output: ['MODEL'],
  }),
  CLIPLoader: def('CLIPLoader', {
    category: 'advanced/loaders', display: 'Load CLIP',
    required: { clip_name: COMBO(MODELS.text_encoders), type: COMBO(CLIP_TYPES) },
    optional: { device: COMBO(['default', 'cpu'], { advanced: true }) },
    output: ['CLIP'],
  }),
  DualCLIPLoader: def('DualCLIPLoader', {
    category: 'advanced/loaders', display: 'DualCLIPLoader',
    required: { clip_name1: COMBO(MODELS.text_encoders), clip_name2: COMBO(MODELS.text_encoders), type: COMBO(DUAL_CLIP_TYPES) },
    optional: { device: COMBO(['default', 'cpu'], { advanced: true }) },
    output: ['CLIP'],
  }),
  VAELoader: def('VAELoader', { category: 'loaders', display: 'Load VAE', required: { vae_name: COMBO(MODELS.vae) }, output: ['VAE'] }),
  LoraLoaderModelOnly: def('LoraLoaderModelOnly', {
    category: 'loaders', display: 'LoraLoaderModelOnly',
    required: { model: ['MODEL'], lora_name: COMBO(MODELS.loras), strength_model: FLOAT(1.0, -100, 100, 0.01) },
    output: ['MODEL'],
  }),
  LoraLoader: def('LoraLoader', {
    category: 'loaders', display: 'Load LoRA',
    required: { model: ['MODEL'], clip: ['CLIP'], lora_name: COMBO(MODELS.loras), strength_model: FLOAT(1.0, -100, 100, 0.01), strength_clip: FLOAT(1.0, -100, 100, 0.01) },
    output: ['MODEL', 'CLIP'],
  }),
  ModelSamplingSD3: def('ModelSamplingSD3', { category: 'advanced/model', required: { model: ['MODEL'], shift: FLOAT(3.0, 0, 100, 0.01) }, output: ['MODEL'] }),
  CLIPTextEncode: def('CLIPTextEncode', {
    category: 'conditioning', display: 'CLIP Text Encode (Prompt)', desc: 'Encodes a text prompt using a CLIP model into an embedding that can be used to guide the diffusion model towards generating specific images.',
    required: { text: STRING('', { multiline: true, dynamicPrompts: true, tooltip: 'The text to be encoded.' }), clip: ['CLIP', { tooltip: 'The CLIP model used for encoding the text.' }] },
    output: ['CONDITIONING'],
  }),
  EmptyLatentImage: def('EmptyLatentImage', {
    category: 'latent', display: 'Empty Latent Image',
    required: { width: INT(512, 16, 16384, 8), height: INT(512, 16, 16384, 8), batch_size: INT(1, 1, 4096) },
    output: ['LATENT'],
  }),
  EmptyHunyuanLatentVideo: def('EmptyHunyuanLatentVideo', {
    category: 'latent/video', display: 'EmptyHunyuanLatentVideo',
    required: { width: INT(848, 16, 16384, 16), height: INT(480, 16, 16384, 16), length: INT(25, 1, 16384, 4), batch_size: INT(1, 1, 4096) },
    output: ['LATENT'],
  }),
  EmptyLTXVLatentVideo: def('EmptyLTXVLatentVideo', {
    category: 'latent/video/ltxv', display: 'EmptyLTXVLatentVideo',
    required: { width: INT(768, 64, 16384, 32), height: INT(512, 64, 16384, 32), length: INT(97, 1, 16384, 8), batch_size: INT(1, 1, 4096) },
    output: ['LATENT'],
  }),
  LTXVImgToVideo: def('LTXVImgToVideo', {
    category: 'conditioning/video_models', display: 'LTXVImgToVideo',
    required: { positive: ['CONDITIONING'], negative: ['CONDITIONING'], vae: ['VAE'], image: ['IMAGE'], width: INT(768, 64, 16384, 32), height: INT(512, 64, 16384, 32), length: INT(97, 9, 16384, 8), batch_size: INT(1, 1, 4096), strength: FLOAT(1.0, 0, 1, 0.01) },
    output: ['CONDITIONING', 'CONDITIONING', 'LATENT'], outputName: ['positive', 'negative', 'latent'],
  }),
  LTXVConditioning: def('LTXVConditioning', {
    category: 'conditioning/video_models',
    required: { positive: ['CONDITIONING'], negative: ['CONDITIONING'], frame_rate: FLOAT(25.0, 0, 1000, 0.01) },
    output: ['CONDITIONING', 'CONDITIONING'], outputName: ['positive', 'negative'],
  }),
  LTXVScheduler: def('LTXVScheduler', {
    category: 'sampling/custom_sampling/schedulers',
    required: { steps: INT(20, 1, 10000), max_shift: FLOAT(2.05, 0, 100, 0.01), base_shift: FLOAT(0.95, 0, 100, 0.01), stretch: BOOL(true, { tooltip: 'Stretch the sigmas to be in the range [terminal, 1].' }), terminal: FLOAT(0.1, 0, 0.99, 0.01) },
    optional: { latent: ['LATENT'] },
    output: ['SIGMAS'],
  }),
  KSamplerSelect: def('KSamplerSelect', { category: 'sampling/custom_sampling/samplers', required: { sampler_name: COMBO(SAMPLERS) }, output: ['SAMPLER'] }),
  SamplerCustom: def('SamplerCustom', {
    category: 'sampling/custom_sampling',
    required: { model: ['MODEL'], add_noise: BOOL(true), noise_seed: SEED(), cfg: FLOAT(8.0, 0, 100, 0.1, { round: 0.01 }), positive: ['CONDITIONING'], negative: ['CONDITIONING'], sampler: ['SAMPLER'], sigmas: ['SIGMAS'], latent_image: ['LATENT'] },
    output: ['LATENT', 'LATENT'], outputName: ['output', 'denoised_output'],
  }),
  KSampler: def('KSampler', {
    category: 'sampling', desc: 'Uses the provided model, positive and negative conditioning to denoise the latent image.',
    required: {
      model: ['MODEL', { tooltip: 'The model used for denoising the input latent.' }], seed: SEED(), steps: INT(20, 1, 10000, 1, { tooltip: 'The number of steps used in the denoising process.' }),
      cfg: FLOAT(8.0, 0, 100, 0.1, { round: 0.01 }), sampler_name: COMBO(SAMPLERS), scheduler: COMBO(SCHEDULERS),
      positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'], denoise: FLOAT(1.0, 0, 1, 0.01),
    },
    output: ['LATENT'],
  }),
  KSamplerAdvanced: def('KSamplerAdvanced', {
    category: 'sampling', display: 'KSampler (Advanced)',
    required: {
      model: ['MODEL'], add_noise: COMBO(['enable', 'disable']), noise_seed: SEED(), steps: INT(20, 1, 10000), cfg: FLOAT(8.0, 0, 100, 0.1, { round: 0.01 }),
      sampler_name: COMBO(SAMPLERS), scheduler: COMBO(SCHEDULERS), positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'],
      start_at_step: INT(0, 0, 10000), end_at_step: INT(10000, 0, 10000), return_with_leftover_noise: COMBO(['disable', 'enable']),
    },
    output: ['LATENT'],
  }),
  VAEDecode: def('VAEDecode', { category: 'latent', display: 'VAE Decode', desc: 'Decodes latent images back into pixel space images.', required: { samples: ['LATENT'], vae: ['VAE'] }, output: ['IMAGE'] }),
  VAEEncode: def('VAEEncode', { category: 'latent', display: 'VAE Encode', required: { pixels: ['IMAGE'], vae: ['VAE'] }, output: ['LATENT'] }),
  LoadImage: def('LoadImage', { category: 'image', display: 'Load Image', required: { image: COMBO(INPUT_IMAGES, { image_upload: true }) }, output: ['IMAGE', 'MASK'] }),
  SaveImage: def('SaveImage', {
    category: 'image', display: 'Save Image', desc: 'Saves the input images to your ComfyUI output directory.', outputNode: true,
    required: { images: ['IMAGE'], filename_prefix: STRING('ComfyUI', { tooltip: 'The prefix for the file to save.' }) },
  }),
  PreviewImage: def('PreviewImage', { category: 'image', display: 'Preview Image', outputNode: true, required: { images: ['IMAGE'] } }),
  CreateVideo: def('CreateVideo', {
    category: 'image/video', display: 'Create Video', desc: 'Create a video from images.',
    required: { images: ['IMAGE', { tooltip: 'The images to create a video from.' }], fps: FLOAT(30.0, 1, 120, 1) },
    optional: { audio: ['AUDIO', { tooltip: 'The audio to add to the video.' }] },
    output: ['VIDEO'],
  }),
  SaveVideo: def('SaveVideo', {
    category: 'image/video', display: 'Save Video', desc: 'Saves the input images to your ComfyUI output directory.', outputNode: true,
    required: { video: ['VIDEO'], filename_prefix: STRING('video/ComfyUI'), format: COMBO(['auto', 'mp4', 'webm', 'mov']), codec: COMBO(['auto', 'h264', 'vp9', 'av1']) },
  }),
  WanImageToVideo: def('WanImageToVideo', {
    category: 'conditioning/video_models',
    required: { positive: ['CONDITIONING'], negative: ['CONDITIONING'], vae: ['VAE'], width: INT(832, 16, 16384, 16), height: INT(480, 16, 16384, 16), length: INT(81, 1, 16384, 4), batch_size: INT(1, 1, 4096) },
    optional: { clip_vision_output: ['CLIP_VISION_OUTPUT'], start_image: ['IMAGE'] },
    output: ['CONDITIONING', 'CONDITIONING', 'LATENT'], outputName: ['positive', 'negative', 'latent'],
  }),
  // A few extra core nodes so the node search has something to browse.
  ImageScale: def('ImageScale', { category: 'image/upscaling', display: 'Upscale Image', required: { image: ['IMAGE'], upscale_method: COMBO(['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos']), width: INT(512, 0, 16384), height: INT(512, 0, 16384), crop: COMBO(['disabled', 'center']) }, output: ['IMAGE'] }),
  ImageBatch: def('ImageBatch', { category: 'image', display: 'Batch Images', required: { image1: ['IMAGE'], image2: ['IMAGE'] }, output: ['IMAGE'] }),
  ConditioningCombine: def('ConditioningCombine', { category: 'conditioning', display: 'Conditioning (Combine)', required: { conditioning_1: ['CONDITIONING'], conditioning_2: ['CONDITIONING'] }, output: ['CONDITIONING'] }),
  LatentUpscale: def('LatentUpscale', { category: 'latent', display: 'Upscale Latent', required: { samples: ['LATENT'], upscale_method: COMBO(['nearest-exact', 'bilinear', 'area', 'bicubic', 'bislerp']), width: INT(512, 0, 16384, 8), height: INT(512, 0, 16384, 8), crop: COMBO(['disabled', 'center']) }, output: ['LATENT'] }),
  CLIPSetLastLayer: def('CLIPSetLastLayer', { category: 'conditioning', display: 'CLIP Set Last Layer', required: { clip: ['CLIP'], stop_at_clip_layer: INT(-1, -24, -1) }, output: ['CLIP'] }),
  CLIPVisionLoader: def('CLIPVisionLoader', { category: 'loaders', display: 'Load CLIP Vision', required: { clip_name: COMBO(['clip_vision_h.safetensors']) }, output: ['CLIP_VISION'] }),
  CLIPVisionEncode: def('CLIPVisionEncode', { category: 'conditioning', display: 'CLIP Vision Encode', required: { clip_vision: ['CLIP_VISION'], image: ['IMAGE'], crop: COMBO(['center', 'none']) }, output: ['CLIP_VISION_OUTPUT'] }),
  LoadVideo: def('LoadVideo', { category: 'image/video', display: 'Load Video', required: { file: COMBO(['sample.mp4'], { video_upload: true }) }, output: ['VIDEO'] }),
  GetVideoComponents: def('GetVideoComponents', { category: 'image/video', display: 'Get Video Components', required: { video: ['VIDEO'] }, output: ['IMAGE', 'AUDIO', 'FLOAT'], outputName: ['images', 'audio', 'fps'] }),
  UpscaleModelLoader: def('UpscaleModelLoader', { category: 'loaders', display: 'Load Upscale Model', required: { model_name: COMBO(MODELS.upscale_models) }, output: ['UPSCALE_MODEL'] }),
  ImageUpscaleWithModel: def('ImageUpscaleWithModel', { category: 'image/upscaling', display: 'Upscale Image (using Model)', required: { upscale_model: ['UPSCALE_MODEL'], image: ['IMAGE'] }, output: ['IMAGE'] }),
  MarkdownNote: def('MarkdownNote', { category: 'utils', display: 'Markdown Note', required: { text: STRING('', { multiline: true }) }, output: [] }),
};

const custom = {
  ADE_AnimateDiffLoaderGen1: def('ADE_AnimateDiffLoaderGen1', {
    category: 'custom:Animate Diff 🎭🅐🅓/① Gen1 nodes ①', display: 'AnimateDiff Loader 🎭🅐🅓①',
    required: { model: ['MODEL'], model_name: COMBO(MODELS.animatediff_models), beta_schedule: COMBO(['autoselect', 'sqrt_linear (AnimateDiff)', 'linear (AnimateDiff-SDXL)', 'linear (HotshotXL/default)', 'avg(sqrt_linear,linear)', 'lcm avg(sqrt_linear,linear)', 'lcm', 'lcm[100_ots]', 'lcm[25_ots]', 'lcm >> sqrt_linear', 'sqrt', 'cosine', 'squaredcos_cap_v2']) },
    optional: { context_options: ['CONTEXT_OPTIONS'], motion_lora: ['MOTION_LORA'], ad_settings: ['AD_SETTINGS'], ad_keyframes: ['AD_KEYFRAMES'], sample_settings: ['SAMPLE_SETTINGS'], scale_multival: ['MULTIVAL'], effect_multival: ['MULTIVAL'] },
    output: ['MODEL'],
  }),
  ADE_AnimateDiffUniformContextOptions: def('ADE_AnimateDiffUniformContextOptions', {
    category: 'custom:Animate Diff 🎭🅐🅓/context opts', display: 'Context Options◆Looped Uniform 🎭🅐🅓',
    required: { context_length: INT(16, 1, 128), context_stride: INT(1, 1, 32), context_overlap: INT(4, 0, 128), context_schedule: COMBO(['uniform', 'uniform_v2', 'static_standard', 'batched']), closed_loop: BOOL(false), fuse_method: COMBO(['flat', 'pyramid']), use_on_equal_length: BOOL(false), start_percent: FLOAT(0, 0, 1, 0.001), guarantee_steps: INT(1, 0, 10000) },
    output: ['CONTEXT_OPTIONS'],
  }),
  VHS_VideoCombine: def('VHS_VideoCombine', {
    category: 'custom:Video Helper Suite 🎥🅥🅗🅢', display: 'Video Combine 🎥🅥🅗🅢', outputNode: true,
    required: { images: ['IMAGE'], frame_rate: INT(8, 1, 1000), loop_count: INT(0, 0, 100), filename_prefix: STRING('AnimateDiff'), format: COMBO(['image/gif', 'image/webp', 'video/h264-mp4', 'video/h265-mp4', 'video/webm', 'video/ProRes']), pingpong: BOOL(false), save_output: BOOL(true) },
    optional: { audio: ['AUDIO'], meta_batch: ['VHS_BatchManager'], vae: ['VAE'] },
    output: ['VHS_FILENAMES'], outputName: ['Filenames'],
  }),
  VHS_LoadVideo: def('VHS_LoadVideo', {
    category: 'custom:Video Helper Suite 🎥🅥🅗🅢', display: 'Load Video (Upload) 🎥🅥🅗🅢',
    required: { video: COMBO(['sample.mp4'], { video_upload: true }), force_rate: FLOAT(0, 0, 60, 1), custom_width: INT(0, 0, 8192, 8), custom_height: INT(0, 0, 8192, 8), frame_load_cap: INT(0, 0, 1000000), skip_first_frames: INT(0, 0, 1000000), select_every_nth: INT(1, 1, 1000000) },
    optional: { meta_batch: ['VHS_BatchManager'], vae: ['VAE'] },
    output: ['IMAGE', 'INT', 'AUDIO', 'VHS_VIDEOINFO'], outputName: ['IMAGE', 'frame_count', 'audio', 'video_info'],
  }),
};

export function buildObjectInfo() {
  const all = process.env.MOCK_ALL_NODES === '1' || process.env.MOCK_ALL_NODES === 'true';
  const omit = new Set((process.env.MOCK_OMIT ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const out = { ...core, ...(all ? custom : {}) };
  for (const k of omit) delete out[k];
  return out;
}
