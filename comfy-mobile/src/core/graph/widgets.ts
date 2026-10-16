/**
 * Derives widgets and slots for a node type from its `/object_info` definition.
 * Mirrors ComfyUI_frontend/src/scripts/widgets.ts semantics:
 *  - INT / FLOAT / STRING / BOOLEAN / combo inputs become widgets
 *  - everything else (MODEL, LATENT, ...) becomes an input slot
 *  - `forceInput: true` turns a widget into a slot
 *  - INT inputs with `control_after_generate` (or named seed/noise_seed) get an
 *    extra "control" widget whose value is stored right after it in widgets_values
 */
import type { InputOptions, InputSpec, NodeDef } from '../api/types';
import type { NodeInputSlot, NodeOutputSlot, WidgetDef } from './types';

export const CONTROL_VALUES = ['fixed', 'increment', 'decrement', 'randomize'] as const;
export type ControlValue = (typeof CONTROL_VALUES)[number];

export interface ResolvedInput {
  name: string;
  type: string;
  optional: boolean;
  /** Set when this input is a widget. */
  widget?: WidgetDef;
}

/** Returns true if the input spec describes a combo box. */
export function isComboSpec(spec: InputSpec): boolean {
  const [type, opts] = spec;
  if (Array.isArray(type)) return true;
  return type === 'COMBO' && Array.isArray(opts?.options);
}

export function comboValues(spec: InputSpec): string[] {
  const [type, opts] = spec;
  const raw = Array.isArray(type) ? type : (opts?.options ?? []);
  return raw.map((v) => String(v));
}

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN']);

export function specTypeName(spec: InputSpec): string {
  const [type] = spec;
  return Array.isArray(type) ? 'COMBO' : type;
}

/** Decides whether a given input spec is rendered as a widget or a slot. */
export function isWidgetInput(spec: InputSpec): boolean {
  const opts = spec[1] ?? {};
  if (opts.forceInput) return false;
  if (isComboSpec(spec)) return true;
  return WIDGET_TYPES.has(specTypeName(spec));
}

function numberWidget(name: string, type: 'INT' | 'FLOAT', opts: InputOptions): WidgetDef {
  const isInt = type === 'INT';
  const step = typeof opts.step === 'number' ? opts.step : isInt ? 1 : 0.1;
  let precision: number | undefined;
  if (!isInt) {
    const round = typeof opts.round === 'number' ? opts.round : undefined;
    const base = round ?? step;
    precision = Math.max(0, Math.min(10, Math.ceil(-Math.log10(base))));
    if (!Number.isFinite(precision)) precision = 2;
  }
  return {
    name,
    kind: 'number',
    type,
    options: {
      min: typeof opts.min === 'number' ? opts.min : isInt ? 0 : -Infinity,
      max: typeof opts.max === 'number' ? opts.max : isInt ? 2 ** 53 : Infinity,
      step,
      round: typeof opts.round === 'number' ? opts.round : undefined,
      precision: isInt ? 0 : precision,
      tooltip: opts.tooltip,
    },
  };
}

export function buildWidget(name: string, spec: InputSpec): WidgetDef {
  const opts = spec[1] ?? {};
  if (isComboSpec(spec)) {
    return {
      name,
      kind: 'combo',
      type: 'COMBO',
      options: {
        values: comboValues(spec),
        imageUpload: !!opts.image_upload,
        tooltip: opts.tooltip,
      },
    };
  }
  const type = specTypeName(spec);
  switch (type) {
    case 'INT':
    case 'FLOAT':
      return numberWidget(name, type, opts);
    case 'BOOLEAN':
      return {
        name,
        kind: 'toggle',
        type,
        options: { labelOn: opts.label_on, labelOff: opts.label_off, tooltip: opts.tooltip },
      };
    case 'STRING':
    default:
      return {
        name,
        kind: 'text',
        type: 'STRING',
        options: {
          multiline: !!opts.multiline,
          placeholder: opts.placeholder,
          tooltip: opts.tooltip,
        },
      };
  }
}

export function needsControlWidget(name: string, spec: InputSpec): boolean {
  const opts = spec[1] ?? {};
  if (specTypeName(spec) !== 'INT') return false;
  if (opts.control_after_generate) return true;
  return name === 'seed' || name === 'noise_seed';
}

export function defaultWidgetValue(widget: WidgetDef, spec?: InputSpec): unknown {
  const def = spec?.[1]?.default;
  switch (widget.kind) {
    case 'combo':
      return def !== undefined ? def : (widget.options.values?.[0] ?? '');
    case 'number':
      if (typeof def === 'number') return def;
      return Math.max(widget.options.min ?? 0, 0) || 0;
    case 'toggle':
      return typeof def === 'boolean' ? def : false;
    case 'control':
      return 'randomize';
    case 'text':
    default:
      return typeof def === 'string' ? def : '';
  }
}

/** Ordered list of inputs for a node def (required first, then optional). */
export function orderedInputs(def: NodeDef): { name: string; spec: InputSpec; optional: boolean }[] {
  const out: { name: string; spec: InputSpec; optional: boolean }[] = [];
  const req = def.input?.required ?? {};
  const opt = def.input?.optional ?? {};
  const reqOrder = def.input_order?.required ?? Object.keys(req);
  const optOrder = def.input_order?.optional ?? Object.keys(opt);
  for (const n of reqOrder) if (req[n]) out.push({ name: n, spec: req[n], optional: false });
  for (const n of Object.keys(req)) if (!reqOrder.includes(n)) out.push({ name: n, spec: req[n], optional: false });
  for (const n of optOrder) if (opt[n]) out.push({ name: n, spec: opt[n], optional: true });
  for (const n of Object.keys(opt)) if (!optOrder.includes(n)) out.push({ name: n, spec: opt[n], optional: true });
  return out;
}

export interface NodeShape {
  inputs: NodeInputSlot[];
  outputs: NodeOutputSlot[];
  widgets: WidgetDef[];
  widgetValues: unknown[];
}

/** Builds the default slots + widgets (+ default values) for a node type. */
export function shapeFromDef(def: NodeDef): NodeShape {
  const inputs: NodeInputSlot[] = [];
  const widgets: WidgetDef[] = [];
  const widgetValues: unknown[] = [];

  for (const { name, spec, optional } of orderedInputs(def)) {
    if (isWidgetInput(spec)) {
      const w = buildWidget(name, spec);
      widgets.push(w);
      widgetValues.push(defaultWidgetValue(w, spec));
      if (needsControlWidget(name, spec)) {
        const c: WidgetDef = {
          name: `${name}_control`,
          kind: 'control',
          type: 'CONTROL',
          options: { controls: name },
        };
        widgets.push(c);
        widgetValues.push('randomize');
      }
    } else {
      inputs.push({ name, type: specTypeName(spec), link: null, optional });
    }
  }

  const outputs: NodeOutputSlot[] = (def.output ?? []).map((t, i) => ({
    name: def.output_name?.[i] ?? (Array.isArray(t) ? 'COMBO' : String(t)),
    type: Array.isArray(t) ? 'COMBO' : String(t),
    links: [],
    slot_index: i,
  }));

  return { inputs, outputs, widgets, widgetValues };
}

/** Widgets for frontend-only node types. */
export function virtualNodeShape(type: string): NodeShape | null {
  switch (type) {
    case 'Note':
    case 'MarkdownNote':
      return {
        inputs: [],
        outputs: [],
        widgets: [{ name: 'text', kind: 'text', type: 'STRING', options: { multiline: true } }],
        widgetValues: [''],
      };
    case 'Reroute':
      return {
        inputs: [{ name: '', type: '*', link: null }],
        outputs: [{ name: '', type: '*', links: [], slot_index: 0 }],
        widgets: [],
        widgetValues: [],
      };
    case 'PrimitiveNode':
      return {
        inputs: [],
        outputs: [{ name: 'connect to widget input', type: '*', links: [], slot_index: 0 }],
        widgets: [],
        widgetValues: [],
      };
    default:
      return null;
  }
}

/** Formats a numeric widget value for display. */
export function formatNumber(value: unknown, widget: WidgetDef): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const p = widget.options.precision ?? 0;
  return p > 0 ? n.toFixed(p) : String(Math.round(n));
}

/** Clamps + rounds a number according to widget options. */
export function clampNumber(value: number, widget: WidgetDef): number {
  const { min = -Infinity, max = Infinity, round, precision } = widget.options;
  let v = Math.min(max, Math.max(min, value));
  if (widget.type === 'INT') v = Math.round(v);
  else if (round) v = Math.round(v / round) * round;
  if (precision !== undefined && precision > 0) v = Number(v.toFixed(precision));
  return v;
}

/** Applies a control value ("randomize" etc.) and returns the next number. */
export function applyControl(value: number, control: ControlValue, widget: WidgetDef): number {
  const step = widget.options.step ?? 1;
  const min = widget.options.min ?? 0;
  const max = Math.min(widget.options.max ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  switch (control) {
    case 'increment':
      return clampNumber(value + step, widget);
    case 'decrement':
      return clampNumber(value - step, widget);
    case 'randomize': {
      const range = Math.max(0, max - min);
      // Keep randomised seeds within the safe-integer range (same as the web UI).
      const r = Math.floor(Math.random() * Math.min(range, 1_125_899_906_842_624)) + min;
      return clampNumber(r, widget);
    }
    case 'fixed':
    default:
      return value;
  }
}
