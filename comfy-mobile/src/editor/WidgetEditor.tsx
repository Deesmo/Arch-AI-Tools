/** Maps a WidgetDef to the right shared field editor. */
import { useServerStore, type GraphNode, type WidgetDef } from '../core';
import { ComboField, NumberField, SeedField, TextField, ToggleField, UploadField } from '../shared/fields';

export function WidgetEditor({
  node,
  widget,
  value,
  onChange,
  onChangeControl,
  controlValue,
}: {
  node: GraphNode;
  widget: WidgetDef;
  value: unknown;
  onChange: (v: unknown) => void;
  controlValue?: string;
  onChangeControl?: (c: string) => void;
}) {
  const modelLists = useServerStore((s) => s.modelLists);
  switch (widget.kind) {
    case 'combo': {
      const options = widget.options.values ?? [];
      // Merge in a freshly fetched model list if the combo looks like a model picker.
      const extra = widget.name === 'lora_name' ? modelLists.loras : widget.name === 'ckpt_name' ? modelLists.checkpoints : undefined;
      const merged = extra ? [...new Set([...options, ...extra])] : options;
      return (
        <div>
          <ComboField title={`${node.title ?? node.type} · ${widget.label ?? widget.name}`} value={String(value ?? '')} options={merged} onChange={onChange} />
          {widget.options.imageUpload && (
            <div style={{ marginTop: 8 }}>
              <UploadField value={String(value ?? '')} kind={node.type.toLowerCase().includes('video') ? 'video' : 'image'} onUploaded={onChange} />
            </div>
          )}
        </div>
      );
    }
    case 'number': {
      const isSeed = /seed/i.test(widget.name) && widget.type === 'INT';
      if (isSeed) {
        return (
          <SeedField
            value={Number(value ?? 0)}
            control={controlValue}
            onChange={onChange}
            onChangeControl={onChangeControl}
            max={widget.options.max}
          />
        );
      }
      return (
        <NumberField
          value={Number(value ?? 0)}
          min={widget.options.min}
          max={widget.options.max}
          step={widget.options.step}
          precision={widget.options.precision ?? 0}
          onChange={onChange}
        />
      );
    }
    case 'toggle':
      return <ToggleField value={!!value} onChange={onChange} labelOn={widget.options.labelOn} labelOff={widget.options.labelOff} />;
    case 'text':
      return <TextField value={String(value ?? '')} multiline={widget.options.multiline} placeholder={widget.options.placeholder} onChange={onChange} />;
    case 'control':
      return null;
    default:
      return <TextField value={String(value ?? '')} onChange={onChange} />;
  }
}
