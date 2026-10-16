/**
 * Types describing the ComfyUI server HTTP + WebSocket API.
 * Reference: ComfyUI/server.py and ComfyUI_frontend/src/scripts/api.ts
 */

/** Options object attached to an input spec, e.g. `["INT", { default: 20, min: 1 }]`. */
export interface InputOptions {
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  round?: number | boolean;
  multiline?: boolean;
  dynamicPrompts?: boolean;
  placeholder?: string;
  tooltip?: string;
  forceInput?: boolean;
  defaultInput?: boolean;
  control_after_generate?: boolean;
  image_upload?: boolean;
  label_on?: string;
  label_off?: string;
  /** New-style combo: `["COMBO", { options: [...] }]` */
  options?: unknown[];
  [key: string]: unknown;
}

/**
 * An input spec is `[type]` or `[type, options]`.
 * `type` is a string ("MODEL", "INT", ...) or an array of combo choices.
 */
export type InputSpec = [string | unknown[], InputOptions?];

export interface NodeDef {
  name: string;
  display_name: string;
  description?: string;
  category: string;
  python_module?: string;
  output_node?: boolean;
  deprecated?: boolean;
  experimental?: boolean;
  input: {
    required?: Record<string, InputSpec>;
    optional?: Record<string, InputSpec>;
    hidden?: Record<string, unknown>;
  };
  input_order?: { required?: string[]; optional?: string[] };
  output: (string | unknown[])[];
  output_is_list?: boolean[];
  output_name?: string[];
  output_tooltips?: string[];
}

export type ObjectInfo = Record<string, NodeDef>;

export interface ImageRef {
  filename: string;
  subfolder: string;
  type: 'output' | 'input' | 'temp' | string;
}

export interface NodeOutput {
  images?: ImageRef[];
  gifs?: ImageRef[];
  audio?: ImageRef[];
  text?: string[];
  [key: string]: unknown;
}

/** API prompt (the thing POSTed to /prompt) */
export type ApiPrompt = Record<
  string,
  { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
>;

export interface NodeError {
  errors: { type: string; message: string; details: string; extra_info?: unknown }[];
  dependent_outputs: string[];
  class_type: string;
}

export interface PromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, NodeError>;
}

export interface PromptErrorResponse {
  error: { type: string; message: string; details: string; extra_info?: unknown };
  node_errors: Record<string, NodeError>;
}

/** Queue entry tuple: [number, prompt_id, prompt, extra_data, outputs_to_execute] */
export type QueueItem = [
  number,
  string,
  ApiPrompt,
  { client_id?: string; extra_pnginfo?: { workflow?: unknown } },
  string[],
];

export interface QueueResponse {
  queue_running: QueueItem[];
  queue_pending: QueueItem[];
}

export interface HistoryEntry {
  prompt: QueueItem;
  outputs: Record<string, NodeOutput>;
  status?: {
    status_str: 'success' | 'error' | string;
    completed: boolean;
    messages: [string, Record<string, unknown>][];
  };
  meta?: Record<string, unknown>;
}

export type History = Record<string, HistoryEntry>;

export interface SystemStats {
  system: {
    os: string;
    python_version?: string;
    comfyui_version?: string;
    pytorch_version?: string;
    embedded_python?: boolean;
    ram_total?: number;
    ram_free?: number;
  };
  devices: {
    name: string;
    type: string;
    index?: number;
    vram_total: number;
    vram_free: number;
    torch_vram_total?: number;
    torch_vram_free?: number;
  }[];
}

export interface UploadResponse {
  name: string;
  subfolder: string;
  type: string;
}

// ---- WebSocket messages -------------------------------------------------

export interface WsStatus {
  type: 'status';
  data: { status: { exec_info: { queue_remaining: number } }; sid?: string };
}
export interface WsExecutionStart {
  type: 'execution_start';
  data: { prompt_id: string; timestamp?: number };
}
export interface WsExecuting {
  type: 'executing';
  data: { node: string | null; display_node?: string | null; prompt_id?: string };
}
export interface WsProgress {
  type: 'progress';
  data: { value: number; max: number; prompt_id?: string; node?: string | null };
}
export interface WsExecuted {
  type: 'executed';
  data: { node: string; display_node?: string; output: NodeOutput; prompt_id: string };
}
export interface WsExecutionCached {
  type: 'execution_cached';
  data: { nodes: string[]; prompt_id: string };
}
export interface WsExecutionError {
  type: 'execution_error';
  data: {
    prompt_id: string;
    node_id: string;
    node_type: string;
    exception_message: string;
    exception_type: string;
    traceback: string[];
  };
}
export interface WsExecutionSuccess {
  type: 'execution_success';
  data: { prompt_id: string };
}
export interface WsExecutionInterrupted {
  type: 'execution_interrupted';
  data: { prompt_id: string; node_id: string; node_type: string; executed: string[] };
}
export interface WsGeneric {
  type: string;
  data: unknown;
}

export type WsMessage =
  | WsStatus
  | WsExecutionStart
  | WsExecuting
  | WsProgress
  | WsExecuted
  | WsExecutionCached
  | WsExecutionError
  | WsExecutionSuccess
  | WsExecutionInterrupted
  | WsGeneric;

/** Binary preview frame decoded from the socket. */
export interface PreviewFrame {
  type: 'preview';
  blob: Blob;
  mime: string;
}
