/**
 * Library: everything the connected ComfyUI server has — model files per
 * folder (`/models` → `/models/<folder>`), workflows saved from the ComfyUI
 * web UI (`/api/userdata?dir=workflows`), and assets (input images + output
 * history). Read-only against the server; actions route items into Studio,
 * the Graph editor, or the queue.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  api,
  filterModelGroups,
  groupModelFolders,
  historyOrder,
  inputImages,
  loaderFor,
  matchesQuery,
  mediaFromHistoryEntry,
  totalModelCount,
  useLibraryStore,
  useServerStore,
  type MediaItem,
  type ModelGroup,
  type UserWorkflow,
} from '../core';
import { Icon } from '../shared/Icon';
import { MediaView, kindLabel } from '../shared/MediaView';
import { Sheet } from '../shared/Sheet';
import { useUiStore } from '../shared/ui';
import { useLibraryActions } from './useLibraryActions';

type Section = 'models' | 'workflows' | 'assets';

const fmtSize = (n?: number) => (n === undefined ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtDate = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function LibraryScreen() {
  const status = useServerStore((s) => s.status);
  const modelLists = useServerStore((s) => s.modelLists);
  const { folders, foldersError, loadingFolders, workflows, workflowsError, loadingWorkflows, refreshAll, refreshFolders, refreshWorkflows } = useLibraryStore();
  const [section, setSection] = useState<Section>('models');
  const [q, setQ] = useState('');
  const [model, setModel] = useState<{ folder: string; file: string } | null>(null);
  const [workflow, setWorkflow] = useState<UserWorkflow | null>(null);
  const [asset, setAsset] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'connected') return;
    if (!folders && !loadingFolders) void refreshFolders();
    if (!workflows && !loadingWorkflows) void refreshWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, folders, workflows]);

  const groups = useMemo(() => groupModelFolders(folders ?? [], modelLists), [folders, modelLists]);
  const shownGroups = useMemo(() => filterModelGroups(groups, q), [groups, q]);
  const total = totalModelCount(groups);
  const busy = loadingFolders || loadingWorkflows;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>Library</h1>
        <span className="muted small">{status === 'connected' && folders ? `${total} files · ${folders.length} folders` : ''}</span>
        <button className="icon-btn" onClick={() => void refreshAll()} aria-label="Refresh" disabled={status !== 'connected' || busy}>
          <Icon name="refresh" className={busy ? 'spin' : undefined} />
        </button>
      </div>
      <div className="screen-body">
        <div className="field-hint section-hint" style={{ marginBottom: 8 }}>
          Everything on your ComfyUI server, read straight from it: models and LoRAs, workflows you saved there, and your images.
        </div>
        <div className="segmented" style={{ width: '100%', marginBottom: 10 }}>
          {(
            [
              ['models', `Models${folders ? ` · ${total}` : ''}`],
              ['workflows', `Workflows${workflows ? ` · ${workflows.length}` : ''}`],
              ['assets', 'Assets'],
            ] as [Section, string][]
          ).map(([id, label]) => (
            <button key={id} style={{ flex: 1 }} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </div>
        {section !== 'assets' && (
          <div className="row" style={{ marginBottom: 10 }}>
            <Icon name="search" size={18} className="muted" />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={section === 'models' ? 'Search models and LoRAs… (e.g. "wan grain")' : 'Search saved workflows…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
            {q && (
              <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        )}

        {status !== 'connected' && <div className="empty">Connect to a server to browse its library.</div>}

        {status === 'connected' && section === 'models' && (
          <ModelsView groups={shownGroups} query={q} error={foldersError} loading={loadingFolders && !folders} onPick={(folder, file) => setModel({ folder, file })} />
        )}
        {status === 'connected' && section === 'workflows' && (
          <WorkflowsView workflows={workflows} query={q} error={workflowsError} loading={loadingWorkflows && !workflows} onPick={setWorkflow} />
        )}
        {status === 'connected' && section === 'assets' && <AssetsView onPickInput={setAsset} />}
      </div>

      {model && <ModelSheet folder={model.folder} file={model.file} onClose={() => setModel(null)} />}
      {workflow && <WorkflowSheet workflow={workflow} onClose={() => setWorkflow(null)} />}
      {asset && <InputImageSheet file={asset} onClose={() => setAsset(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const PAGE = 100;

function ModelsView({ groups, query, error, loading, onPick }: { groups: ModelGroup[]; query: string; error: string | null; loading: boolean; onPick: (folder: string, file: string) => void }) {
  if (error) return <div className="card small error-text">Could not list models: {error}</div>;
  if (loading) return <div className="empty">Reading the server's model folders…</div>;
  if (!groups.length) return <div className="empty">{query ? `Nothing matches “${query}”.` : 'The server reports no model folders.'}</div>;
  return (
    <>
      {groups.map((g) => (
        <ModelGroupCard key={g.folder} group={g} open={!!query.trim() || g.folder === 'checkpoints' || g.folder === 'loras'} onPick={onPick} />
      ))}
    </>
  );
}

function ModelGroupCard({ group, open, onPick }: { group: ModelGroup; open: boolean; onPick: (folder: string, file: string) => void }) {
  const [limit, setLimit] = useState(PAGE);
  const shown = group.files.slice(0, limit);
  return (
    <details className="lib-group" open={open} key={`${group.folder}-${open}`}>
      <summary>
        <div className="title">
          <div className="row" style={{ gap: 8 }}>
            <span>{group.label}</span>
            <span className={`badge${group.count ? ' blue' : ''}`}>{group.loading ? '…' : group.count}</span>
          </div>
          <div className="sub">{group.blurb}</div>
        </div>
        <Icon name="down" size={16} />
      </summary>
      <div className="card" style={{ padding: 0 }}>
        {group.loading && <div className="empty">Loading…</div>}
        {!group.loading && group.count === 0 && <div className="empty small">Empty on the server.</div>}
        {shown.map((f) => (
          <div className="list-item" key={f} onClick={() => onPick(group.folder, f)}>
            <div className="title">
              <div className="ellipsis">{f.split('/').pop()}</div>
              {f.includes('/') && <div className="sub ellipsis mono">{f.slice(0, f.lastIndexOf('/'))}/</div>}
            </div>
            <Icon name="more" size={16} />
          </div>
        ))}
        {group.files.length > shown.length && (
          <button className="btn ghost block" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, group.files.length - shown.length)} more of {group.files.length - shown.length}
          </button>
        )}
      </div>
    </details>
  );
}

function ModelSheet({ folder, file, onClose }: { folder: string; file: string; onClose: () => void }) {
  const info = useServerStore((s) => s.objectInfo);
  const toast = useUiStore((s) => s.toast);
  const { studioTarget, useInStudio, openInGraph } = useLibraryActions();
  const target = studioTarget(folder, file);
  const loader = loaderFor(folder, file, info);
  const studioLabel =
    target.kind === 'stack' ? 'Add to Studio LoRAs' : target.kind === 'param' ? `Use in Studio (${target.label})` : target.kind === 'prompt' ? 'Add to Studio prompt' : 'Use in Studio';
  return (
    <Sheet title={file.split('/').pop() ?? file} onClose={onClose}>
      <div className="small muted mono" style={{ marginBottom: 10, wordBreak: 'break-all' }}>
        models/{folder}/{file}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Action
          icon="studio"
          label={studioLabel}
          hint={target.kind === 'none' ? target.reason : 'Sets it on the template currently open in Studio'}
          disabled={target.kind === 'none'}
          onClick={() => {
            if (useInStudio(folder, file)) onClose();
          }}
        />
        <Action
          icon="graph"
          label={loader ? `Open in Graph (${loader.type})` : 'Open in Graph'}
          hint={loader ? 'Adds a loader node with this file selected to the current graph' : folder === 'embeddings' ? 'Embeddings are prompt text, not nodes' : 'No node on this server loads this folder'}
          disabled={!loader}
          onClick={() => {
            if (openInGraph(folder, file)) onClose();
          }}
        />
        <Action
          icon="copy"
          label="Copy file name"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(file);
              toast('Copied');
            } catch {
              toast(file);
            }
          }}
        />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

function WorkflowsView({ workflows, query, error, loading, onPick }: { workflows: UserWorkflow[] | null; query: string; error: string | null; loading: boolean; onPick: (w: UserWorkflow) => void }) {
  const setWorkflowsOpen = useUiStore((s) => s.setWorkflowsOpen);
  const setTab = useUiStore((s) => s.setTab);
  const list = (workflows ?? []).filter((w) => matchesQuery(w.name, query));
  return (
    <>
      <div className="section-title">Saved on the server</div>
      <div className="field-hint section-hint" style={{ marginBottom: 6 }}>What you saved in the ComfyUI web UI (its user/default/workflows folder). Open one here or run it as-is.</div>
      {error && <div className="card small error-text">Could not list workflows: {error}</div>}
      {loading && <div className="empty">Loading…</div>}
      {workflows && workflows.length === 0 && <div className="empty">No workflows saved on the server yet. Save one from the ComfyUI web UI and it shows up here.</div>}
      {workflows && workflows.length > 0 && list.length === 0 && <div className="empty">Nothing matches “{query}”.</div>}
      {list.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {list.map((w) => (
            <div className="list-item" key={w.path} onClick={() => onPick(w)}>
              <Icon name="graph" size={20} />
              <div className="title">
                <div className="ellipsis">{w.name.split('/').pop()}</div>
                <div className="sub ellipsis">
                  {w.name.includes('/') ? `${w.name.slice(0, w.name.lastIndexOf('/'))}/ · ` : ''}
                  {[fmtSize(w.size), fmtDate(w.modified)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Icon name="more" size={16} />
            </div>
          ))}
        </div>
      )}
      <div className="section-title" style={{ marginTop: 18 }}>On this device</div>
      <div className="card" style={{ padding: 0 }}>
        <div
          className="list-item"
          onClick={() => {
            setTab('graph');
            setWorkflowsOpen(true);
          }}
        >
          <Icon name="folder" size={20} />
          <div className="title">
            <div>Device workflows & bundled templates</div>
            <div className="sub">Saved from Graph mode or imported from JSON / PNG</div>
          </div>
          <Icon name="chevron" size={16} />
        </div>
      </div>
    </>
  );
}

function WorkflowSheet({ workflow, onClose }: { workflow: UserWorkflow; onClose: () => void }) {
  const { openWorkflow, runWorkflow } = useLibraryActions();
  const connected = useServerStore((s) => s.status === 'connected');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={workflow.name.split('/').pop() ?? workflow.name} onClose={onClose}>
      <div className="small muted mono" style={{ marginBottom: 10, wordBreak: 'break-all' }}>
        workflows/{workflow.path}
        {workflow.size ? ` · ${fmtSize(workflow.size)}` : ''}
        {workflow.modified ? ` · ${fmtDate(workflow.modified)}` : ''}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Action
          icon="graph"
          label="Open in Graph"
          hint="Loads the workflow into the node editor (a copy — the server file is not changed)"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (await openWorkflow(workflow)) onClose();
            setBusy(false);
          }}
        />
        <Action
          icon="play"
          label="Run now"
          hint="Queues it exactly as saved; watch it in the Queue tab"
          disabled={busy || !connected}
          onClick={async () => {
            setBusy(true);
            if (await runWorkflow(workflow)) onClose();
            setBusy(false);
          }}
        />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function AssetsView({ onPickInput }: { onPickInput: (file: string) => void }) {
  const info = useServerStore((s) => s.objectInfo);
  const uploaded = useServerStore((s) => s.uploadedInputs);
  const history = useServerStore((s) => s.history);
  const refreshHistory = useServerStore((s) => s.refreshHistory);
  const openViewer = useUiStore((s) => s.openViewer);
  const setTab = useUiStore((s) => s.setTab);

  const inputs = useMemo(() => inputImages(info, uploaded), [info, uploaded]);
  const inputItems: MediaItem[] = useMemo(
    () => inputs.map((f) => ({ kind: 'image', url: api.viewUrl({ filename: f, subfolder: '', type: 'input' }), ref: { filename: f, subfolder: '', type: 'input' } })),
    [inputs],
  );
  const outputs = useMemo(() => {
    const all: MediaItem[] = [];
    for (const [id, entry] of Object.entries(history ?? {}).sort(historyOrder)) all.push(...mediaFromHistoryEntry(id, entry).filter((m) => m.ref.type !== 'temp'));
    return all;
  }, [history]);

  useEffect(() => {
    if (!history) void refreshHistory();
  }, [history, refreshHistory]);

  return (
    <>
      <div className="section-title">
        Input images ({inputs.length})
      </div>
      <div className="field-hint section-hint" style={{ marginBottom: 6 }}>Pictures in the server's input folder — what Load Image nodes and the Studio reference box can pick from.</div>
      {inputs.length === 0 && <div className="empty small">No images in the server's input folder yet. Upload one from Studio.</div>}
      <div className="media-grid">
        {inputItems.map((m) => (
          <div className="media-tile" key={m.url} onClick={() => onPickInput(m.ref.filename)}>
            <MediaView item={m} cover />
            <span className="kind ellipsis" style={{ maxWidth: '90%' }}>{m.ref.filename}</span>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>
        Outputs ({outputs.length})
        <button className="btn ghost sm" onClick={() => setTab('gallery')}>
          Gallery <Icon name="chevron" size={14} />
        </button>
      </div>
      <div className="field-hint section-hint" style={{ marginBottom: 6 }}>Everything the server still has in its history. Tap to view; the Gallery tab has filters.</div>
      {outputs.length === 0 && <div className="empty small">Nothing generated yet.</div>}
      <div className="media-grid">
        {outputs.slice(0, 60).map((m, i) => (
          <div className="media-tile" key={`${m.url}-${i}`} onClick={() => openViewer(outputs, i)}>
            <MediaView item={m} cover autoPlay={false} />
            <span className="kind">{kindLabel(m)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function InputImageSheet({ file, onClose }: { file: string; onClose: () => void }) {
  const { useAsReference } = useLibraryActions();
  const openViewer = useUiStore((s) => s.openViewer);
  const item: MediaItem = { kind: 'image', url: api.viewUrl({ filename: file, subfolder: '', type: 'input' }), ref: { filename: file, subfolder: '', type: 'input' } };
  return (
    <Sheet title={file} onClose={onClose}>
      <div style={{ borderRadius: 10, overflow: 'hidden', marginBottom: 10, maxHeight: 220 }} onClick={() => openViewer([item])}>
        <MediaView item={item} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', display: 'block', background: '#111' }} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <Action
          icon="image"
          label="Use as reference in Studio"
          hint="Sets it as the reference image of the current (or the image→video) template"
          onClick={() => {
            if (useAsReference(file)) onClose();
          }}
        />
        <Action icon="fit" label="View full size" onClick={() => openViewer([item])} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function Action({ icon, label, hint, disabled, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; hint?: string; disabled?: boolean; onClick: () => void | Promise<void> }) {
  return (
    <div className={`list-item${disabled ? ' disabled' : ''}`} onClick={disabled ? undefined : () => void onClick()} aria-disabled={disabled}>
      <Icon name={icon} size={20} />
      <div className="title">
        <div>{label}</div>
        {hint && <div className="sub">{hint}</div>}
      </div>
      <Icon name="chevron" size={16} />
    </div>
  );
}
