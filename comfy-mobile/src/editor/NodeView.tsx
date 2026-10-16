/**
 * Renders a single graph node as DOM (title, slots, widgets, output preview).
 * Pointer interactions are handled by GraphCanvas via data-* attributes:
 *   data-node-id            node container
 *   data-slot-kind/in|out   slot pins (+ data-slot-index)
 *   data-widget             widget rows (tap -> inspector)
 */
import { memo } from 'react';
import {
  NODE_MODE_BYPASS,
  NODE_MODE_MUTED,
  TITLE_H,
  formatNumber,
  hasImageArea,
  imageAreaHeight,
  nodeHeight,
  nodeTitle,
  nodeWidth,
  typeColor,
  visibleWidgets,
  type GraphNode,
  type MediaItem,
  type WidgetDef,
} from '../core';
import { MediaView } from '../shared/MediaView';

export interface NodeViewProps {
  node: GraphNode;
  selected: boolean;
  executing: boolean;
  hasError: boolean;
  media: MediaItem | null;
  showId: boolean;
  /** Progress 0..1 for the executing node, or null. */
  progress: number | null;
}

function widgetDisplay(w: WidgetDef, value: unknown): string {
  if (w.kind === 'number') return formatNumber(value, w);
  if (w.kind === 'toggle') return value ? (w.options.labelOn ?? 'true') : (w.options.labelOff ?? 'false');
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

export const NodeView = memo(function NodeView({ node, selected, executing, hasError, media, showId, progress }: NodeViewProps) {
  const width = nodeWidth(node);
  const hasImg = hasImageArea(node, !!media);
  const height = nodeHeight(node, hasImg);
  const collapsed = !!node.flags?.collapsed;
  const widgets = visibleWidgets(node);
  const rows = Math.max(node.inputs.length, node.outputs.length);
  const classes = ['node'];
  if (selected) classes.push('selected');
  if (executing) classes.push('executing');
  if (hasError) classes.push('error');
  if (node.missing) classes.push('missing');
  if (node.mode === NODE_MODE_BYPASS) classes.push('bypass');
  if (node.mode === NODE_MODE_MUTED) classes.push('muted');
  if (collapsed) classes.push('collapsed');

  const titleStyle = node.color ? { background: node.color } : undefined;
  const bodyStyle = node.bgcolor ? { background: node.bgcolor } : undefined;

  return (
    <div
      className={classes.join(' ')}
      data-node-id={node.id}
      style={{ left: node.pos[0], top: node.pos[1], width, height, ...bodyStyle }}
    >
      <div className="node-title" style={titleStyle} data-node-title>
        <span className="dot" style={{ background: executing ? 'var(--node-executing)' : node.missing ? 'var(--error-text)' : '#666' }} />
        <span className="ellipsis">{nodeTitle(node)}</span>
        {showId && <span className="nid">#{node.id}</span>}
      </div>
      {progress !== null && (
        <div style={{ position: 'absolute', top: TITLE_H - 3, left: 0, right: 0, height: 3, background: '#111' }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--node-executing)' }} />
        </div>
      )}
      {!collapsed && (
        <>
          <div className="node-slots">
            {Array.from({ length: rows }).map((_, i) => {
              const inp = node.inputs[i];
              const out = node.outputs[i];
              return (
                <div className="slot-row" key={i}>
                  {inp ? (
                    <div className="slot in" title={inp.type}>
                      <span
                        className={`pin${inp.link == null ? ' empty' : ''}`}
                        data-slot-kind="in"
                        data-slot-index={i}
                        data-node-id={node.id}
                        style={{ background: typeColor(inp.type), color: typeColor(inp.type) }}
                      />
                      <span className="ellipsis">{inp.label ?? inp.name}{inp.optional ? '' : ''}</span>
                    </div>
                  ) : (
                    <span />
                  )}
                  {out ? (
                    <div className="slot out" title={out.type}>
                      <span
                        className={`pin${out.links.length === 0 ? ' empty' : ''}`}
                        data-slot-kind="out"
                        data-slot-index={i}
                        data-node-id={node.id}
                        style={{ background: typeColor(out.type), color: typeColor(out.type) }}
                      />
                      <span className="ellipsis">{out.label ?? out.name}</span>
                    </div>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          {widgets.length > 0 && (
            <div className="node-widgets">
              {widgets.map((w) => {
                const idx = node.widgets!.indexOf(w);
                const value = node.widgets_values[idx];
                return (
                  <div
                    key={w.name}
                    className={`widget${w.options.multiline ? ' multiline' : ''}`}
                    data-widget={w.name}
                    data-node-id={node.id}
                  >
                    {!w.options.multiline && <span className="wname">{w.kind === 'control' ? 'control' : w.name}</span>}
                    <span className="wval">{widgetDisplay(w, value)}</span>
                    {w.kind === 'combo' && <span className="arrow">▾</span>}
                  </div>
                );
              })}
            </div>
          )}
          {hasImg && (
            <div className="node-image" style={{ height: imageAreaHeight(node) }}>
              {media ? (
                <MediaView item={media} controls={false} cover={false} style={{ maxHeight: '100%' }} />
              ) : (
                <span className="placeholder">no image</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
