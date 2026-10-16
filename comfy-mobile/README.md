# Comfy Mobile

A private phone client for [ComfyUI](https://github.com/comfyanonymous/ComfyUI): a touch-first
**Video Studio** on top of a complete **node-graph editor**, built with React + TypeScript + Vite and
shipped to iOS/Android with Capacitor. It talks to a ComfyUI server you already run (by default
Skytech over Tailscale, `http://100.103.142.118:8188`) and to nothing else.

> **Privacy guarantee.** The app makes network requests to exactly one origin: the ComfyUI server
> URL you enter in Settings. There are no CDN fonts or scripts, no analytics or crash reporting, no
> update checks, no external APIs and no cloud fallbacks. Everything (UI, icons, templates,
> workflows, recipes) is bundled in the app and stored on the device. `npm run audit:privacy`
> verifies this against the production bundle and fails the build if it ever stops being true.
> Details in [ARCHITECTURE.md → Privacy](./ARCHITECTURE.md#privacy-local-only-guarantee).

## What's inside

| Mode | What you get |
|---|---|
| **Studio** | Phone-sized create flow: Text→Video / Image→Video / Image chips, template picker with live server availability, prompt + negative, model pickers populated from the server, resolution presets, duration (frames × fps), steps/CFG, seed with randomize/fixed, LoRA picker with local ratings + trigger words, **Recipes** (saved settings + trigger words that are prepended to the prompt), **Review-before-queue** sheet, live progress with preview frames, and a video-first results feed with Save / Reuse settings / Open graph. |
| **Graph** | Full ComfyUI-style node editor: pan, pinch-zoom, drag nodes, drag links from pins (drop on a pin, a node, or empty canvas → type-filtered node search), tap link midpoints to delete, node search over the server's `/object_info`, node inspector with every widget type (combo, number + slider, seed + control-after-generate, toggle, text, image/video upload), bypass / mute / clone / delete, colours, collapse, undo/redo, autosave, import/export LiteGraph JSON (and PNG metadata), live execution highlighting + progress bar + per-node outputs. |
| **Queue** | Running / pending with cancel and interrupt; history with status, outputs, error messages, "Open graph", delete/clear. |
| **Gallery** | Every output in server history, videos first (mp4/webm, VHS gifs, animated webp, SaveVideo), with a fullscreen viewer, swipe navigation, byte-range video playback, Save to device / Share. |
| **Settings** | Server URL with **Test & connect** diagnostics (CORS blocked vs host unreachable vs not ComfyUI vs mixed content), default mode, editor preferences, local-data reset. |

### Bundled templates

| Template | Engine | Nodes |
|---|---|---|
| Wan 2.2 Text to Video (14B) | Wan 2.2 | dual high/low-noise `UNETLoader` + `KSamplerAdvanced` pair, `ModelSamplingSD3`, optional Lightning 4-step LoRAs (toggle = node bypass), `CreateVideo` → `SaveVideo` |
| Wan 2.2 Image to Video (14B) | Wan 2.2 | as above with `LoadImage` → `WanImageToVideo` |
| LTX-2 Text to Video / Image to Video | LTX-2.x | `CheckpointLoaderSimple`, `LTXVConditioning`, `LTXVScheduler`, `SamplerCustom`, `LTXVImgToVideo` |
| HunyuanVideo 1.5 Text to Video | HunyuanVideo 1.5 | `UNETLoader` + `DualCLIPLoader`, `EmptyHunyuanLatentVideo`, `KSampler`, `CreateVideo` → `SaveVideo` |
| AnimateDiff (SD1.5) | AnimateDiff + VHS | `ADE_AnimateDiffLoaderGen1`, `VHS_VideoCombine` (custom node packs) |
| SD1.5 Text to Image / Image to Image | Stable Diffusion 1.5 | classic `KSampler` graphs |

Every template is validated against the live server: node types against `/object_info`, model file
names against `/models/<folder>`. Missing node types block the Generate button with the exact list;
missing model files show as a warning so you can pick an installed file from the dropdown.

## Run it

```bash
cd comfy-mobile
npm install

# Against the real server (default URL is Skytech; change it in Settings)
npm run dev              # http://127.0.0.1:5173 – loopback only (the dev server is not exposed to the LAN)
npm run dev:lan          # bind all interfaces to open it on a phone over your LAN/tailnet (deliberate opt-in)

# Against the bundled mock ComfyUI (no GPU needed)
npm run mock             # http://localhost:8188 – recorded /object_info, simulated runs, sample mp4/gif/png
npm run dev              # then set the server URL to http://localhost:8188 in the connection screen
```

Mock server switches: `MOCK_ALL_NODES=1` (also expose AnimateDiff/VHS nodes), `MOCK_NO_CORS=1`
(reproduce the CORS failure the app diagnoses), `MOCK_FAIL=1` (every third prompt fails),
`MOCK_SPEED=3` (faster fake sampling), `PORT=…`.

### ComfyUI server requirements

ComfyUI must accept connections from other machines **and** send CORS headers, otherwise the WebView
refuses every response (the app tells you which of the two is wrong):

```bash
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
```

On Skytech (ComfyUI 0.38 under WSL2) add `--enable-cors-header` to the launch command; WSL2 port
forwarding to the Windows Tailscale IP must also be in place for `100.103.142.118:8188`.

## Build, verify, ship

```bash
npm run typecheck        # tsc --noEmit
npm test                 # node:test unit checks for src/core (template round-trip, connection diagnosis, media, store)
npm run build            # typecheck + vite build → dist/
npm run audit:privacy    # scans dist/ (+ package.json deps) for any outbound URL; exit 1 on findings
npm run verify           # typecheck + tests + build + audit

npm run cap:ios          # build, sync, open Xcode
npm run cap:android      # build, sync, open Android Studio
```

### Native networking notes

The ComfyUI server is plain `http://`, so:

* **iOS**: add an ATS exception for the server host (or `NSAllowsLocalNetworking` /
  `NSAllowsArbitraryLoads` for a private build) in `ios/App/App/Info.plist`.
* **Android**: `capacitor.config.ts` already sets `server.cleartext: true` and
  `android.allowMixedContent: true`; `android:usesCleartextTraffic="true"` is applied by Capacitor.
* Saving media uses `@capacitor/filesystem` (Documents/ComfyMobile) and `@capacitor/share`; on the web
  build it falls back to a download link.

## Project layout

```
comfy-mobile/
  src/core/        engine shared by both modes (no React UI): API client, WebSocket, graph model,
                   serialisation, prompt compiler, templates + bindings, validation, stores, recipes
  src/studio/      Studio mode UI (create bar, param form, recipes, LoRA lab, review sheet, results)
  src/editor/      Graph mode UI (canvas, nodes, links, search, inspector, toolbar)
  src/screens/     Queue, Gallery, Viewer, Settings, Workflows, Connection gate
  src/shared/      Sheet, fields, media view, icons, toasts, ui store
  mock-server/     mock ComfyUI (HTTP + WS) with recorded object_info and media fixtures
  scripts/         audit-privacy.mjs
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the layer contract, data flow, template binding model
and the extension points for the Video Studio UX.
