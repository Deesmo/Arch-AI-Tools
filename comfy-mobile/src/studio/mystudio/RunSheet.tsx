/**
 * Run a copy or workflow card.
 *
 * When the workflow file is a ComfyUI API prompt, Run posts that object
 * through the existing queue path. The only writes are the prompt text, when
 * it was edited, and the image input, when a gallery photo was chosen.
 * Nothing else is rebuilt or removed. An accepted job opens the Queue on the
 * live list. A failed or timed-out post stays here and shows the error.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../core/api/client';
import {
  CARD_CANNOT_BE_BUILT,
  GALLERY_COLUMNS,
  GALLERY_NOT_IN_BUILD,
  SETTINGS_NOT_IN_BUILD,
  absoluteStudioUrl,
  applyApprovedRun,
  applyStudioRunEdits,
  authorGenerateSteps,
  collectStartStills,
  firstOutputImage,
  galleryWindow,
  loadStudioWorkflowFile,
  parseWorkflow,
  peekStudioGallery,
  primeStudioGallery,
  rewriteInAuthorStyle,
  scenesInAuthorPrompt,
  safeImageType,
  SAVED_PHOTO_NOT_ON_SKYTECH,
  safeUploadName,
  spokenLines,
  studioPhotoStatus,
  studioRunEdits,
  submitApiGraph,
  openQueueHistory,
  runStudioCard,
  useServerStore,
  useSettingsStore,
  waitForIdleQueue,
  type AuthorStep,
  type StudioGalleryImage,
  type StudioThumbCopy,
  type StudioThumbWorkflow,
} from '../../core';
import { Sheet } from '../../shared/Sheet';
import { useQueue } from '../../shared/useQueue';
import { useUiStore } from '../../shared/ui';

const GALLERY_VIEW_H = 240;

export type RunPreview =
  | { kind: 'video'; src: string; poster: string | null }
  | { kind: 'image'; src: string }
  | null;

type RunCard = StudioThumbCopy | StudioThumbWorkflow;

type StillState = {
  status: 'running' | 'done' | 'none' | 'error';
  url?: string;
  filename?: string;
  seed?: number;
  error?: string;
  /** Uploaded image this still was conditioned on, when the graph cuts to one. */
  startName?: string | null;
};

function stillKey(stepId: string, scene: number): string {
  return `${stepId}:${scene}`;
}

function GalleryGrid({ images, picked, onPick }: { images: StudioGalleryImage[]; picked: StudioGalleryImage | null; onPick: (image: StudioGalleryImage) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [stride, setStride] = useState(96);
  const [size, setSize] = useState(90);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const gap = 6;
      const width = el.clientWidth;
      if (width <= 0) return;
      const next = (width - gap * (GALLERY_COLUMNS - 1)) / GALLERY_COLUMNS;
      setSize(next);
      setStride(next + gap);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { start, end } = galleryWindow(images.length, scrollTop, GALLERY_VIEW_H, stride, GALLERY_COLUMNS);
  const slice = images.slice(start, end);
  const rows = Math.ceil(images.length / GALLERY_COLUMNS);
  const totalH = Math.max(size, rows * stride - 6);

  return (
    <div
      className="ms-run-gallery"
      ref={scroller}
      role="listbox"
      aria-label="Gallery"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="ms-run-gallery-canvas" style={{ height: totalH }}>
        {slice.map((image, i) => {
          const index = start + i;
          const row = Math.floor(index / GALLERY_COLUMNS);
          const col = index % GALLERY_COLUMNS;
          return (
            <button
              type="button"
              key={image.file}
              role="option"
              aria-selected={picked?.file === image.file}
              className={picked?.file === image.file ? 'is-picked' : undefined}
              style={{ top: row * stride, left: col * stride, width: size, height: size }}
              onClick={() => onPick(image)}
            >
              <img src={image.thumb} alt={image.name} decoding="async" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RunSheet({ card, preview, onClose }: { card: RunCard; preview: RunPreview; onClose: () => void }) {
  const status = useServerStore((s) => s.status);
  const uploadInput = useServerStore((s) => s.uploadInput);
  const { queueWorkflow } = useQueue();
  const toast = useUiStore((s) => s.toast);
  const focusQueuedRun = useUiStore((s) => s.focusQueuedRun);
  const [prompt, setPrompt] = useState(card.prompt);
  const [picked, setPicked] = useState<StudioGalleryImage | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [images, setImages] = useState<StudioGalleryImage[] | null>(() => peekStudioGallery());
  const [galleryNote, setGalleryNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [ownWords, setOwnWords] = useState('');
  const [steps, setSteps] = useState<AuthorStep[] | null>(null);
  const [drafts, setDrafts] = useState<{ id: string; text: string; roll: number }[]>([]);
  const [stills, setStills] = useState<Record<string, StillState>>({});
  const graphRef = useRef<unknown>(null);

  useEffect(() => {
    if (images) return;
    let live = true;
    void primeStudioGallery()
      .then((list) => {
        if (!live) return;
        if (!list.length) setGalleryNote(GALLERY_NOT_IN_BUILD);
        else setImages(list);
      })
      .catch((err: unknown) => {
        if (live) setGalleryNote(err instanceof Error && err.message ? err.message : GALLERY_NOT_IN_BUILD);
      });
    return () => {
      live = false;
    };
  }, [images]);

  useEffect(() => {
    if (!card.workflowFile) {
      setSteps([]);
      return;
    }
    let live = true;
    void loadStudioWorkflowFile(card.workflowFile)
      .then((raw) => {
        if (!live) return;
        graphRef.current = raw;
        setSteps(authorGenerateSteps(raw));
      })
      .catch(() => {
        if (live) setSteps([]);
      });
    return () => {
      live = false;
    };
  }, [card.workflowFile]);

  const connected = status === 'connected';
  const canQueue = !!card.workflowFile;
  const promptWritable = card.promptNodeId != null && !!card.promptField;
  const imageWritable = card.imageNodeId != null && !!card.imageField;

  const inCard = !!steps?.length;
  const imagesReady = inCard && drafts.length > 0 && steps!.every((step) => {
    const count = scenesInAuthorPrompt(step.authorPrompt);
    for (let scene = 1; scene <= count; scene++) {
      const still = stills[stillKey(step.id, scene)];
      if (still?.status !== 'done' && still?.status !== 'none') return false;
    }
    return true;
  });

  const generatePrompts = () => {
    if (!steps?.length || !ownWords.trim()) return;
    setDrafts(steps.map((step) => ({ id: step.id, text: rewriteInAuthorStyle(step.authorPrompt, ownWords, 0, { kind: step.kind, engine: step.engine }), roll: 0 })));
    setStills({});
    setResult(null);
  };

  const rerollPrompt = (step: AuthorStep) => {
    setDrafts((prev) => prev.map((draft) => (
      draft.id === step.id
        ? { ...draft, roll: draft.roll + 1, text: rewriteInAuthorStyle(step.authorPrompt, ownWords, draft.roll + 1, { kind: step.kind, engine: step.engine }) }
        : draft
    )));
    setStills({});
  };

  const waitHistory = async (promptId: string) => {
    for (;;) {
      const history = await api.getHistory(32);
      const entry = history[promptId];
      if (entry?.status?.completed || entry?.status?.status_str === 'error' || (entry?.outputs && Object.keys(entry.outputs).length)) return entry;
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  };

  const makeScene = async (step: AuthorStep, scene: number, text: string, priorName: string | null) => {
    const key = stillKey(step.id, scene);
    const seed = 1 + Math.floor(Math.random() * 2_000_000_000);
    const { stills: built, skipped } = collectStartStills(graphRef.current, text, seed);
    const skip = skipped.find((item) => item.stepId === step.id && item.scene === scene);
    const match = built.find((item) => item.stepId === step.id && item.scene === scene);
    if (skip || !match) {
      setStills((prev) => ({ ...prev, [key]: { status: 'none', error: 'This scene has no separate still. Render uses the prompt.' } }));
      return priorName;
    }
    const prompt = match.prompt;
    let startName: string | null = null;
    const load = prompt.incard_load;
    if (load && load.inputs.image === 'start.png') {
      if (!priorName) {
        setStills((prev) => ({ ...prev, [key]: { status: 'error', error: 'This scene needs the previous start image.', seed } }));
        throw new Error('This scene needs the previous start image.');
      }
      load.inputs.image = priorName;
      startName = priorName;
    }
    setStills((prev) => ({ ...prev, [key]: { status: 'running', seed, startName } }));
    try {
      setResult('Waiting for the queue, then making the start image.');
      await waitForIdleQueue(() => api.getQueue());
      setResult(null);
      const promptId = await submitApiGraph({
        serverUrl: useSettingsStore.getState().serverUrl,
        prompt,
        clientId: useServerStore.getState().clientId,
      });
      const entry = await waitHistory(promptId);
      if (entry.status?.status_str === 'error') throw new Error('The start image failed.');
      const ref = firstOutputImage(entry);
      if (!ref) throw new Error('The start image finished with no file.');
      const blob = await fetch(api.viewUrl(ref)).then((res) => res.blob());
      const uploaded = await api.uploadImage(blob, `incard-${seed}.png`, true);
      setStills((prev) => ({ ...prev, [key]: { status: 'done', url: api.viewUrl(ref), filename: uploaded.name, seed, startName } }));
      return step.kind === 'image' ? uploaded.name : priorName;
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'The start image failed.';
      setStills((prev) => ({ ...prev, [key]: { status: 'error', error: message, seed, startName } }));
      throw err;
    }
  };

  const makeImages = async (onlyKey?: string) => {
    if (!steps?.length || !drafts.length || busy) return;
    if (!connected) {
      showResult('Not connected to a ComfyUI server');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      let prior: string | null = null;
      for (const step of steps) {
        const text = drafts.find((draft) => draft.id === step.id)?.text ?? step.authorPrompt;
        const count = scenesInAuthorPrompt(step.authorPrompt);
        for (let scene = 1; scene <= count; scene++) {
          const key = stillKey(step.id, scene);
          const already = stills[key];
          const leaveIt = (onlyKey && key !== onlyKey)
            || (!onlyKey && already?.status === 'done' && !!already.filename)
            || (!onlyKey && already?.status === 'none');
          if (leaveIt) {
            if (step.kind === 'image' && already?.filename) prior = already.filename;
            continue;
          }
          prior = await makeScene(step, scene, text, prior);
          if (onlyKey) return;
        }
      }
    } catch (err) {
      showResult(err instanceof Error && err.message ? err.message : 'The start image failed.');
    } finally {
      setBusy(false);
    }
  };

  const renderApproved = async () => {
    if (!steps?.length || !card.workflowFile || busy) return;
    if (!connected) {
      showResult('Not connected to a ComfyUI server');
      return;
    }
    setBusy(true);
    setResult(null);
    let accepted: string | null = null;
    try {
      let acceptedStart: string | null = null;
      for (const step of steps) {
        if (step.kind !== 'image') continue;
        const count = scenesInAuthorPrompt(step.authorPrompt);
        for (let scene = 1; scene <= count; scene++) {
          const still = stills[stillKey(step.id, scene)];
          if (still?.status === 'done' && still.filename) acceptedStart = still.filename;
        }
      }
      const prompt = applyApprovedRun(graphRef.current, steps.map((step) => {
        const count = scenesInAuthorPrompt(step.authorPrompt);
        let filename: string | null = null;
        let seed: number | null = null;
        let startName: string | null = null;
        for (let scene = 1; scene <= count; scene++) {
          const still = stills[stillKey(step.id, scene)];
          if (still?.status !== 'done') continue;
          if (!filename && still.filename) {
            filename = still.filename;
            seed = still.seed ?? null;
          }
          if (still.startName) startName = still.startName;
        }
        return {
          nodeId: step.nodeId,
          field: step.field,
          text: drafts.find((draft) => draft.id === step.id)?.text ?? step.authorPrompt,
          samplerId: step.samplerId,
          seed,
          image: step.kind === 'video' ? (acceptedStart ?? startName ?? filename) : filename,
          kind: step.kind,
          engine: step.engine,
        };
      }));
      if (!prompt) throw new Error("Couldn't read this card's workflow");
      await waitForIdleQueue(() => api.getQueue());
      accepted = await submitApiGraph({
        serverUrl: useSettingsStore.getState().serverUrl,
        prompt,
        clientId: useServerStore.getState().clientId,
      });
    } catch (err) {
      if (!accepted) showResult(err instanceof Error && err.message ? err.message : SETTINGS_NOT_IN_BUILD);
    } finally {
      setBusy(false);
    }
    if (accepted) {
      void useServerStore.getState().refreshQueue();
      onClose();
      focusQueuedRun(accepted);
    }
  };

  const showResult = (message: string) => {
    setResult(message);
    toast(message, message === 'Queued' ? 'success' : 'error');
  };

  const run = async () => {
    if (!card.workflowFile || busy) return;
    if (!connected) {
      showResult('Not connected to a ComfyUI server');
      return;
    }
    setBusy(true);
    setResult(null);
    let accepted: string | null = null;
    let postedFromCard = false;
    try {
      let imageName: string | null = null;
      if (picked) {
        const url = absoluteStudioUrl(picked.file);
        if (!/^https?:\/\//i.test(url)) throw new Error(GALLERY_NOT_IN_BUILD);
        const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error(GALLERY_NOT_IN_BUILD);
        const blob = await res.blob();
        const name = safeUploadName(picked.name);
        const file = new File([blob], name, { type: safeImageType(blob.type) });
        imageName = await uploadInput(file, name);
      }
      const submitted = await runStudioCard({
        workflowFile: card.workflowFile,
        serverUrl: useSettingsStore.getState().serverUrl,
        words: prompt,
        savedWords: card.prompt,
        promptNodeId: card.promptNodeId,
        promptField: card.promptField,
        imageName,
        imageNodeId: card.imageNodeId,
        imageField: card.imageField,
        clientId: useServerStore.getState().clientId,
      });
      if (submitted.format === 'needs-photo') {
        setGalleryOpen(true);
        setGalleryNote(SAVED_PHOTO_NOT_ON_SKYTECH);
        return;
      }
      if (submitted.format === 'unknown') {
        showResult("Couldn't read this card's workflow");
        return;
      }
      if (submitted.format === 'api') {
        if (submitted.promptId) {
          accepted = submitted.promptId;
          postedFromCard = true;
        } else setResult('The server did not return a prompt id.');
      } else {
      const edits = studioRunEdits({
        words: prompt,
        savedWords: card.prompt,
        promptNodeId: card.promptNodeId,
        promptField: card.promptField,
        imageName,
        imageNodeId: card.imageNodeId,
        imageField: card.imageField,
      });
      // A refreshing node list must not block Run. A cached list is used when
      // one is already loaded; otherwise the existing converter runs without it.
      const info = useServerStore.getState().objectInfo;
      let wf = parseWorkflow(submitted.workflow, info);
      if (submitted.missed.length) {
        const fallback = applyStudioRunEdits(wf, {
          prompt: submitted.missed.includes('prompt') ? edits.prompt : null,
          image: submitted.missed.includes('image') ? edits.image : null,
        });
        if (fallback.missed.length) {
          showResult(`Couldn't change the ${fallback.missed.join(' and ')} on this card`);
          return;
        }
        wf = fallback.workflow;
      } else {
        wf = applyStudioRunEdits(wf, edits).workflow;
      }
      const id = await queueWorkflow(wf, { source: 'studio' });
      if (id) accepted = id;
      }
    } catch (err) {
      // A history error after a real prompt id must not cover that id.
      if (!accepted) showResult(err instanceof Error && err.message ? err.message : SETTINGS_NOT_IN_BUILD);
    } finally {
      setBusy(false);
    }
    if (accepted) {
      if (!postedFromCard) openQueueHistory();
      void useServerStore.getState().refreshQueue();
      onClose();
      focusQueuedRun(accepted);
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
          <>
            {result && (
              <p className={`ms-run-result${result === 'Queued' ? '' : ' error-text'}`} role="status">
                {result}
              </p>
            )}
            <button
              type="button"
              className="btn primary block ms-run-go"
              disabled={busy || (inCard && (!drafts.length || !imagesReady))}
              onClick={() => void (inCard ? renderApproved() : run())}
            >
              {busy ? 'Working…' : inCard ? 'Render' : 'Run'}
            </button>
          </>
        ) : undefined
      }
    >
      {preview?.kind === 'video' ? (
        <div className="ms-run-preview">
          <video src={preview.src} poster={preview.poster ?? undefined} muted loop playsInline autoPlay />
        </div>
      ) : preview?.kind === 'image' ? (
        <div className="ms-run-preview">
          <img src={preview.src} alt="" />
        </div>
      ) : null}

      {!canQueue && <p className="ms-run-note">{CARD_CANNOT_BE_BUILT}</p>}
      {canQueue && !connected && <p className="ms-run-note">Not connected to a ComfyUI server</p>}

      {steps === null && canQueue && <p className="ms-run-note">Reading this card…</p>}
      {inCard ? (
        <div className="field">
          <label className="field-label" htmlFor="ms-run-prompt">
            What do you want
          </label>
          <textarea
            id="ms-run-prompt"
            className="textarea ms-run-prompt"
            rows={4}
            value={ownWords}
            inputMode="text"
            enterKeyHint="done"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            placeholder="Your words. Nothing is rewritten until you tap Generate."
            onChange={(e) => setOwnWords(e.target.value)}
            onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
          />
          <button type="button" className="btn block" disabled={busy || !ownWords.trim()} onClick={generatePrompts}>
            Generate
          </button>
          {drafts.map((draft) => {
            const step = steps!.find((item) => item.id === draft.id);
            if (!step) return null;
            const said = spokenLines(draft.text);
            const loras = step.loras.map((lora) => lora.file.split(/[/\\]/).pop()?.replace(/\.(safetensors|ckpt|gguf)$/i, '')).filter(Boolean);
            const count = scenesInAuthorPrompt(step.authorPrompt);
            return (
              <div className="ms-step" key={step.id}>
                <div className="ms-item-title">{step.label}</div>
                {loras.length > 0 && <p className="field-hint">LoRAs: {loras.join(', ')}</p>}
                <textarea className="textarea ms-run-prompt" rows={4} readOnly value={draft.text} />
                {said.length > 0 && <p className="field-hint">Spoken: {said.join(' / ')}</p>}
                <div className="ms-step-actions">
                  <button type="button" className="btn sm" disabled={busy} onClick={() => rerollPrompt(step)}>
                    Re-roll prompt
                  </button>
                </div>
                {Array.from({ length: count }, (_, index) => {
                  const scene = index + 1;
                  const still = stills[stillKey(step.id, scene)];
                  return (
                    <div key={stillKey(step.id, scene)}>
                      {count > 1 && <p className="field-hint">Scene {scene}</p>}
                      {still?.status === 'done' && (
                        <div className="ms-step-actions">
                          <button type="button" className="btn sm" disabled={busy || !connected} onClick={() => void makeImages(stillKey(step.id, scene))}>
                            Re-roll image
                          </button>
                        </div>
                      )}
                      {still?.status === 'running' && <p className="ms-run-note">Making the start image…</p>}
                      {still?.error && <p className="field-hint">{still.error}</p>}
                      {still?.url && <img src={still.url} alt="" />}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {drafts.length > 0 && (
            <button type="button" className="btn block" style={{ marginTop: 10 }} disabled={busy || !connected} onClick={() => void makeImages()}>
              Make start images
            </button>
          )}
        </div>
      ) : steps && (
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
      )}

      <div className="field">
        <div className="field-label">Photo</div>
        <button type="button" className="btn block ms-run-photo" onClick={() => setGalleryOpen(true)}>
          New photo
        </button>
        <p className="ms-run-keep">{studioPhotoStatus(picked ? picked.name : null, imageWritable)}</p>
        {picked && imageWritable && (
          <button type="button" className="btn ghost ms-run-keep-btn" onClick={() => setPicked(null)}>
            Keep the card's image
          </button>
        )}
        {galleryOpen && galleryNote && <p className="ms-run-note">{galleryNote}</p>}
        {galleryOpen && !images && !galleryNote && <p className="ms-run-note">Loading gallery…</p>}
        {galleryOpen && images && <GalleryGrid images={images} picked={picked} onPick={setPicked} />}
      </div>
    </Sheet>
  );
}
