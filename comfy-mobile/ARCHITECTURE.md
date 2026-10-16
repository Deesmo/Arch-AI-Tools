# Architecture

Comfy Mobile is one Vite/React app with **two UI layers** that share **one engine**:

```
┌──────────────────────────┐   ┌──────────────────────────┐
│  src/studio   (Studio)   │   │  src/editor   (Graph)    │   ← UI layers: React only,
│  create bar · param form │   │  canvas · nodes · links  │     no fetch/WebSocket code
│  recipes · LoRA · review │   │  search · inspector      │
└────────────┬─────────────┘   └────────────┬─────────────┘
             │        src/screens (queue, gallery, settings, connection)
             │        src/shared  (sheet, fields, media view, toasts)
┌────────────▼────────────────────────────────▼─────────────┐
│  src/core — the engine (framework-agnostic except Zustand) │
│  api/        HTTP client · WebSocket · ComfyUI types       │
│  graph/      LiteGraph model · widgets from object_info ·  │
│              serialise/import/export · graph→prompt        │
│  templates/  Studio template schema · binding engine ·     │
│              validation against object_info + /models      │
│  recipes/    recipe schema + trigger-word injection        │
│  store/      server · graph · studio · workflows · loras · │
│              settings (Zustand, persisted to localStorage) │
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

Single source of truth for connection + execution. `connect()` fetches `/system_stats` and
`/object_info`, opens the WebSocket (`core/api/ws.ts`, auto-reconnect, binary preview frames
decoded into blob URLs), and keeps:

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
HTTP-server mixed content and non-ComfyUI responders. The Connection screen and Settings show the
matching fix text.

## Studio UX extension points

These are the seams for the Video Studio design to grow into. Each is a component with a narrow
prop contract; the engine behind it is already in `core`.

| Area | Component | Engine | Notes |
|---|---|---|---|
| Unified create bar / mode chips | `studio/StudioScreen.tsx` (MODES) | `useStudio()` | Chips map to `TemplateKind`s; the first template tagged `primary` in that kind is selected. |
| Parameter controls | `studio/ParamForm.tsx` | `TemplateParam.role` | Replace a role renderer (e.g. a slick duration slider) without touching bindings. |
| Recipes + trigger words | `studio/recipes/RecipePicker.tsx` | `core/recipes` (`useRecipesStore`, `bindTriggerWords`) | A recipe = template id + values + `triggerWords[]` + `loras[]`. Trigger words are prepended to the positive prompt at generate time; `finalPrompt` is exposed by `useStudio()` for the review sheet. |
| LoRA Lab | `studio/lora/LoraPicker.tsx` | `useLorasStore` (rating, favourite, trigger words, notes per file) + `modelLists.loras` | Ratings sort the list; extend with previews/tags by widening `LoraMeta`. |
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
| `comfy-mobile.settings` | `useSettingsStore` | server URL, default mode, editor prefs |
| `comfy-mobile.graph.autosave` | `useGraphStore` | the open graph, name, template id |
| `comfy-mobile.workflows` | `useWorkflowsStore` | saved workflows (LiteGraph JSON) |
| `comfy-mobile.studio` | `useStudioStore` | per-template parameter values, seed mode |
| `comfy-mobile.recipes` | `useRecipesStore` | recipes + active recipe |
| `comfy-mobile.loras` | `useLorasStore` | LoRA ratings / trigger words / notes |
| `comfy-mobile.clientId` | server store | stable WebSocket client id |

Nothing is synced anywhere; "Clear local data" in Settings wipes these keys.

## Privacy: local-only guarantee

The app's only network peer is the ComfyUI server URL in Settings. Concretely:

* **No third-party resources.** No CDN fonts (system font stack only), no external scripts or
  stylesheets, no `preconnect`/`dns-prefetch`, no web fonts at all. Icons are inline SVG paths.
* **No telemetry, analytics, crash reporting or update checks.** There is no code path that
  contacts a vendor; Capacitor is configured without `CapacitorHttp` or live-update plugins.
* **No external APIs or cloud fallbacks.** Model lists, node definitions, uploads, outputs and
  history all come from the configured server. LoRA/recipe metadata is local.
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
