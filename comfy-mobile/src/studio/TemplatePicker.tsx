/** Sheet listing Studio templates grouped by kind with live availability. */
import { describeValidation, useServerStore, validateTemplate, type StudioTemplate, type TemplateKind } from '../core';
import { Icon } from '../shared/Icon';
import { Sheet } from '../shared/Sheet';

const KIND_LABEL: Record<TemplateKind, string> = {
  txt2video: 'Text → Video',
  img2video: 'Image → Video',
  video2video: 'Video → Video',
  txt2img: 'Text → Image',
  img2img: 'Image → Image',
};

export function kindLabel(kind: TemplateKind): string {
  return KIND_LABEL[kind];
}

export function TemplatePicker({
  templates,
  current,
  onPick,
  onClose,
}: {
  templates: StudioTemplate[];
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const info = useServerStore((s) => s.objectInfo);
  const modelLists = useServerStore((s) => s.modelLists);
  const kinds = [...new Set(templates.map((t) => t.kind))];
  return (
    <Sheet title="Choose a template" onClose={onClose} full>
      {kinds.map((kind) => (
        <div key={kind}>
          <div className="section-title">{KIND_LABEL[kind]}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {templates
              .filter((t) => t.kind === kind)
              .map((t) => {
                const v = validateTemplate(t, info, modelLists);
                return (
                  <div
                    key={t.id}
                    className={`template-card${t.id === current ? ' active' : ''}${v.missingNodes.length ? ' unavailable' : ''}`}
                    onClick={() => {
                      onPick(t.id);
                      onClose();
                    }}
                  >
                    <div className="icon">
                      <Icon name={kind.includes('video') ? 'video' : 'image'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3>{t.name}</h3>
                      <p>{t.description}</p>
                      <div className="meta">
                        <span className="badge">{t.engine}</span>
                        <span className={`badge ${v.unknown ? '' : v.missingNodes.length ? 'red' : v.missingModels.length ? 'amber' : 'green'}`}>
                          {describeValidation(v)}
                        </span>
                      </div>
                      {v.missingNodes.length > 0 && (
                        <div className="small error-text" style={{ marginTop: 6 }}>
                          Missing: {v.missingNodes.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </Sheet>
  );
}
