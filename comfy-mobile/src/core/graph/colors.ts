/** Slot / link colours, matching ComfyUI's default palette (colorPalette.ts). */
export const TYPE_COLORS: Record<string, string> = {
  CLIP: '#FFD500',
  CLIP_VISION: '#A8DADC',
  CLIP_VISION_OUTPUT: '#ad7452',
  CONDITIONING: '#FFA931',
  CONTROL_NET: '#6EE7B7',
  IMAGE: '#64B5F6',
  LATENT: '#FF9CF9',
  MASK: '#81C784',
  MODEL: '#B39DDB',
  STYLE_MODEL: '#C2FFAE',
  VAE: '#FF6E6E',
  NOISE: '#B0B0B0',
  GUIDER: '#66FFFF',
  SAMPLER: '#ECB4B4',
  SIGMAS: '#CDFFCD',
  TAESD: '#DCC274',
  UPSCALE_MODEL: '#B4E1EC',
  INT: '#29699C',
  FLOAT: '#A1D996',
  STRING: '#77C9A3',
  BOOLEAN: '#D9A1A1',
  '*': '#9A9A9A',
};

export function typeColor(type: string | undefined): string {
  if (!type) return TYPE_COLORS['*'];
  return TYPE_COLORS[type] ?? TYPE_COLORS['*'];
}

/** Node title colours offered in the node colour picker (LGraphCanvas.node_colors). */
export const NODE_COLORS: Record<string, { color: string; bgcolor: string }> = {
  red: { color: '#322', bgcolor: '#533' },
  brown: { color: '#332922', bgcolor: '#593930' },
  green: { color: '#232', bgcolor: '#353' },
  blue: { color: '#223', bgcolor: '#335' },
  pale_blue: { color: '#2a363b', bgcolor: '#3f5159' },
  cyan: { color: '#233', bgcolor: '#355' },
  purple: { color: '#323', bgcolor: '#535' },
  yellow: { color: '#432', bgcolor: '#653' },
  black: { color: '#222', bgcolor: '#000' },
};
