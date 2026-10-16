# Architecture

Comfy Mobile is one Vite/React app with **two UI layers** that share **one engine**:

```
┌──────────────────────────┐   ┌──────────────────────────┐
│  src/studio   (Studio)   │   │  src/editor   (Graph)    │   ← UI layers: React only,
│  create bar · param form │   │  canvas · nodes · links  │     no fetch/WebSocket code
│  recipes · LoRA · review │   │  search · inspector      │
└────────────┬─────────────┘   └────────────┬─────────────┘
             │        src/library (Library tab: models · server workflows · assets)
             │        src/screens (queue, gallery, settings, connection)
             │        src/shared  (sheet, fields, media view, toasts, first-run guide)
┌────────────▼────────────────────────────────▼─────────────┐
│  src/core — the engine (framework-agnostic except Zustand) │
│  api/        HTTP client · WebSocket · ComfyUI types       │
│  graph/      LiteGraph model · widgets from object_info ·  │
│              serialise/import/export · graph→prompt        │
│  templates/  Studio template schema · binding engine ·     │
│              Studio LoRA stack (LoraLoaderModelOnly chain) │
│              validation against object_info + /models      │
│  library/    model-folder grouping · search · loader       │
│              lookup · userdata (server workflow) parsing   │
│  recipes/    recipe schema + trigger-word injection        │
│  store/      server · graph · studio · workflows · loras · │
│              library · settings (Zustand → localStorage)   │
│  connection/ CORS / unreachable / mixed-content diagnosis  │
│  platform/   save/share via Capacitor, web fallback        │
│  media.ts    output normalisation (video-first)            │
└─────────────────────────────────────────────┬─────────────┘
                                              │  HTTP + WS
                                     ┌────────▼────────┐
                                     │  ComfyUI server │  (the ONLY network peer)
                                     └─────────────────┘
```

**Rule:** anything that talks to ComfyUI, parses a workflow, or decides what a prompt looks like
lives in `src/core`. Studio and Graph only render state from the stores and call store/engine
functions. Studio never touches the graph editor's components; both are swappable independently.

## Core concepts

### Workflow (editor model) vs Prompt (API model)

* `Workflow` (`core/graph/types.ts`) mirrors LiteGraph's JSON (`nodes`, `links`, `groups`,
  `extra.ds`), with each node carrying resolved `widgets: WidgetDef[]` derived from the server's
  `/object_info` (`core/graph/widgets.ts`). Unknown node types are kept intact and flagged
  `missing` so a workflow can still be opened, edited and saved. V3 dynamic combos
  (`COMFY_DYNAMICCOMBO_V3`, e.g. `SaveVideo.format`) are combos over `options[].key`; the selected
  option's nested inputs become extra widgets named by dotted path (`format.codec`,
  `format.codec.encoding.crf`), stored flat after the parent in `widgets_values` and sent under
  those same keys in the prompt. Changing the parent re-shapes the node (`setWidgetValue(..., info)`).
* `graphToPrompt()` (`core/graph/prompt.ts`) compiles a `Workflow` into the `/prompt` payload:
  skips virtual nodes (`Note`, `Reroute`, `PrimitiveNode`), drops muted nodes, routes links through
  bypassed nodes by matching slot types (same rule as the ComfyUI frontend), maps widget values and
  link references, and returns the node-id map so execution events can be tied back to nodes.
* `serialize.ts` imports/export LiteGraph JSON (handles link arrays, object-form `widgets_values`,
  legacy formats) and reads workflows embedded in PNG `tEXt` chunks (`utils/png.ts`).

### Server store (`core/store/server.ts`)

Single source of truth for connection + execution. `connect()` is deliberately cheap:

1. `GET /system_stats` with a 12 s deadline (`STATS_TIMEOUT_MS`) — failure/timeout/non-ComfyUI
   responses land in `lastFailure` with the exact URL + status for the Connection screen.
2. Open the WebSocket (`core/api/ws.ts`: 8 s open timeout, jittered exponential backoff
   0.5 s → 15 s, binary preview frames decoded into blob URLs). The store waits at most 6 s
   (`WS_GRACE_MS`) for it; if it does not open, status still becomes `connected` with
   `wsBlocked: true` and `/queue` is polled every 5 s until the socket comes up.
3. `/object_info` is **never** on the connect path. `loadNodeList()` streams it in the background
   via `api.getObjectInfo({ onProgress })` (15 s headers / 30 s stall timeouts, `TimeoutError`
   carries the URL) and publishes byte progress in `nodeList` so `NodeListBanner` can show
   "Loading node list from <host>… 12 MB / 30 MB". A cached copy (`core/connection/cache.ts`,
   IndexedDB `comfy-mobile.cache`, key `serverUrl|comfyui-version`) is applied first so a second
   launch is usable instantly while the fresh list downloads.

`connect()` is idempotent (one in-flight promise) and generation-guarded, so a server switch or a
foreground return never stacks parallel downloads. The store owns the lifecycle listeners
(`visibilitychange`, `pagehide`, `pageshow`, `online`) and calls `resume()`, which only cycles the
socket when it is not open or the tab was suspended for more than 20 s. It also keeps:

* `execution` — current prompt id, executing node, progress, preview URL, per-node outputs, final
  status/error. Both the Graph canvas (node highlight + progress bar) and the Studio results feed
  read from this.
* `queue`, `history` — mirrors of `/queue` and `/history`, refreshed on WS events.
* `nodeErrors` — validation errors returned by `/prompt` (400), shown on nodes and in the inspector.
* `submitted` — what *this app* queued (source: studio/graph, template id, workflow), so the results
  feed can offer "Reuse settings".

### Studio templates & bindings (`core/templates`)

A `StudioTemplate` is a bundled LiteGraph workflow plus a list of `TemplateParam`s. Each param has a
UI `type` (`text | number | seed | toggle | combo | lora | image | video`), an optional semantic
`role` (`positive_prompt`, `width`, `frames`, `fps`, `steps`, `cfg`, `seed`, `model`, `lora`,
`reference_image`, …) and one or more **bindings**:

```ts
{ node: { id: 9 } | { title: 'KSampler (high noise)' } | { type: 'KSampler', index: 0 },
  widget: 'steps',                 // widget name on that node
  target?: 'widget' | 'mode',      // 'mode' flips the node between Always and Bypass (LoRA toggles)
  transform?: 'half' | 'seconds_to_frames' | 'frames_plus_one' }
```

`applyTemplate(template, values, objectInfo)` → `Workflow`; `readTemplateValues(template,
workflow)` does the reverse so "Open in Graph mode" and "Reuse settings" round-trip. The param form
(`studio/ParamForm.tsx`) groups params by role — reference media, prompt, models, resolution
(presets), duration (frames × fps), sampling, LoRAs, seed, advanced — so adding a new template is
data only: a workflow JSON and a param list, no UI code.

`validateTemplate()` (`core/templates/validate.ts`) diffs required node types against
`/object_info` and declared model files against `/models/<folder>` and returns
`{ missingNodes, missingModels, unknown }`. Missing nodes disable Generate with the exact types;
missing models warn (the user can pick another file in the combo, which is populated from the same
`/models` lists).

### Studio LoRA stack (`core/templates/loras.ts`)

Every video template gets a per-template stack of up to `MAX_STUDIO_LORAS` (4) `StudioLora
{ file, strength }` entries, kept in `useStudioStore.loras[templateId]`. The stack is *not* part
of the template's bindings; it is applied when the workflow is built:

* `modelRoots(wf)` finds every node that outputs `MODEL` but takes no `MODEL` input (one for most
  templates, the high- and low-noise `UNETLoader`s for Wan 2.2).
* `withStudioLoras(wf, stack, objectInfo)` first strips any previous stack, then inserts one
  `LoraLoaderModelOnly` per LoRA after each root (`lora_name`, `strength_model`), rewires the root's
  former consumers to the end of the chain and tags each injected node with
  `properties['comfy-mobile.studioLora']` so it can be recognised later.
* `readStudioLoras(wf)` reads the stack back from those tags, so "Open in Graph" → edit → "Sync
  from graph" round-trips, and `stripStudioLoras(wf)` restores the original wiring.
* `supportsStudioLoras(kind, wf, objectInfo)` gates the UI: video kind, the server has
  `LoraLoaderModelOnly`, and the template has at least one model root.

`useStudio().buildWorkflow()` is the single place this is applied (Generate, Review sheet and Open
in Graph all go through it). `studio/lora/LoraSection.tsx` renders the collapsible section with
strength sliders and opens `LoraPicker` in multi-select mode (word-AND search, paged by 150, local
ratings/trigger words still editable per file).

### Library (`core/library`, `core/store/library.ts`, `src/library`)

The Library tab is a read-only view of the server:

* **Models.** `useLibraryStore.refreshFolders()` calls `GET /models` for the folder list, then
  `refreshModels(folder)` (server store) for every folder in parallel, so folders added by custom
  node packs appear without code changes. `groupModelFolders()` orders and labels them
  (`FOLDER_META` has plain-language blurbs for the standard ComfyUI folders); `filterModelGroups()`
  applies the case-insensitive word-AND search and drops empty groups while searching.
  `loaderFor(folder, file, objectInfo)` picks the loader node for "Open in Graph": a preferred
  node per folder (`CheckpointLoaderSimple`, `UNETLoader`, `LoraLoaderModelOnly`, `VAELoader`,
  `ControlNetLoader`, …) when its combo actually lists the file, otherwise any node whose combo
  does, otherwise the preferred node if the type exists. `studioTargetFor()` decides what "Use in
  Studio" means for the current template: add to the LoRA stack, set a `role: 'model'` param whose
  folder matches, or insert an embedding token into the prompt.
* **Workflows.** `GET /api/userdata?dir=workflows&recurse=true&full_info=true` lists what was saved
  in the ComfyUI web UI (`user/default/workflows`); `parseUserdataList()` accepts both response
  shapes (`{ path, size, modified }` objects or bare path strings), keeps `.json` only and sorts
  newest first. `GET /api/userdata/<encoded path>` (one URL-encoded segment, e.g.
  `workflows%2Fvideo%2Fclip.json`) fetches the file; `parseWorkflow()` turns it into the editor
  model so it opens in Graph, and "Run now" compiles and queues it directly. A 404 (older server /
  no user dir) is shown as an empty list, not an error.
* **Assets.** Input images come from the `LoadImage` combo in `/object_info` plus files this app
  uploaded (`uploadedInputs`); thumbnails use `/view?type=input`. Outputs reuse the history store
  and `mediaFromHistoryEntry`. "Use as reference" switches Studio to the image-to-video template and
  sets its reference param.

The library store resets whenever `serverUrl` changes (as does `modelLists`), so one server's
folders are never shown for another.

### First-run guide (`shared/Guide.tsx`)

`App.tsx` opens the four-card guide when `useSettingsStore.guideSeen` is false; Skip / Got it set it
to true. Settings → Help → "How this works" reopens it. The cards are static copy (`GUIDE_CARDS`)
with an "Open <tab>" button each; no network, no state beyond the flag. `?tab=<id>` in the URL
selects a tab on load (handy for screenshots and deep links).

### Video-first media (`core/media.ts`)

`mediaFromOutput()` normalises every output shape ComfyUI produces — `images[]`, `gifs[]` (VHS;
carries `format` and `frame_rate`), `video[]`/`videos[]` (`SaveVideo`), animated webp — into
`MediaItem { kind: 'video' | 'image', url, ref, animated, fps }`. `/view` URLs are built from the
configured server. `shared/MediaView.tsx` renders `<video playsinline muted loop>` for videos (the
mock and real servers support byte ranges so iOS can seek), `<img>` otherwise. Gallery and results
sort videos first.

### Connection diagnosis (`core/connection/diagnose.ts`)

`fetch` reports CORS failures and dead hosts identically (`TypeError: Failed to fetch`). The
diagnoser runs a normal `GET /system_stats`; on failure it re-probes with `mode: 'no-cors'` — an
opaque success means the host answered but CORS headers are missing (→ "add
`--enable-cors-header`"), a second failure means unreachable; it also detects HTTPS-page →
HTTP-server mixed content, non-ComfyUI responders, a blocked WebSocket (HTTP fine, `/ws` never
opens) and — from the server store's `nodeList` progress — a node list that is slow-but-moving
(`slow`, with a bytes/s estimate; fix text recommends `--enable-compress-response-body`) or
stalled. Every problem carries the failing URL; `buildConnectionReport` + `formatConnectionReport`
produce the plain-text block behind the "Copy details" button on the Connection screen and the
node-list banner sheet.

## Studio UX extension points

These are the seams for the Video Studio design to grow into. Each is a component with a narrow
prop contract; the engine behind it is already in `core`.

| Area | Component | Engine | Notes |
|---|---|---|---|
| Unified create bar / mode chips | `studio/StudioScreen.tsx` (MODES) | `useStudio()` | Chips map to `TemplateKind`s; the first template tagged `primary` in that kind is selected. |
| Parameter controls | `studio/ParamForm.tsx` | `TemplateParam.role` | Replace a role renderer (e.g. a slick duration slider) without touching bindings. |
| Recipes + trigger words | `studio/recipes/RecipePicker.tsx` | `core/recipes` (`useRecipesStore`, `bindTriggerWords`) | A recipe = template id + values + `triggerWords[]` + `loras[]`. Trigger words are prepended to the positive prompt at generate time; `finalPrompt` is exposed by `useStudio()` for the review sheet. |
| LoRA stack | `studio/lora/LoraSection.tsx` + `LoraPicker.tsx` (multi mode) | `useStudioStore.loras` + `withStudioLoras` / `readStudioLoras` + `useLorasStore` (rating, favourite, trigger words, notes per file) | Raise `MAX_STUDIO_LORAS` or add `strength_clip` by switching the injected node to `LoraLoader` in `loras.ts`. |
| Library → Studio / Graph | `library/useLibraryActions.ts` | `studioTargetFor`, `loaderFor`, `useGraphStore.addNode/setWidget` | Add a new folder → loader mapping in `PREFERRED_LOADERS`; the rest is discovered from `/object_info`. |
| Review before queue | `studio/ReviewSheet.tsx` | `useStudio().buildWorkflow()` + `graphToPrompt` | Shows final prompt, key params, validation warnings, executable node count; opt-out stored in settings (`reviewBeforeQueue`). |
| Results feed | `studio/ResultsFeed.tsx` | `history` + `submitted` + `mediaFromHistoryEntry` | Live card (progress + preview frame) then finished runs. "Reuse settings" calls `readTemplateValues`. |
| Import-and-run | `screens/WorkflowsScreen.tsx` ▶ button | `useQueue().queueWorkflow` | Queues a saved/imported workflow without opening the editor. |
| Studio ↔ Graph hand-off | header graph icon / `useStudio().openInGraph()` | `useGraphStore.load()` with `templateId` | The graph store remembers the template id so `syncFromGraph()` can pull edits back. |

## Graph editor notes (`src/editor`)

* `GraphCanvas.tsx` owns gestures. The viewport transform is applied straight to the DOM during
  pan/pinch and committed to the store on gesture end, so dragging never re-renders the node tree.
  Nodes are DOM (`NodeView.tsx`, memoised), links are one SVG layer (`LinksLayer.tsx`), hit-testing
  uses `data-node-id` / `data-slot-kind` attributes and `elementFromPoint` on drop.
* Mutations are pure functions in `core/graph/model.ts` (`connect`, `disconnectInput`,
  `removeNode`, `cloneNode`, `setWidgetValue`, …) and go through `useGraphStore` which keeps a
  50-step undo stack and autosaves to localStorage.
* Execution state is read from the server store: executing node glows, per-node progress bar,
  nodes with `/prompt` validation errors are outlined red, output nodes render their media inline.

## Persistence (all on-device)

| Key | Store | Contents |
|---|---|---|
| `comfy-mobile.settings` | `useSettingsStore` | server URL, default mode, editor prefs, `guideSeen` |
| `comfy-mobile.graph.autosave` | `useGraphStore` | the open graph, name, template id |
| `comfy-mobile.workflows` | `useWorkflowsStore` | saved workflows (LiteGraph JSON) |
| `comfy-mobile.studio` | `useStudioStore` | per-template parameter values, seed mode, LoRA stack |
| `comfy-mobile.recipes` | `useRecipesStore` | recipes + active recipe |
| `comfy-mobile.loras` | `useLorasStore` | LoRA ratings / trigger words / notes |
| `comfy-mobile.clientId` | server store | stable WebSocket client id |

The library store (`useLibraryStore`: folder list, server workflow list) is in-memory only and is
refetched per session. IndexedDB `comfy-mobile.cache` (stores `objectInfo`, `models`, keyed by
`serverUrl|comfyui-version`) holds the last `/object_info` and `/models/*` responses per server so a
relaunch is usable before the fresh download lands. Nothing is synced anywhere; "Clear local data"
in Settings wipes these keys and the cache.

## Privacy: local-only guarantee

The app's only network peer is the ComfyUI server URL in Settings. Concretely:

* **No third-party resources.** No CDN fonts (system font stack only), no external scripts or
  stylesheets, no `preconnect`/`dns-prefetch`, no web fonts at all. Icons are inline SVG paths.
* **No telemetry, analytics, crash reporting or update checks.** There is no code path that
  contacts a vendor; Capacitor is configured without `CapacitorHttp` or live-update plugins.
* **No external APIs or cloud fallbacks.** Model lists, node definitions, server-saved workflows
  (`/userdata`), uploads, outputs and history all come from the configured server. LoRA/recipe
  metadata and the guide flag are local. The Library never writes to the server.
* **Runtime dependencies are pinned to a reviewed allow-list** (`react`, `react-dom`, `zustand`,
  `@capacitor/core|ios|android|filesystem|share`); the audit also checks their transitive deps.
* **The build is audited.** `npm run audit:privacy` (`scripts/audit-privacy.mjs`) scans every JS/CSS/
  HTML file in `dist/` for `http(s)://` and `ws(s)://` literals, external `<script src>`/`<link
  href>`/`@import`/`url()` references and a list of known telemetry/CDN hostnames. The only
  tolerated literals are the default server URL, `http://${…}` (the scheme prefix added to whatever
  the user typed), and inert namespace/doc strings baked into React/Capacitor (`w3.org`,
  `reactjs.org/docs/error-decoder`, `capacitorjs.com` license comment). Anything else fails the run
  with exit code 1. Run it with `--src` to scan source as well.

Verification evidence from this repository state: `npm run build` → `node scripts/audit-privacy.mjs
--src` prints `PASS — no outbound network references other than the configured ComfyUI server`, and
a browser-level request log of the full UI walkthrough against the mock server shows requests to the
app origin and the configured server only.

## Hard UI constraints honoured

* `#root` is a plain block (`index.html`, `styles.css`): no `display:flex`/`align-items` on it, so
  `position: sticky` (Generate bar, sheet headers) works.
* Safe-area insets are applied via `env(safe-area-inset-*)` in CSS variables used by the tab bar,
  sheets and headers.
* No iframes; external links are not embedded.
