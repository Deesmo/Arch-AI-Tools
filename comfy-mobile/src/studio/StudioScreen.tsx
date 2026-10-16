/**
 * Studio mode — the simplified, phone-first creation UI.
 *
 * Layout (top → bottom):
 *   CreateBar      mode chips (Text→Video / Image→Video / Image) + template + recipe
 *   ParamForm      role-grouped parameters for the selected template
 *   GenerateBar    sticky Generate button with validation state
 *   ResultsFeed    live run + finished results (video first)
 *
 * All ComfyUI interaction goes through `useStudio()`; swap any of the
 * components above to restyle without touching the engine.
 */
import { useState } from 'react';
import { useSettingsStore, type TemplateKind } from '../core';
import { Icon } from '../shared/Icon';
import { useUiStore } from '../shared/ui';
import { Hint, ParamForm } from './ParamForm';
import { ResultsFeed } from './ResultsFeed';
import { ReviewSheet } from './ReviewSheet';
import { TemplatePicker, kindLabel } from './TemplatePicker';
import { RecipePicker } from './recipes/RecipePicker';
import { useStudio } from './useStudio';

const MODES: { kinds: TemplateKind[]; label: string; icon: 'video' | 'image' }[] = [
  { kinds: ['txt2video'], label: 'Text → Video', icon: 'video' },
  { kinds: ['img2video', 'video2video'], label: 'Image → Video', icon: 'video' },
  { kinds: ['txt2img', 'img2img'], label: 'Image', icon: 'image' },
];

export function StudioScreen() {
  const studio = useStudio();
  const { template, templates, values, set, validation, missingInputs, connected, recipe } = studio;
  const reviewBeforeQueue = useSettingsStore((s) => s.reviewBeforeQueue);
  const setTab = useUiStore((s) => s.setTab);
  const [picker, setPicker] = useState(false);
  const [recipes, setRecipes] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);

  const runGenerate = async () => {
    setBusy(true);
    try {
      const id = await studio.generate();
      if (id) setReview(false);
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = () => {
    if (reviewBeforeQueue) setReview(true);
    else void runGenerate();
  };

  const switchMode = (kinds: TemplateKind[]) => {
    if (kinds.includes(template.kind)) return;
    const next = templates.find((t) => kinds.includes(t.kind) && t.tags?.includes('primary')) ?? templates.find((t) => kinds.includes(t.kind));
    if (next) studio.selectTemplate(next.id);
  };

  const blocked = validation.missingNodes.length > 0;
  const needsUpload = missingInputs.length > 0;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>Studio</h1>
        <button className="btn sm" onClick={() => setRecipes(true)}>
          <Icon name="save" size={14} /> {recipe ? recipe.name : 'Recipes'}
        </button>
        <button
          className="icon-btn"
          aria-label="Open in Graph mode"
          title="Open in Graph mode"
          onClick={() => {
            studio.openInGraph();
            setTab('graph');
          }}
        >
          <Icon name="graph" />
        </button>
      </div>

      <div className="screen-body" style={{ paddingBottom: 0 }}>
        {/* CreateBar */}
        <Hint>Pick what to make, choose a template, fill in the prompt, then Generate. Everything runs on your own ComfyUI server.</Hint>
        <div className="segmented" style={{ width: '100%', marginBottom: 10, marginTop: 6 }}>
          {MODES.map((m) => (
            <button key={m.label} style={{ flex: 1 }} className={m.kinds.includes(template.kind) ? 'active' : ''} onClick={() => switchMode(m.kinds)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="template-card active" onClick={() => setPicker(true)} style={{ marginBottom: 14 }}>
          <div className="icon">
            <Icon name={template.kind.includes('video') ? 'video' : 'image'} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{template.name}</h3>
            <p>{kindLabel(template.kind)} · {template.engine}</p>
            <div className="meta">
              {validation.unknown && <span className="badge">not connected</span>}
              {!validation.unknown && blocked && <span className="badge red">{validation.missingNodes.length} missing node types</span>}
              {!validation.unknown && !blocked && validation.missingModels.length > 0 && <span className="badge amber">{validation.missingModels.length} model files not found</span>}
              {!validation.unknown && !blocked && validation.missingModels.length === 0 && <span className="badge green">ready</span>}
            </div>
          </div>
          <Icon name="down" size={18} />
        </div>

        {blocked && (
          <div className="card" style={{ borderColor: 'var(--error-text)', marginBottom: 12 }}>
            <strong className="error-text">This template needs node types the server does not have</strong>
            <div className="small mono" style={{ marginTop: 4 }}>{validation.missingNodes.join(', ')}</div>
            <div className="small muted" style={{ marginTop: 4 }}>Install the matching custom node pack on the server (ComfyUI Manager), or pick another template.</div>
          </div>
        )}

        <ParamForm
          template={template}
          values={values}
          set={set}
          seedMode={studio.seedMode}
          setSeedMode={studio.setSeedMode}
          missingInputKeys={missingInputs.map((m) => m.param.key)}
          loraStack={studio.lorasSupported ? { loras: studio.loras, add: studio.addLora, remove: studio.removeLora, setStrength: studio.setLoraStrength } : undefined}
        />
      </div>

      {/* GenerateBar */}
      <div className="generate-bar">
        <button className="btn primary block" style={{ minHeight: 50, fontSize: 16 }} disabled={!connected || blocked || needsUpload || busy} onClick={onGenerate}>
          <Icon name="play" size={18} />{' '}
          {busy ? 'Queuing…' : !connected ? 'Not connected' : needsUpload ? `Upload ${missingInputs[0].param.type === 'video' ? 'a video' : 'an image'} to continue` : `Generate ${template.kind.includes('video') ? 'video' : 'image'}`}
        </button>
        {needsUpload && !blocked && (
          <div className="small" style={{ color: 'var(--warning)' }}>
            {missingInputs.map((m) => (m.value ? `“${m.value}” is not on this server — upload a ${m.param.type} for ${m.param.label}.` : `${m.param.label}: upload a ${m.param.type} first.`)).join(' ')}
          </div>
        )}
        {validation.missingModels.length > 0 && !blocked && (
          <div className="small" style={{ color: 'var(--warning)' }}>
            {validation.missingModels.length} referenced model file{validation.missingModels.length > 1 ? 's' : ''} not on server — check the model pickers.
          </div>
        )}
      </div>

      <div className="screen-body">
        <div className="section-title">
          Results
          <button className="btn ghost sm" onClick={() => setTab('gallery')}>
            Gallery <Icon name="chevron" size={14} />
          </button>
        </div>
        <Hint>Your latest runs, newest first. Tap one to view it full-screen or reuse its settings.</Hint>
        <ResultsFeed />
      </div>

      {picker && <TemplatePicker templates={templates} current={template.id} onPick={studio.selectTemplate} onClose={() => setPicker(false)} />}
      {recipes && <RecipePicker template={template} currentValues={values} onClose={() => setRecipes(false)} />}
      {review && <ReviewSheet studio={studio} onConfirm={() => void runGenerate()} onClose={() => setReview(false)} />}
    </div>
  );
}
