/**
 * Run a copy or workflow card. The sheet keeps the card's preview, prefills
 * the prompt, and lets Brad swap the photo. Queue goes through the app's
 * existing path (subgraph expansion included). A new photo uses the existing
 * ComfyUI image upload. Nothing else in the workflow file is rewritten.
 */
import { useEffect, useState } from 'react';
import {
  SETTINGS_NOT_IN_BUILD,
  applyStudioRunEdits,
  loadStudioWorkflowFile,
  parseWorkflow,
  patchStudioRunFile,
  useServerStore,
  type StudioThumbCopy,
  type StudioThumbWorkflow,
} from '../../core';
import { Sheet } from '../../shared/Sheet';
import { useQueue } from '../../shared/useQueue';
import { useUiStore } from '../../shared/ui';

export type RunPreview =
  | { kind: 'video'; src: string; poster: string | null }
  | { kind: 'image'; src: string }
  | null;

type RunCard = StudioThumbCopy | StudioThumbWorkflow;

export function RunSheet({ card, preview, onClose }: { card: RunCard; preview: RunPreview; onClose: () => void }) {
  const status = useServerStore((s) => s.status);
  const uploadInput = useServerStore((s) => s.uploadInput);
  const { queueWorkflow, queueApiPrompt } = useQueue();
  const toast = useUiStore((s) => s.toast);
  const setTab = useUiStore((s) => s.setTab);
  const [prompt, setPrompt] = useState(card.prompt);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const connected = status === 'connected';
  const canQueue = !!card.workflowFile;
  const promptWritable = card.promptNodeId != null && !!card.promptField;
  const imageWritable = card.imageNodeId != null && !!card.imageField;

  const run = async () => {
    if (!card.workflowFile || busy) return;
    if (!connected) {
      toast('Not connected to a ComfyUI server', 'error');
      return;
    }
    setBusy(true);
    try {
      const json = await loadStudioWorkflowFile(card.workflowFile);
      let uploaded: string | null = null;
      if (file && imageWritable) uploaded = await uploadInput(file, file.name);
      const edits = {
        prompt: promptWritable ? { nodeId: card.promptNodeId!, field: card.promptField!, value: prompt } : null,
        image: uploaded && imageWritable ? { nodeId: card.imageNodeId!, field: card.imageField!, value: uploaded } : null,
      };
      const patched = patchStudioRunFile(json, edits);
      if (patched.format === 'unknown') {
        toast("Couldn't read this card's workflow", 'error');
        return;
      }
      if (patched.format === 'api') {
        if (patched.missed.length) {
          toast(`Couldn't change the ${patched.missed.join(' and ')} on this card`, 'error');
          return;
        }
        const id = await queueApiPrompt(patched.prompt, { source: 'studio' });
        if (id) {
          onClose();
          setTab('queue');
        }
        return;
      }
      // A refreshing node list must not block Run. A cached list is used when
      // one is already loaded; otherwise the existing converter runs without it.
      const info = useServerStore.getState().objectInfo;
      let wf = parseWorkflow(patched.workflow, info);
      if (patched.missed.length) {
        const fallback = applyStudioRunEdits(wf, {
          prompt: patched.missed.includes('prompt') ? edits.prompt : null,
          image: patched.missed.includes('image') ? edits.image : null,
        });
        if (fallback.missed.length) {
          toast(`Couldn't change the ${fallback.missed.join(' and ')} on this card`, 'error');
          return;
        }
        wf = fallback.workflow;
      } else {
        // Named values are already on the file. This lines up a resolved widget
        // the converter addresses by name.
        wf = applyStudioRunEdits(wf, edits).workflow;
      }
      const id = await queueWorkflow(wf, { source: 'studio' });
      if (id) {
        onClose();
        setTab('queue');
      }
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : SETTINGS_NOT_IN_BUILD, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={card.name}
      onClose={onClose}
      className="ms-run-sheet"
      portal
      footer={
        canQueue ? (
          <button type="button" className="btn primary block ms-run-go" disabled={busy} onClick={() => void run()}>
            {busy ? 'Queuing…' : 'Run'}
          </button>
        ) : undefined
      }
    >
      {preview?.kind === 'video' ? (
        <div className="ms-run-preview">
          <video src={preview.src} poster={preview.poster ?? undefined} muted loop playsInline autoPlay />
        </div>
      ) : preview?.kind === 'image' ? (
        <div className="ms-run-preview">
          <img src={localUrl ?? preview.src} alt="" />
        </div>
      ) : localUrl ? (
        <div className="ms-run-preview">
          <img src={localUrl} alt="" />
        </div>
      ) : null}

      {!canQueue && <p className="ms-run-note">{SETTINGS_NOT_IN_BUILD}</p>}
      {canQueue && !connected && <p className="ms-run-note">Not connected to a ComfyUI server</p>}

      <div className="field">
        <label className="field-label" htmlFor="ms-run-prompt">
          Prompt
        </label>
        <textarea
          id="ms-run-prompt"
          className="textarea ms-run-prompt"
          rows={5}
          value={prompt}
          inputMode="text"
          enterKeyHint="done"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
        />
        {!promptWritable && <p className="field-hint">This prompt stays as saved in the workflow.</p>}
      </div>

      <div className="field">
        <div className="field-label">Photo</div>
        <div className="ms-run-file">
          <label className="btn block ms-run-photo">
            New photo
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="ms-run-keep">{file ? `Using ${file.name} instead of the card's image.` : "Keeping the card's image."}</p>
        {file && (
          <button type="button" className="btn ghost ms-run-keep-btn" onClick={() => setFile(null)}>
            Keep the card's image
          </button>
        )}
        {!imageWritable && <p className="field-hint">This photo stays as saved in the workflow.</p>}
      </div>
    </Sheet>
  );
}
