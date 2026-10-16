/**
 * Review-before-queue step. Shows exactly what will be sent: final prompt
 * (with recipe trigger words), key parameters, validation warnings (missing
 * nodes / model files) and node count. Extension point for the Video Studio
 * "pre-render review" UX.
 */
import { useMemo } from 'react';
import { graphToPrompt, mediaNoun, useSettingsStore } from '../core';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';
import type { StudioModel } from './useStudio';

export function ReviewSheet({ studio, onConfirm, onClose }: { studio: StudioModel; onConfirm: () => void; onClose: () => void }) {
  const { template, values, validation, missingInputs, finalPrompt, recipe } = studio;
  const setSettings = useSettingsStore((s) => s.set);
  const wf = useMemo(() => studio.buildWorkflow(), [studio]);
  const { prompt } = useMemo(() => graphToPrompt(wf), [wf]);

  const keyParams = template.params.filter((p) => p.role && !['positive_prompt', 'negative_prompt', 'reference_image', 'reference_video'].includes(p.role));
  const blocked = validation.missingNodes.length > 0 || missingInputs.length > 0;

  return (
    <Sheet
      title="Review before queue"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Back
          </button>
          <button className="btn primary" style={{ flex: 1 }} disabled={blocked} onClick={onConfirm}>
            <Icon name="play" size={16} /> Queue on server
          </button>
        </>
      }
    >
      <div className="row between" style={{ marginBottom: 8 }}>
        <strong>{template.name}</strong>
        <span className="badge">{template.engine}</span>
      </div>
      {recipe && (
        <div className="small muted" style={{ marginBottom: 8 }}>
          Recipe: <strong>{recipe.name}</strong>
          {recipe.triggerWords.length ? ` · triggers ${recipe.triggerWords.join(', ')}` : ''}
        </div>
      )}
      {studio.loraTriggerWords.length > 0 && (
        <div className="small muted" style={{ marginBottom: 8 }}>
          LoRA trigger words (My Studio): {studio.loraTriggerWords.join(', ')}
        </div>
      )}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="field-label">Final prompt</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{finalPrompt || <span className="muted">(empty)</span>}</div>
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 10 }}>
        {keyParams.map((p) => (
          <div className="list-item" key={p.key} style={{ cursor: 'default', minHeight: 40, padding: '8px 12px' }}>
            <div className="title small">{p.label}</div>
            <div className="small mono ellipsis" style={{ maxWidth: '60%' }}>
              {String(values[p.key] ?? '')}
            </div>
          </div>
        ))}
        {studio.loras.length > 0 && studio.lorasSupported && (
          <div className="list-item" style={{ cursor: 'default', minHeight: 40, padding: '8px 12px' }}>
            <div className="title small">LoRAs</div>
            <div className="small mono" style={{ maxWidth: '60%', textAlign: 'right' }}>
              {studio.loras.map((l) => (
                <div className="ellipsis" key={l.file}>
                  {l.file.split('/').pop()} × {l.strength.toFixed(2)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {validation.missingNodes.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--error-text)', marginBottom: 10 }}>
          <strong className="error-text">Cannot run: missing node types on server</strong>
          <div className="small mono" style={{ marginTop: 4 }}>{validation.missingNodes.join(', ')}</div>
        </div>
      )}
      {missingInputs.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--error-text)', marginBottom: 10 }}>
          <strong className="error-text">Cannot run: reference file not on server</strong>
          <div className="small" style={{ marginTop: 4 }}>
            {missingInputs.map((m) => (
              <div key={m.param.key}>
                {m.param.label}: {m.value ? <span className="mono">{m.value}</span> : '(none chosen)'} — upload {mediaNoun(m.param.type as 'image' | 'video')} in Studio first.
              </div>
            ))}
          </div>
        </div>
      )}
      {validation.missingModels.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--warning)' }}>Model files not found on server</strong>
          <div className="small mono" style={{ marginTop: 4 }}>
            {validation.missingModels.map((m) => `${m.folder}/${m.file}`).join('\n')}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>Pick an installed file in the model dropdowns, or the run will fail at load time.</div>
        </div>
      )}
      <div className="muted small">
        {Object.keys(prompt).length} executable nodes · {wf.nodes.length} total
      </div>
      <label className="row small muted" style={{ marginTop: 14, gap: 8 }}>
        <input type="checkbox" onChange={(e) => setSettings({ reviewBeforeQueue: !e.target.checked })} /> Don't show this review again (re-enable in Settings)
      </label>
    </Sheet>
  );
}
