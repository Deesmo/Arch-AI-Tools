/**
 * Internal graph model. It mirrors the LiteGraph "serialized graph" shape that
 * ComfyUI uses for workflow JSON so import/export is nearly 1:1.
 */

export type NodeMode = 0 | 2 | 4; // 0 = always, 2 = muted (never), 4 = bypass
export const NODE_MODE_ALWAYS: NodeMode = 0;
export const NODE_MODE_MUTED: NodeMode = 2;
export const NODE_MODE_BYPASS: NodeMode = 4;

export type WidgetKind = 'combo' | 'number' | 'text' | 'toggle' | 'control';

export interface WidgetDef {
  /** Input name on the node (e.g. "seed"). For control widgets: "<name>_control". */
  name: string;
  kind: WidgetKind;
  /** The raw input type string: INT / FLOAT / STRING / BOOLEAN / COMBO */
  type: string;
  options: {
    values?: string[];
    min?: number;
    max?: number;
    step?: number;
    round?: number;
    precision?: number;
    multiline?: boolean;
    placeholder?: string;
    tooltip?: string;
    imageUpload?: boolean;
    labelOn?: string;
    labelOff?: string;
    /** For 'control' widgets: name of the number widget it controls. */
    controls?: string;
  };
  /** Whether this input also exists as a (hidden) slot; true after "convert to input". */
  isConvertedToInput?: boolean;
}

export interface NodeInputSlot {
  name: string;
  type: string;
  /** Link id or null */
  link: number | null;
  /** Present when this slot is a widget that was converted to an input. */
  widget?: { name: string };
  optional?: boolean;
  label?: string;
}

export interface NodeOutputSlot {
  name: string;
  type: string;
  links: number[];
  slot_index?: number;
  label?: string;
}

export interface GraphNode {
  id: number;
  type: string;
  title?: string;
  pos: [number, number];
  size: [number, number];
  flags: { collapsed?: boolean; pinned?: boolean };
  order: number;
  mode: NodeMode;
  inputs: NodeInputSlot[];
  outputs: NodeOutputSlot[];
  properties: Record<string, unknown>;
  widgets_values: unknown[];
  color?: string;
  bgcolor?: string;
  /**
   * Derived (not serialised): widget definitions resolved from object_info.
   * Rebuilt on load / when object_info arrives.
   */
  widgets?: WidgetDef[];
  /** Derived: true when the node type is unknown to the server. */
  missing?: boolean;
}

/** [id, origin_id, origin_slot, target_id, target_slot, type] */
export type GraphLink = [number, number, number, number, number, string];

export interface GraphGroup {
  title: string;
  bounding: [number, number, number, number];
  color?: string;
  font_size?: number;
}

export interface Workflow {
  last_node_id: number;
  last_link_id: number;
  nodes: GraphNode[];
  links: GraphLink[];
  groups: GraphGroup[];
  config: Record<string, unknown>;
  extra: Record<string, unknown>;
  version: number;
}

export function emptyWorkflow(): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

/** Frontend-only node types that never go to the server. */
export const VIRTUAL_NODE_TYPES = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode']);
