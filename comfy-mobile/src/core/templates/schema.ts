/**
 * Studio template schema.
 *
 * A template is a plain ComfyUI workflow JSON plus a list of *parameters*
 * that bind to node widgets. The Studio layer renders a form from `params`,
 * the engine writes the values into the workflow, and the result goes
 * through the normal graph -> prompt -> /prompt path.
 *
 * See ARCHITECTURE.md "Template parameter binding" for the full description.
 */

/** How to find a node inside the template workflow. */
export type NodeRef =
  | { id: number }
  | { title: string }
  | { type: string; index?: number };

/** One widget (or node mode) to write a parameter value into. */
export interface Binding {
  node: NodeRef;
  /** Widget name on the node. Ignored when `target` is "mode". */
  widget: string;
  /**
   * "widget" (default) writes the value into `widget`.
   * "mode" treats the value as a boolean: true => node active, false => bypassed.
   * Used for optional nodes such as a speed-up LoRA loader.
   */
  target?: 'widget' | 'mode';
  /** Optional value transform applied before writing. */
  transform?: 'seconds_to_frames' | 'frames_plus_one' | 'half' | 'identity';
}

export type ParamType =
  | 'text' // STRING (multiline for prompts)
  | 'number' // INT / FLOAT
  | 'seed' // INT with randomize/fixed control
  | 'combo' // choices (from object_info when `optionsFrom` is omitted)
  | 'toggle' // BOOLEAN
  | 'image' // uploads to /upload/image and writes the filename to a LoadImage combo
  | 'video' // uploads a video file and writes the filename to a LoadVideo combo
  | 'lora'; // picks a file from /models/loras (LoRA Lab extension point)

/**
 * Semantic role used by the Studio UI for layout (prompt box, resolution
 * chips, duration slider...). Params without a role render in "Advanced".
 */
export type ParamRole =
  | 'positive_prompt'
  | 'negative_prompt'
  | 'width'
  | 'height'
  | 'frames'
  | 'fps'
  | 'steps'
  | 'cfg'
  | 'seed'
  | 'model'
  | 'reference_image'
  | 'reference_video'
  | 'strength'
  | 'lora'
  | 'other';

export interface TemplateParam {
  key: string;
  label: string;
  type: ParamType;
  role?: ParamRole;
  description?: string;
  bindings: Binding[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  /** Fixed choices; otherwise derived from the first binding's widget in object_info. */
  options?: string[];
  /** Show in the Advanced section even if it has a role. */
  advanced?: boolean;
}

export type TemplateKind = 'txt2video' | 'img2video' | 'video2video' | 'txt2img' | 'img2img';

export interface StudioTemplate {
  id: string;
  name: string;
  description: string;
  kind: TemplateKind;
  /** Model family label shown as a chip (Wan, Hunyuan, LTX, AnimateDiff, SD1.5...). */
  engine: string;
  tags?: string[];
  /** Node types that must exist in /object_info for this template to run. */
  requires: string[];
  /** Models (by folder) the template references, for the "missing models" hint. */
  models?: { folder: string; file: string }[];
  params: TemplateParam[];
  /** Raw ComfyUI workflow JSON (LiteGraph serialised format). */
  workflow: unknown;
  /** Resolution presets offered when width+height params exist. */
  resolutionPresets?: { label: string; width: number; height: number }[];
}

export type TemplateValues = Record<string, unknown>;
