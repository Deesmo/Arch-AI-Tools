# My Studio content (Video Studio → comfy-mobile)

Brings the Video Studio content on the Mac mini (copy cards, recipes /
trigger words, LoRA adapter cards with ratings, saved workflows, presets,
characters, asset lists) into the **My Studio** tab of comfy-mobile.

Nothing leaves the tailnet. `~/archon-staging/video-studio/` is never synced
or committed; the exporter reads it locally, writes one file under
`~/comfy-mobile-content/`, and the app fetches that file over Tailscale.

## The two commands (run on the Mac mini)

```sh
# 1. Export: walk ~/archon-staging/video-studio and write ~/comfy-mobile-content/bundle.json
python3 ~/path/to/Arch-AI-Tools/comfy-mobile/tools/export_video_studio.py

# 2. Serve: expose ~/comfy-mobile-content (+ read-only /media/ from the Video Studio tree) on the tailnet (Ctrl-C to stop)
python3 ~/path/to/Arch-AI-Tools/comfy-mobile/tools/export_video_studio.py --serve
```

The phone does not fetch that file. **My Studio** reads only
`/studio-thumbs/index.json` (and the files it names) from the same origin as
the page. The Mac copies the real pictures into `public/studio-thumbs/`
before it serves the phone. Those files are not committed.

## What the exporter does

- Python 3.8+, standard library only, no network calls.
- Reads `.json / .jsonl / .yaml / .yml / .db / .sqlite / .py` (module-level
  dict/list literals, e.g. `adapter_cards.py`) and workflow JSON embedded in
  `static/*.js`. `.txt/.md` only when the file name hints at content
  (prompt, copy, recipe, trigger, …).
- Skips `.git`, `node_modules`, `__pycache__`, venvs, `logs/`, `status/`,
  `jobs/`, `outputs/`, `renders/`, `media/`, `evidence/`, `history/`,
  `backups/`, caches, thumbnails, `.bak/.orig` files and files larger than
  `--max-file-mb` (25). Use `--include-dir jobs` to add one back.
- Redacts anything that looks like a secret (keys named `*token*`,
  `*secret*`, `*api_key*`, `password`, …; values starting with `sk-`, `ghp_`,
  `hf_`, `tskey-`, `AKIA`, …) before it reaches the bundle.
- **Classifies on strong signals only.** A record becomes a recipe only on
  `trained_words` / `trigger_words` / `author_settings`; a LoRA card only on a
  model file plus a rating / bench / favourite / Civitai id (or an explicit
  `adapter_cards` file); copy cards, presets, characters and assets only from
  explicitly named files (`copy_cards`, `preset`, `cast`/`character`,
  `assets.json`/`inventory`/`vault`). Job records, UI state, model indexes and
  static manifests stay in `raw` no matter what prompt/steps/path fields
  they carry. `tools/test_export_video_studio.py` pins this down with a
  decoy-heavy fixture (`npm run test:exporter`).
- `raw` is budgeted: 256 KB per source and 8 MB in total by default
  (`--raw-max-kb`, `--raw-total-mb`); beyond that only the shape is kept, so
  the bundle stays phone-sized while the digest still lists every source.
- Writes only `~/comfy-mobile-content/bundle.json` and `digest.txt`
  (atomically). Nothing is written anywhere else.
- Prints a counts summary and a **schema-only digest** (key names and types,
  never values). Paste the digest back when something does not classify as
  expected — it is safe to share.

Useful flags: `--dry-run` (print, write nothing), `--root PATH` (other tree),
`--raw-all` (keep every parsed source verbatim under `raw`),
`--max-examples N` (example images/videos kept per record, default 6), `-v`.

## Thumbnails and example media

Media **bytes never enter the bundle or git**. The exporter only records paths
relative to the Video Studio root, and only for media clearly tied to a kept
record. Order of trust, per record:

1. **Fields on the record.** Thumb: `thumb`, `thumbnail`, `thumb_url`,
   `thumbnail_url`, `thumb_path`, `preview`, `preview_url`, `preview_image`,
   `preview_path`, `poster`, `poster_url`, `cover`, `cover_image`,
   `cover_url`, `image`, `image_url`, `image_path`, `example_image`, `icon`,
   `reference`, `reference_image`, `reference_path`. Examples: `examples`,
   `example`, `example_url`, `example_video(s)`, `example_images`, `images`,
   `videos`, `video`, `video_url`, `video_path`, `samples`, `sample`,
   `sample_video`, `media`, `gallery`, `previews`, `clips`, `clip`, `demo`,
   `demo_video`. Values may be relative paths, `/static/...` paths or
   `http://<mac>:8140/static/...` URLs — they are mapped back onto files in
   the tree. External URLs (Civitai etc.) are dropped and counted as
   unresolved.
2. **Same file stem.** Same-stem files whose name carries a thumb marker
   (`_thumb`, `_poster`, `_cover`, `_preview`, `_still`, `_ref`) become the
   thumb; remaining same-stem images and videos become examples.
3. **Beside the source file** (`config/foo.json` ↔ `config/foo.png`,
   `config/foo_2.jpg`) — only when that file describes a single record, so a
   25-record part-docs file never sprays one still onto every card.

**`data/reference_recipes/<jobId>.json`** is special: each sidecar is one
job (6–20 keyframe records carrying `created_at`, which the tight classifier
would otherwise drop as job-like). The exporter emits **one recipe card per
file**, never splits it: title from a short name field (`name`, `title`,
`label`, `display_name`, `scene_name`, …, ≤ 80 chars) or else the job id;
thumb = sibling `<jobId>_start.jpg`; examples = sibling
`<jobId>_scene_NN.jpg`, numerically sorted, capped. Tagged `reference`, with
the keyframe count in the notes. This is the only path with a layout rule;
every other file goes through the tight classifier unchanged.

`videos/**` clips attach by stem to a workflow/recipe when the name matches;
everything left over is listed in the **Videos** section (grouped by folder),
not dumped onto every card. Each record keeps at most `--max-examples`
examples, videos first.

Never indexed, never surfaced, and not reachable via `/media/`: the internal
QA trees `qc`, `reviews`, `evidence`, `audits`, `tests`, `tmp_claude`,
`verify-<date>`, `report_assets`, `mobile-ui-shots`, `h3_recipe_guard`,
`output`, `tmp`, plus backups/caches, hidden files and `.bak` names.

**`--serve` exposes `/media/<relative path>`** read-only from `--root` (the
Video Studio tree). It is jailed: traversal (`..`, encoded or not), absolute
paths, symlinks leaving the root, non-media extensions and the skipped trees
above all answer 404. HTTP `Range` is honoured (206) so Safari's `<video>`
can scrub. No other roots are served. Media under the bulk volume
(`/Volumes/SABRENT/...`) is outside the tree and therefore not served.

In the app the phone builds media URLs from the configured **Source URL**
only (`http://100.89.112.7:8152/media/...`); there are no CDNs or external
hosts. A file-imported bundle still uses the configured Source URL for
previews, and shows a labelled placeholder when it cannot load them.

## Pictures in the page (`/studio-thumbs/`)

My Studio loads one document, `GET /studio-thumbs/index.json`, with
`credentials: 'omit'`. Every path in it is relative to `/studio-thumbs/`.
Absolute URLs and `..` are dropped. There is no PIN and no call to Video
Studio.

```json
{
  "loras": [{ "name": "", "file": "", "thumb": "", "trigger": "", "rating": 0 }],
  "workflows": [{ "name": "", "thumb": "", "examples": [] }],
  "copies": [{ "name": "", "poster": "", "preview": "", "examples": [] }]
}
```

Optional fields when present: `model`, `author`, `duration`, a Civitai id,
and `favorite` (or `favourite`) which draws a star. A workflow may have
`"thumb": null`; the card then uses the first still example.

Copy cards play `preview` (or the first example) inline, muted and looping.
Other examples stay on the card. LoRA and workflow cards show their thumbnail
image. If `index.json` is not in the build, the tab is one line: "pictures
are not in this build."

Video Studio's own image and video libraries are not imported. New pictures
and clips made in this app live in the Gallery (see below).

## This app's Gallery and permanent delete

The **Gallery** tab lists this app's own ComfyUI outputs (from `/history`),
not the old Video Studio libraries. Each tile and the full-size viewer have a
bin control; the confirm sheet's **Delete forever** removes that run through
ComfyUI itself — `POST /history {"delete": [prompt_id]}` — so it disappears
from the Gallery on every device and from ComfyUI's history. Nothing is
hidden client-side and there is no hidden-items list. Only on a 2xx does the
item leave the grid; a failure keeps it with the server's error text.

ComfyUI core has no route that unlinks an output file (`/history` delete
removes the run record; the opt-in Assets API soft-deletes a reference, not
the file), so the confirm text says plainly that the bytes stay in the
server's output folder until it is cleaned up there. LoRA, workflow and copy
cards have no delete control.

## Bundle schema

Defined in `src/core/content/schema.ts` (`comfy-mobile-content`, version 2).
Sections: `copyCards`, `recipes`, `loras`, `workflows`, `presets`,
`characters`, `assets`, `videos`, plus `raw` (unclassified sources, keyed by
path), `skipped` and `counts`. Copy cards, recipes, LoRAs, workflows, presets
and characters carry optional `thumb` (relative image path) and `examples`
(`{path, kind: image|video, poster?}`); `videos` entries are
`{name, path, poster?, folder}`. The app's `normaliseBundle()` is tolerant: a partial
bundle, or one produced by hand, still loads.

## How it shows up in the app

My Studio has three sections, all from `/studio-thumbs/index.json`:

- **Copy cards** — the preview plays inline, muted and looping. Extra examples
  sit on the card. Name, and model / author / duration when the index has them.
  A favorite draws a star. Tapping the card opens a run sheet: the preview stays,
  the prompt is a text field prefilled from the card, and New photo is optional.
  Run stays on screen above the tab bar. It queues that card's workflow through
  the connected ComfyUI server without waiting for the node list. Every other
  setting stays as it is in the workflow file.
- **LoRAs** — thumbnail, name, trigger, rating. Browsing only.
- **Workflows** — thumbnail (or the first still example when `thumb` is null).
  Tapping one opens the same run sheet as a copy card.

The Mac adds `workflowFile`, `prompt`, `promptNodeId`, `promptField`,
`imageNodeId`, and `imageField` on copy and workflow rows, and puts the
workflow JSON under `/studio-thumbs/runs/`. Those files are the flat ComfyUI
API prompt Video Studio submits: each node id maps to `class_type` and
`inputs`, subgraphs already expanded. A null `workflowFile` tells the sheet
this card cannot be built, and Run is not offered. A null node id leaves that
box on screen and does not overwrite that part of the prompt. If the phone is
not connected, the sheet says so and does not submit.

Run posts that API prompt with the same submit the tests call. A relative
workflow path is joined to the page origin before it is fetched. The post
uses the same base as the node-list fetch. A saved address with no scheme,
such as `100.103.142.118:8188`, is prefixed with `http://` and posted to
`http://100.103.142.118:8188/prompt`. Prompt words, including
angle brackets such as `<Picture 1>`, are a JSON field sent as bytes.
They are not a string argument to `Request`. It does not rebuild
the graph. The prompt text is written only when the words were edited and
`promptNodeId` / `promptField` are set. A new photo is written only when one
was chosen and `imageNodeId` / `imageField` are set. Every other input stays,
including objects such as `timeline_data` and `builder_state`. An accepted post opens the Queue on the live list, with that prompt id
visible. If the post fails or does not answer within 30 seconds, the sheet
stays open and shows the error instead of sitting on Queuing.

`/studio-thumbs/gallery.json` is loaded once when My Studio opens and kept in
memory. New photo opens that grid immediately and does not fetch it again.
Only the pictures in the gallery viewport are decoded. Tapping one fetches
that file from an absolute page URL, uploads it to ComfyUI, and sets the
card's image input. It does not open the camera roll. The sheet shows one
photo line. If `gallery.json` is missing, the sheet says the gallery is not
in this build. A failed post shows the server's text.

A UI graph, when a card still has one, is still converted with the app's
existing queue path, subgraph expansion included. On a UI graph, Run sets
`widgets_values_named[promptField]` when that key exists. If it does not, and
the node is a text widget (including PixaromaText), Run replaces that string
in `widgets_values` and leaves every other widget alone.

The Gallery tab is unchanged: this app's ComfyUI renders, with confirm-to-delete.
It does not import Video Studio's old image or video libraries.
