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
import {
  CARD_CANNOT_BE_BUILT,
  GALLERY_COLUMNS,
  GALLERY_NOT_IN_BUILD,
  SETTINGS_NOT_IN_BUILD,
  applyStudioRunEdits,
  galleryWindow,
  loadStudioWorkflowFile,
  parseWorkflow,
  patchStudioRunFile,
  peekStudioGallery,
  primeStudioGallery,
  studioRunEdits,
  useServerStore,
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
  const { queueWorkflow, queueApiPrompt } = useQueue();
  const toast = useUiStore((s) => s.toast);
  const focusQueuedRun = useUiStore((s) => s.focusQueuedRun);
  const [prompt, setPrompt] = useState(card.prompt);
  const [picked, setPicked] = useState<StudioGalleryImage | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [images, setImages] = useState<StudioGalleryImage[] | null>(() => peekStudioGallery());
  const [galleryNote, setGalleryNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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

  const connected = status === 'connected';
  const canQueue = !!card.workflowFile;
  const promptWritable = card.promptNodeId != null && !!card.promptField;
  const imageWritable = card.imageNodeId != null && !!card.imageField;

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
    try {
      const json = await loadStudioWorkflowFile(card.workflowFile);
      let imageName: string | null = null;
      if (picked && imageWritable) {
        const res = await fetch(picked.file, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error(GALLERY_NOT_IN_BUILD);
        const blob = await res.blob();
        imageName = await uploadInput(blob, picked.name);
      }
      const edits = studioRunEdits({
        words: prompt,
        savedWords: card.prompt,
        promptNodeId: card.promptNodeId,
        promptField: card.promptField,
        imageName,
        imageNodeId: card.imageNodeId,
        imageField: card.imageField,
      });
      const patched = patchStudioRunFile(json, edits);
      if (patched.format === 'unknown') {
        showResult("Couldn't read this card's workflow");
        return;
      }
      if (patched.format === 'api') {
        // A missed edit leaves that saved input. The rest of the prompt is posted whole.
        const queued = await queueApiPrompt(patched.prompt, { source: 'studio' });
        if (queued.ok && queued.promptId) accepted = queued.promptId;
        else setResult(queued.message);
      } else {
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
      showResult(err instanceof Error && err.message ? err.message : SETTINGS_NOT_IN_BUILD);
    } finally {
      setBusy(false);
    }
    if (accepted) {
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
            <button type="button" className="btn primary block ms-run-go" disabled={busy} onClick={() => void run()}>
              {busy ? 'Queuing…' : 'Run'}
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
        <button type="button" className="btn block ms-run-photo" onClick={() => setGalleryOpen(true)}>
          New photo
        </button>
        <p className="ms-run-keep">{picked ? `Using ${picked.name} instead of the card's image.` : "Keeping the card's image."}</p>
        {picked && (
          <button type="button" className="btn ghost ms-run-keep-btn" onClick={() => setPicked(null)}>
            Keep the card's image
          </button>
        )}
        {!imageWritable && <p className="field-hint">This photo stays as saved in the workflow.</p>}
        {galleryOpen && galleryNote && <p className="ms-run-note">{galleryNote}</p>}
        {galleryOpen && !images && !galleryNote && <p className="ms-run-note">Loading gallery…</p>}
        {galleryOpen && images && <GalleryGrid images={images} picked={picked} onPick={setPicked} />}
      </div>
    </Sheet>
  );
}
