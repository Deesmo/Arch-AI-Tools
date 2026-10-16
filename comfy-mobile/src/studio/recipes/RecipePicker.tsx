/**
 * Recipes extension point (stub with working basics).
 *
 * A recipe = template + saved parameter values + trigger words (+ LoRAs).
 * Applying a recipe overlays its values on the Studio form and injects its
 * trigger words into the prompt at generate time (see `bindTriggerWords`).
 * The Video Studio "author recipes" UI can replace this sheet; the data model
 * lives in `core/recipes`.
 */
import { useMemo, useState } from 'react';
import { useRecipesStore, type StudioTemplate, type TemplateValues } from '../../core';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { useUiStore } from '../../shared/ui';

export function RecipePicker({
  template,
  currentValues,
  onClose,
}: {
  template: StudioTemplate;
  currentValues: TemplateValues;
  onClose: () => void;
}) {
  const allItems = useRecipesStore((s) => s.items);
  const items = useMemo(() => allItems.filter((r) => r.templateId === template.id), [allItems, template.id]);
  const activeId = useRecipesStore((s) => s.activeId);
  const { save, remove, setActive } = useRecipesStore();
  const ask = useUiStore((s) => s.ask);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [words, setWords] = useState('');

  const create = () => {
    // Store everything except the prompt itself so the recipe is reusable.
    const values: TemplateValues = {};
    for (const p of template.params) {
      if (p.role === 'positive_prompt' || p.type === 'image' || p.type === 'video') continue;
      if (currentValues[p.key] !== undefined) values[p.key] = currentValues[p.key];
    }
    const r = save({
      name: name.trim() || `${template.engine} recipe`,
      templateId: template.id,
      values,
      triggerWords: words.split(',').map((w) => w.trim()).filter(Boolean),
      loras: [],
    });
    setActive(r.id);
    setCreating(false);
    onClose();
  };

  return (
    <Sheet
      title="Recipes"
      onClose={onClose}
      footer={
        <button className="btn primary block" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Save current settings as recipe
        </button>
      }
    >
      <div className="card" style={{ padding: 0 }}>
        <div className={`list-item${!activeId ? ' active' : ''}`} onClick={() => { setActive(null); onClose(); }}>
          <div className="title">No recipe (template defaults)</div>
          {!activeId && <Icon name="check" size={18} />}
        </div>
        {items.map((r) => (
          <div key={r.id} className={`list-item${activeId === r.id ? ' active' : ''}`} onClick={() => { setActive(r.id); onClose(); }}>
            <div className="title">
              <div>{r.name}</div>
              <div className="sub">
                {Object.keys(r.values).length} params{r.triggerWords.length ? ` · triggers: ${r.triggerWords.join(', ')}` : ''}
              </div>
            </div>
            <button
              className="icon-btn"
              aria-label="Delete"
              onClick={async (e) => {
                e.stopPropagation();
                if (await ask({ title: `Delete recipe “${r.name}”?`, confirmLabel: 'Delete', danger: true })) remove(r.id);
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="empty">No recipes for {template.name} yet.</div>}
      </div>

      {creating && (
        <Sheet title="New recipe" onClose={() => setCreating(false)} footer={<button className="btn primary block" onClick={create}>Save recipe</button>}>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Cinematic drone look" />
          </div>
          <div className="field">
            <label>Trigger words (comma separated, prepended to the prompt)</label>
            <input className="input" value={words} onChange={(e) => setWords(e.target.value)} placeholder="cinematic, 35mm, film grain" />
          </div>
          <p className="muted small">Saves the current model, resolution, duration, sampling and seed settings for {template.name}. The prompt and reference media are not stored.</p>
        </Sheet>
      )}
    </Sheet>
  );
}
