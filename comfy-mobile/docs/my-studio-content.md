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

# 2. Serve: expose ~/comfy-mobile-content on the tailnet (Ctrl-C to stop)
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
- Writes only `~/comfy-mobile-content/bundle.json` and `digest.txt`
  (atomically). Nothing is written anywhere else.
- Prints a counts summary and a **schema-only digest** (key names and types,
  never values). Paste the digest back when something does not classify as
  expected — it is safe to share.

Useful flags: `--dry-run` (print, write nothing), `--root PATH` (other tree),
`--raw-all` (keep every parsed source verbatim under `raw`), `-v`.

## Bundle schema

Defined in `src/core/content/schema.ts` (`comfy-mobile-content`, version 1).
Sections: `copyCards`, `recipes`, `loras`, `workflows`, `presets`,
`characters`, `assets`, plus `raw` (unclassified sources, keyed by path),
`skipped` and `counts`. The app's `normaliseBundle()` is tolerant: a partial
bundle, or one produced by hand, still loads.

## How it shows up in the app

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
- **More** – characters (tap to insert), asset lists, unclassified raw sources.

## No Tailscale on the phone?

**My Studio → Source → Import file** loads a `bundle.json` from the device
(AirDrop / Files). Everything is cached in IndexedDB (localStorage fallback)
so the tab works offline afterwards.

If the app is served over `https://` and the Mac serves plain `http://`, the
browser blocks the fetch (mixed content); use the file import or serve the
app over `http://` on the tailnet.
