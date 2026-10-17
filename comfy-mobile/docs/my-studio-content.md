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

Then in the app: **My Studio → Fetch from Mac**. The default source URL is
`http://100.89.112.7:8152/bundle.json` (Mac mini Tailscale IP, port 8152) and
can be changed under **My Studio → Source**.

Re-run step 1 whenever the Video Studio content changes; the app re-fetches
on the refresh button (and once automatically when it has nothing cached).

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
2. **Same file stem.** `data/reference_recipes/<stem>.jpg` is *the* recipe
   thumbnail (590 of them in the live tree) and is preferred for recipes and
   LoRA cards. Other same-stem files whose name carries a thumb marker
   (`_thumb`, `_poster`, `_cover`, `_preview`, `_still`, `_ref`) become the
   thumb; remaining same-stem images and videos become examples.
3. **Beside the source file** (`config/foo.json` ↔ `config/foo.png`,
   `config/foo_2.jpg`) — only when that file describes a single record, so a
   25-record part-docs file never sprays one still onto every card.

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

- **Every card shows its thumbnail**; a card without one gets a labelled
  placeholder (initials + kind), never a blank row. Tap the thumbnail to open
  the record's example images and inline-playing videos.
- **Copy cards** – tap to append to the prompt; the title opens Replace / Add.
- **Recipes** – *Use* maps author settings onto the current template, selects
  matching LoRA files on the server (and switches their toggles on), saves a
  local recipe and jumps to Studio. Trigger words of any selected LoRA are
  injected into the final prompt automatically (`useStudio.loraTriggerWords`).
- **LoRA Lab** – adapter cards with ratings; *On server* filter matches by file
  name against `/object_info`. Ratings, notes and trigger words are mirrored
  into the existing LoRA picker store. A rating you edit locally is never
  overwritten by a later fetch.
- **Workflows** – UI-format workflows open in Graph or save to the library;
  API-format workflows are run-only (posted straight to `/prompt`).
- **Presets** – tap to apply values (optionally with the prompt).
- **Videos** – example clips under `videos/` not tied to a card, grouped by
  folder; tap a tile to play it in place.
- **More** – characters (tap to insert), asset lists, unclassified raw sources.

## No Tailscale on the phone?

**My Studio → Source → Import file** loads a `bundle.json` from the device
(AirDrop / Files). Everything is cached in IndexedDB (localStorage fallback)
so the tab works offline afterwards.

If the app is served over `https://` and the Mac serves plain `http://`, the
browser blocks the fetch (mixed content); use the file import or serve the
app over `http://` on the tailnet.
