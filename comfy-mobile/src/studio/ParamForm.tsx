/**
 * Renders a template's parameters as a phone-friendly form, grouped by role:
 *   reference media → prompt → model → size → duration → sampling → advanced
 * Params without a role, or marked `advanced`, go into the collapsible
 * Advanced section. Replace/extend per-role renderers here to restyle Studio.
 */
import { useState } from 'react';
import { paramOptions, useServerStore, type StudioTemplate, type TemplateParam, type TemplateValues } from '../core';
import { ComboField, NumberField, SeedField, TextField, ToggleField, UploadField } from '../shared/fields';
import { LoraPicker } from './lora/LoraPicker';

interface Props {
  template: StudioTemplate;
  values: TemplateValues;
  set: (key: string, value: unknown) => void;
  seedMode: 'randomize' | 'fixed';
  setSeedMode: (m: 'randomize' | 'fixed') => void;
  /** Keys of image/video params whose file the server does not have (see `missingReferenceInputs`). */
  missingInputKeys?: string[];
}

export function ParamForm({ template, values, set, seedMode, setSeedMode, missingInputKeys = [] }: Props) {
  const info = useServerStore((s) => s.objectInfo);
  const modelLists = useServerStore((s) => s.modelLists);
  const [showNegative, setShowNegative] = useState(false);
  const [loraFor, setLoraFor] = useState<TemplateParam | null>(null);

  const byRole = (role: TemplateParam['role']) => template.params.filter((p) => p.role === role && !p.advanced);
  const main = new Set<string>();
  const take = (role: TemplateParam['role']) => {
    const list = byRole(role);
    list.forEach((p) => main.add(p.key));
    return list;
  };

  const refs = [...take('reference_image'), ...take('reference_video')];
  const positive = take('positive_prompt')[0];
  const negative = take('negative_prompt')[0];
  const models = take('model');
  const width = take('width')[0];
  const height = take('height')[0];
  const frames = take('frames')[0];
  const fps = take('fps')[0];
  const steps = take('steps')[0];
  const cfg = take('cfg')[0];
  const seed = take('seed')[0];
  const strength = take('strength')[0];
  const loras = take('lora');
  const advanced = template.params.filter((p) => !main.has(p.key));

  const num = (p: TemplateParam) => Number(values[p.key] ?? p.default ?? 0);
  const precisionFor = (p: TemplateParam) => (p.step && p.step < 1 ? Math.max(1, Math.ceil(-Math.log10(p.step))) : 0);

  const renderGeneric = (p: TemplateParam) => {
    switch (p.type) {
      case 'text':
        return <TextField value={String(values[p.key] ?? '')} multiline={p.role === 'positive_prompt' || p.role === 'negative_prompt'} onChange={(v) => set(p.key, v)} />;
      case 'number':
        return <NumberField value={num(p)} min={p.min} max={p.max} step={p.step ?? 1} precision={precisionFor(p)} onChange={(v) => set(p.key, v)} />;
      case 'seed':
        return <SeedField value={num(p)} onChange={(v) => set(p.key, v)} />;
      case 'toggle':
        return <ToggleField value={!!values[p.key]} onChange={(v) => set(p.key, v)} />;
      case 'combo':
        return <ComboField title={p.label} value={String(values[p.key] ?? '')} options={paramOptions(p, template, info)} onChange={(v) => set(p.key, v)} />;
      case 'lora':
        return (
          <button className="btn block" style={{ justifyContent: 'space-between' }} onClick={() => setLoraFor(p)}>
            <span className="ellipsis">{String(values[p.key] ?? '') || 'Choose LoRA…'}</span>
            <span className="muted small">{modelLists.loras ? `${modelLists.loras.length} on server` : ''}</span>
          </button>
        );
      case 'image':
        return <UploadField value={String(values[p.key] ?? '')} kind="image" missing={missingInputKeys.includes(p.key)} onUploaded={(f) => set(p.key, f)} />;
      case 'video':
        return <UploadField value={String(values[p.key] ?? '')} kind="video" missing={missingInputKeys.includes(p.key)} onUploaded={(f) => set(p.key, f)} />;
    }
  };

  const Field = ({ p, children }: { p: TemplateParam; children: React.ReactNode }) => (
    <div className="field">
      <label>{p.label}</label>
      {children}
      {p.description && <div className="field-hint">{p.description}</div>}
    </div>
  );

  const seconds = frames && fps ? (num(frames) / Math.max(1, num(fps))).toFixed(1) : null;

  return (
    <div>
      {refs.map((p) => (
        <Field p={p} key={p.key}>
          {renderGeneric(p)}
        </Field>
      ))}

      {positive && (
        <div className="field">
          <div className="row between">
            <label style={{ margin: 0 }}>{positive.label}</label>
            {negative && (
              <button className="btn ghost sm" onClick={() => setShowNegative((v) => !v)}>
                {showNegative ? 'Hide negative' : 'Negative…'}
              </button>
            )}
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 110, marginTop: 6, fontSize: 16 }}
            value={String(values[positive.key] ?? '')}
            placeholder="Describe the shot: subject, motion, camera, light…"
            onChange={(e) => set(positive.key, e.target.value)}
          />
        </div>
      )}
      {negative && showNegative && (
        <Field p={negative}>
          <TextField value={String(values[negative.key] ?? '')} multiline onChange={(v) => set(negative.key, v)} />
        </Field>
      )}

      {models.map((p) => (
        <Field p={p} key={p.key}>
          <ComboField title={p.label} value={String(values[p.key] ?? '')} options={paramOptions(p, template, info)} onChange={(v) => set(p.key, v)} />
        </Field>
      ))}

      {width && height && (
        <div className="field">
          <label>Resolution</label>
          {template.resolutionPresets && (
            <div className="chips" style={{ marginBottom: 8 }}>
              {template.resolutionPresets.map((r) => {
                const active = num(width) === r.width && num(height) === r.height;
                return (
                  <button
                    key={r.label}
                    className={`chip${active ? ' active' : ''}`}
                    onClick={() => {
                      set(width.key, r.width);
                      set(height.key, r.height);
                    }}
                  >
                    {r.label} <span className="muted">{r.width}×{r.height}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid-2">
            <div>
              <div className="field-label">Width</div>
              <NumberField value={num(width)} min={width.min} max={width.max} step={width.step ?? 8} onChange={(v) => set(width.key, v)} />
            </div>
            <div>
              <div className="field-label">Height</div>
              <NumberField value={num(height)} min={height.min} max={height.max} step={height.step ?? 8} onChange={(v) => set(height.key, v)} />
            </div>
          </div>
        </div>
      )}

      {frames && (
        <div className="field">
          <div className="row between">
            <label style={{ margin: 0 }}>Duration</label>
            {seconds && (
              <span className="muted small">
                {num(frames)} frames @ {num(fps!)} fps ≈ {seconds}s
              </span>
            )}
          </div>
          <div className="grid-2" style={{ marginTop: 6 }}>
            <div>
              <div className="field-label">Frames</div>
              <NumberField value={num(frames)} min={frames.min} max={frames.max} step={frames.step ?? 1} onChange={(v) => set(frames.key, v)} />
            </div>
            {fps && (
              <div>
                <div className="field-label">FPS</div>
                <NumberField value={num(fps)} min={fps.min} max={fps.max} step={fps.step ?? 1} onChange={(v) => set(fps.key, v)} />
              </div>
            )}
          </div>
          {frames.description && <div className="field-hint">{frames.description}</div>}
        </div>
      )}

      {strength && (
        <Field p={strength}>
          <NumberField value={num(strength)} min={strength.min} max={strength.max} step={strength.step ?? 0.05} precision={2} onChange={(v) => set(strength.key, v)} />
        </Field>
      )}

      {(steps || cfg) && (
        <div className="grid-2">
          {steps && (
            <Field p={steps}>
              <NumberField value={num(steps)} min={steps.min} max={steps.max} step={steps.step ?? 1} onChange={(v) => set(steps.key, v)} />
            </Field>
          )}
          {cfg && (
            <Field p={cfg}>
              <NumberField value={num(cfg)} min={cfg.min} max={cfg.max} step={cfg.step ?? 0.5} precision={1} onChange={(v) => set(cfg.key, v)} />
            </Field>
          )}
        </div>
      )}

      {loras.map((p) => (
        <Field p={p} key={p.key}>
          {renderGeneric(p)}
        </Field>
      ))}

      {seed && (
        <div className="field">
          <div className="row between">
            <label style={{ margin: 0 }}>{seed.label}</label>
            <div className="segmented">
              <button className={seedMode === 'randomize' ? 'active' : ''} onClick={() => setSeedMode('randomize')}>
                randomize
              </button>
              <button className={seedMode === 'fixed' ? 'active' : ''} onClick={() => setSeedMode('fixed')}>
                fixed
              </button>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <SeedField value={num(seed)} onChange={(v) => set(seed.key, v)} />
          </div>
        </div>
      )}

      {advanced.length > 0 && (
        <details className="advanced">
          <summary>Advanced ({advanced.length})</summary>
          {advanced.map((p) => (
            <Field p={p} key={p.key}>
              {renderGeneric(p)}
            </Field>
          ))}
        </details>
      )}

      {loraFor && <LoraPicker value={String(values[loraFor.key] ?? '')} onSelect={(f) => set(loraFor.key, f)} onClose={() => setLoraFor(null)} />}
    </div>
  );
}
