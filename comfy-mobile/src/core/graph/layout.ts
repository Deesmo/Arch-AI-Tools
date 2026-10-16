/**
 * Node geometry (in graph units). All canvas hit-testing and link routing uses
 * these numbers instead of measuring the DOM, so slot positions are stable
 * while nodes are being dragged.
 */
import type { GraphNode } from './types';

export const TITLE_H = 30;
export const SLOT_H = 20;
export const WIDGET_H = 24;
export const WIDGET_GAP = 4;
export const MULTILINE_H = 72;
export const BODY_PAD = 6;
export const DEFAULT_WIDTH = 240;
export const WIDE_WIDTH = 300;
export const COLLAPSED_WIDTH = 160;
export const GRID = 10;

export function nodeWidth(node: GraphNode): number {
  if (node.flags?.collapsed) return COLLAPSED_WIDTH;
  const w = node.size?.[0];
  if (typeof w === 'number' && w >= 120) return w;
  return node.widgets?.some((x) => x.options.multiline) ? WIDE_WIDTH : DEFAULT_WIDTH;
}

export function slotRows(node: GraphNode): number {
  return Math.max(node.inputs?.length ?? 0, node.outputs?.length ?? 0);
}

/** Height of a single widget row. */
export function widgetHeight(node: GraphNode, index: number): number {
  const w = node.widgets?.[index];
  if (!w) return WIDGET_H;
  return w.options.multiline ? MULTILINE_H : WIDGET_H;
}

/** True if the node should reserve space for an image preview. */
export function hasImageArea(node: GraphNode, hasImages: boolean): boolean {
  if (node.flags?.collapsed) return false;
  return hasImages || node.type === 'LoadImage';
}

export function imageAreaHeight(node: GraphNode): number {
  return Math.round(nodeWidth(node) * 0.66);
}

/** Visible widgets (hidden when converted to an input slot). */
export function visibleWidgets(node: GraphNode) {
  return (node.widgets ?? []).filter((w) => !w.isConvertedToInput);
}

export function nodeHeight(node: GraphNode, hasImages = false): number {
  if (node.flags?.collapsed) return TITLE_H;
  let h = TITLE_H + slotRows(node) * SLOT_H + BODY_PAD;
  const widgets = visibleWidgets(node);
  widgets.forEach((w) => {
    h += (w.options.multiline ? MULTILINE_H : WIDGET_H) + WIDGET_GAP;
  });
  if (hasImageArea(node, hasImages)) h += imageAreaHeight(node) + WIDGET_GAP;
  return Math.max(h, TITLE_H + 2 * BODY_PAD);
}

/** Centre position of an input slot, in graph coordinates. */
export function inputSlotPos(node: GraphNode, slot: number): [number, number] {
  if (node.flags?.collapsed) return [node.pos[0], node.pos[1] + TITLE_H / 2];
  return [node.pos[0], node.pos[1] + TITLE_H + slot * SLOT_H + SLOT_H / 2];
}

/** Centre position of an output slot, in graph coordinates. */
export function outputSlotPos(node: GraphNode, slot: number): [number, number] {
  const w = nodeWidth(node);
  if (node.flags?.collapsed) return [node.pos[0] + w, node.pos[1] + TITLE_H / 2];
  return [node.pos[0] + w, node.pos[1] + TITLE_H + slot * SLOT_H + SLOT_H / 2];
}

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}
