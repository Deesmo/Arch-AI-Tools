/** SVG layer drawing links as bezier/linear/straight paths with tappable midpoints. */
import { memo } from 'react';
import { inputSlotPos, outputSlotPos, typeColor, type GraphLink, type LinkStyle, type Workflow } from '../core';

export interface DragLink {
  from: [number, number];
  to: [number, number];
  type: string;
}

export function linkPath(a: [number, number], b: [number, number], style: LinkStyle): string {
  const [x1, y1] = a;
  const [x2, y2] = b;
  if (style === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
  if (style === 'linear') {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} L ${x1 + 10} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2 - 10} ${y2} L ${x2} ${y2}`;
  }
  const dist = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dist} ${y1}, ${x2 - dist} ${y2}, ${x2} ${y2}`;
}

export const LinksLayer = memo(function LinksLayer({
  workflow,
  style,
  dragLink,
  onTapLink,
}: {
  workflow: Workflow;
  style: LinkStyle;
  dragLink: DragLink | null;
  onTapLink: (link: GraphLink) => void;
}) {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  return (
    <svg className="links-layer" width={1} height={1}>
      {workflow.links.map((link) => {
        const [id, originId, originSlot, targetId, targetSlot, type] = link;
        const origin = byId.get(originId);
        const target = byId.get(targetId);
        if (!origin || !target) return null;
        const a = outputSlotPos(origin, originSlot);
        const b = inputSlotPos(target, targetSlot);
        const color = typeColor(type);
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return (
          <g key={id}>
            <path d={linkPath(a, b, style)} stroke={color} opacity={0.9} />
            <circle
              className="link-mid"
              cx={mid[0]}
              cy={mid[1]}
              r={7}
              fill="#202020"
              stroke={color}
              strokeWidth={2}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => {
                e.stopPropagation();
                onTapLink(link);
              }}
            />
          </g>
        );
      })}
      {dragLink && (
        <path d={linkPath(dragLink.from, dragLink.to, style)} stroke={typeColor(dragLink.type)} strokeDasharray="6 4" />
      )}
    </svg>
  );
});
