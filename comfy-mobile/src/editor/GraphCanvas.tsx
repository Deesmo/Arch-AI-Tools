/**
 * Touch-first node graph canvas.
 *
 * Gestures
 *   one finger on background      pan
 *   two fingers                   pinch zoom (about the midpoint)
 *   drag a node                   move (snaps to grid when enabled)
 *   drag from an output pin       new link; drop on an input pin or on a node
 *   drag from a connected input   detach the link and re-drag it
 *   drop a link on empty canvas   open node search filtered by type, auto-connect
 *   tap node                      select (shows SelectionToolbar)
 *   tap widget / double-tap node  open NodeInspector
 *   double-tap background         node search at that point
 *   tap link midpoint             delete link
 *   mouse wheel                   zoom (desktop)
 *
 * The viewport transform is applied directly to the DOM during gestures and
 * committed to the store when the gesture ends, so panning never re-renders
 * the node tree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  firstCompatibleInput,
  firstCompatibleOutput,
  graphBounds,
  inputSlotPos,
  mediaFromOutput,
  outputSlotPos,
  snap,
  useGraphStore,
  useServerStore,
  useSettingsStore,
  api,
  getWidgetValue,
  type GraphLink,
  type MediaItem,
  type Viewport,
} from '../core';
import { useUiStore } from '../shared/ui';
import { LinksLayer, type DragLink } from './LinksLayer';
import { NodeView } from './NodeView';

export interface PendingLink {
  nodeId: number;
  slot: number;
  kind: 'in' | 'out';
  type: string;
  /** Graph position where the link was dropped (new node is placed here). */
  pos: [number, number];
}

interface Props {
  onOpenSearch: (pos: [number, number], pending?: PendingLink) => void;
  onOpenInspector: (nodeId: number) => void;
  /** Receives an imperative "fit to view" function. */
  registerFit: (fn: () => void) => void;
}

type Gesture =
  | { kind: 'pan'; startVp: Viewport; start: [number, number]; moved: boolean }
  | { kind: 'pinch'; startVp: Viewport; startDist: number; startMid: [number, number] }
  | { kind: 'node'; nodeId: number; startPos: [number, number]; start: [number, number]; moved: boolean; widget?: string }
  | { kind: 'link'; nodeId: number; slot: number; slotKind: 'in' | 'out'; type: string; moved: boolean };

const TAP_MOVE = 8;
const TAP_TIME = 350;

export function GraphCanvas({ onOpenSearch, onOpenInspector, registerFit }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport>(useGraphStore.getState().viewport);
  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number; nodeId: number | null }>({ t: 0, x: 0, y: 0, nodeId: null });
  const downTime = useRef(0);
  const [dragLink, setDragLink] = useState<DragLink | null>(null);

  const workflow = useGraphStore((s) => s.workflow);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const select = useGraphStore((s) => s.select);
  const moveNode = useGraphStore((s) => s.moveNode);
  const connect = useGraphStore((s) => s.connect);
  const disconnectInput = useGraphStore((s) => s.disconnectInput);
  const removeLink = useGraphStore((s) => s.removeLink);
  const setViewport = useGraphStore((s) => s.setViewport);

  const execution = useServerStore((s) => s.execution);
  const nodeErrors = useServerStore((s) => s.nodeErrors);
  const { snapToGrid, showGrid, showNodeIds, linkStyle, confirmDelete } = useSettingsStore();
  const ask = useUiStore((s) => s.ask);

  // ---- viewport helpers ---------------------------------------------------
  const applyViewport = useCallback((vp: Viewport) => {
    vpRef.current = vp;
    if (worldRef.current) worldRef.current.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`;
    if (rootRef.current) {
      const g = 20 * vp.scale;
      rootRef.current.style.backgroundSize = `${g}px ${g}px`;
      rootRef.current.style.backgroundPosition = `${vp.x}px ${vp.y}px`;
    }
  }, []);

  useEffect(() => {
    applyViewport(vpRef.current);
  }, [applyViewport]);

  // External viewport changes (e.g. fit on load)
  useEffect(() => {
    const unsub = useGraphStore.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport && s.viewport !== vpRef.current) applyViewport(s.viewport);
    });
    return unsub;
  }, [applyViewport]);

  const toGraph = useCallback((sx: number, sy: number): [number, number] => {
    const rect = rootRef.current?.getBoundingClientRect();
    const vp = vpRef.current;
    return [(sx - (rect?.left ?? 0) - vp.x) / vp.scale, (sy - (rect?.top ?? 0) - vp.y) / vp.scale];
  }, []);

  const fitView = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    const b = graphBounds(useGraphStore.getState().workflow);
    if (!rect) return;
    if (!b) {
      const vp = { x: rect.width / 2, y: rect.height / 2, scale: 1 };
      applyViewport(vp);
      setViewport(vp);
      return;
    }
    const pad = 40;
    const w = b[2] - b[0] + pad * 2;
    const h = b[3] - b[1] + pad * 2;
    const scale = Math.min(2, Math.max(0.15, Math.min(rect.width / w, (rect.height - 160) / h)));
    const vp = {
      x: (rect.width - (b[2] - b[0]) * scale) / 2 - b[0] * scale,
      y: (rect.height - (b[3] - b[1]) * scale) / 2 - b[1] * scale + 20,
      scale,
    };
    applyViewport(vp);
    setViewport(vp);
  }, [applyViewport, setViewport]);

  useEffect(() => registerFit(fitView), [fitView, registerFit]);

  // ---- pointer handling ---------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    downTime.current = performance.now();

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch',
        startVp: vpRef.current,
        startDist: Math.hypot(a[0] - b[0], a[1] - b[1]),
        startMid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      };
      setDragLink(null);
      return;
    }
    if (pointers.current.size > 2) return;

    const target = e.target as HTMLElement;
    const pin = target.closest<HTMLElement>('[data-slot-kind]');
    if (pin) {
      const nodeId = Number(pin.dataset.nodeId);
      const slot = Number(pin.dataset.slotIndex);
      const slotKind = pin.dataset.slotKind as 'in' | 'out';
      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (slotKind === 'in') {
        const input = node.inputs[slot];
        if (input?.link != null) {
          // Detach and continue dragging from the original output.
          const link = workflow.links.find((l) => l[0] === input.link);
          disconnectInput(nodeId, slot);
          if (link) {
            gesture.current = { kind: 'link', nodeId: link[1], slot: link[2], slotKind: 'out', type: link[5], moved: true };
            const origin = workflow.nodes.find((n) => n.id === link[1]);
            if (origin) setDragLink({ from: outputSlotPos(origin, link[2]), to: toGraph(e.clientX, e.clientY), type: link[5] });
            return;
          }
        }
        gesture.current = { kind: 'link', nodeId, slot, slotKind: 'in', type: input?.type ?? '*', moved: false };
        setDragLink({ from: inputSlotPos(node, slot), to: toGraph(e.clientX, e.clientY), type: input?.type ?? '*' });
      } else {
        const out = node.outputs[slot];
        gesture.current = { kind: 'link', nodeId, slot, slotKind: 'out', type: out?.type ?? '*', moved: false };
        setDragLink({ from: outputSlotPos(node, slot), to: toGraph(e.clientX, e.clientY), type: out?.type ?? '*' });
      }
      return;
    }

    const nodeEl = target.closest<HTMLElement>('[data-node-id]');
    if (nodeEl) {
      const nodeId = Number(nodeEl.dataset.nodeId);
      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const widgetEl = target.closest<HTMLElement>('[data-widget]');
      gesture.current = {
        kind: 'node',
        nodeId,
        startPos: [node.pos[0], node.pos[1]],
        start: [e.clientX, e.clientY],
        moved: false,
        widget: widgetEl?.dataset.widget,
      };
      return;
    }

    gesture.current = { kind: 'pan', startVp: vpRef.current, start: [e.clientX, e.clientY], moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture.current;
    if (!g) return;

    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const rect = rootRef.current!.getBoundingClientRect();
      const scale = Math.min(3, Math.max(0.1, g.startVp.scale * (dist / Math.max(1, g.startDist))));
      // Keep the graph point under the start midpoint fixed, then follow the midpoint.
      const gx = (g.startMid[0] - rect.left - g.startVp.x) / g.startVp.scale;
      const gy = (g.startMid[1] - rect.top - g.startVp.y) / g.startVp.scale;
      applyViewport({ x: mid[0] - rect.left - gx * scale, y: mid[1] - rect.top - gy * scale, scale });
      return;
    }

    const dx = e.clientX - (g.kind === 'link' ? 0 : g.start[0]);
    const dy = e.clientY - (g.kind === 'link' ? 0 : g.start[1]);

    if (g.kind === 'pan') {
      if (!g.moved && Math.hypot(dx, dy) > TAP_MOVE) g.moved = true;
      if (g.moved) applyViewport({ ...g.startVp, x: g.startVp.x + dx, y: g.startVp.y + dy });
      return;
    }
    if (g.kind === 'node') {
      if (!g.moved && Math.hypot(dx, dy) > TAP_MOVE) g.moved = true;
      if (g.moved) {
        const s = vpRef.current.scale;
        let nx = g.startPos[0] + dx / s;
        let ny = g.startPos[1] + dy / s;
        if (snapToGrid) {
          nx = snap(nx);
          ny = snap(ny);
        }
        moveNode(g.nodeId, [nx, ny]);
      }
      return;
    }
    if (g.kind === 'link') {
      g.moved = true;
      setDragLink((d) => (d ? { ...d, to: toGraph(e.clientX, e.clientY) } : d));
    }
  };

  const finishLink = (g: Extract<Gesture, { kind: 'link' }>, x: number, y: number) => {
    setDragLink(null);
    // Temporarily hide the drag path so elementFromPoint sees what's under it.
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const pin = el?.closest<HTMLElement>('[data-slot-kind]');
    const nodeEl = el?.closest<HTMLElement>('[data-node-id]');
    const wf = useGraphStore.getState().workflow;

    if (pin) {
      const targetNode = Number(pin.dataset.nodeId);
      const targetSlot = Number(pin.dataset.slotIndex);
      const targetKind = pin.dataset.slotKind;
      if (g.slotKind === 'out' && targetKind === 'in') connect(g.nodeId, g.slot, targetNode, targetSlot);
      else if (g.slotKind === 'in' && targetKind === 'out') connect(targetNode, targetSlot, g.nodeId, g.slot);
      return;
    }
    if (nodeEl) {
      const targetId = Number(nodeEl.dataset.nodeId);
      const target = wf.nodes.find((n) => n.id === targetId);
      if (target && targetId !== g.nodeId) {
        if (g.slotKind === 'out') {
          const slot = firstCompatibleInput(target, g.type);
          if (slot >= 0) connect(g.nodeId, g.slot, targetId, slot);
        } else {
          const slot = firstCompatibleOutput(target, g.type);
          if (slot >= 0) connect(targetId, slot, g.nodeId, g.slot);
        }
      }
      return;
    }
    // Dropped on empty canvas: search for a node to connect.
    if (g.moved) {
      const pos = toGraph(x, y);
      onOpenSearch(pos, { nodeId: g.nodeId, slot: g.slot, kind: g.slotKind, type: g.type, pos });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const had = pointers.current.delete(e.pointerId);
    if (!had) return;
    const g = gesture.current;
    const elapsed = performance.now() - downTime.current;

    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) {
        gesture.current = null;
        setViewport(vpRef.current);
      } else {
        // One finger left: continue as a pan from its current position.
        const [remaining] = [...pointers.current.values()];
        gesture.current = { kind: 'pan', startVp: vpRef.current, start: remaining, moved: true };
      }
      return;
    }
    gesture.current = null;
    if (!g) return;

    if (g.kind === 'pan') {
      setViewport(vpRef.current);
      if (!g.moved && elapsed < TAP_TIME) {
        const now = performance.now();
        const lt = lastTap.current;
        if (lt.nodeId === null && now - lt.t < 300 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30) {
          onOpenSearch(toGraph(e.clientX, e.clientY));
          lastTap.current = { t: 0, x: 0, y: 0, nodeId: null };
        } else {
          select(null);
          lastTap.current = { t: now, x: e.clientX, y: e.clientY, nodeId: null };
        }
      }
      return;
    }
    if (g.kind === 'node') {
      if (!g.moved && elapsed < TAP_TIME) {
        const now = performance.now();
        const lt = lastTap.current;
        select(g.nodeId);
        if (g.widget || (lt.nodeId === g.nodeId && now - lt.t < 300)) {
          onOpenInspector(g.nodeId);
          lastTap.current = { t: 0, x: 0, y: 0, nodeId: null };
        } else {
          lastTap.current = { t: now, x: e.clientX, y: e.clientY, nodeId: g.nodeId };
        }
      } else if (g.moved) {
        // Commit the move as a single undoable step.
        const node = useGraphStore.getState().workflow.nodes.find((n) => n.id === g.nodeId);
        if (node) useGraphStore.getState().patchNode(g.nodeId, { pos: node.pos });
      }
      return;
    }
    if (g.kind === 'link') {
      finishLink(g, e.clientX, e.clientY);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragLink(null);
      setViewport(vpRef.current);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = rootRef.current!.getBoundingClientRect();
    const vp = vpRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(3, Math.max(0.1, vp.scale * factor));
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const gx = (px - vp.x) / vp.scale;
    const gy = (py - vp.y) / vp.scale;
    const next = { x: px - gx * scale, y: py - gy * scale, scale };
    applyViewport(next);
    setViewport(next);
  };

  const onTapLink = async (link: GraphLink) => {
    if (confirmDelete) {
      const ok = await ask({ title: 'Delete link?', message: `${link[5]} connection`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    removeLink(link[0]);
  };

  // ---- derived render data -----------------------------------------------
  const mediaByNode = useMemo(() => {
    const map = new Map<number, MediaItem>();
    for (const [nodeId, output] of Object.entries(execution.outputs)) {
      const items = mediaFromOutput(output, nodeId, execution.promptId ?? undefined);
      if (items[0]) map.set(Number(nodeId), items[0]);
    }
    for (const node of workflow.nodes) {
      if (node.type === 'LoadImage' && !map.has(node.id)) {
        const file = getWidgetValue(node, 'image');
        if (typeof file === 'string' && file) {
          const [subfolder, filename] = file.includes('/') ? [file.slice(0, file.lastIndexOf('/')), file.slice(file.lastIndexOf('/') + 1)] : ['', file];
          const ref = { filename, subfolder, type: 'input' };
          map.set(node.id, { kind: 'image', url: api.viewUrl(ref), ref });
        }
      }
    }
    return map;
  }, [execution.outputs, execution.promptId, workflow.nodes]);

  const executingId = execution.status === 'running' && execution.executingNode ? Number(execution.executingNode) : null;
  const progress = execution.progress && execution.progress.max > 0 ? execution.progress.value / execution.progress.max : null;

  return (
    <div
      ref={rootRef}
      className={`canvas-root${showGrid ? ' grid' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={worldRef} className="canvas-world">
        <LinksLayer workflow={workflow} style={linkStyle} dragLink={dragLink} onTapLink={onTapLink} />
        {workflow.nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            executing={executingId === node.id}
            hasError={!!nodeErrors[String(node.id)] || execution.error?.nodeId === String(node.id)}
            media={mediaByNode.get(node.id) ?? null}
            showId={showNodeIds}
            progress={executingId === node.id ? progress : null}
          />
        ))}
      </div>
    </div>
  );
}
