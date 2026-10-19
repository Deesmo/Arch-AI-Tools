#!/usr/bin/env python3
"""Regression test for export_video_studio.py's classifier.

Builds a synthetic Video Studio tree in a temp dir: the handful of real
content shapes (part docs with trained_words, adapter cards with ratings,
copy cards, a preset file, a cast file, an asset manifest, node graphs) PLUS
the kinds of generic JSON the real tree is full of — job records, UI state,
static manifests, prompt logs, model indexes. The loose first-cut rules
promoted those decoys into thousands of recipes / assets / LoRAs / presets;
the tight rules must leave every one of them in `raw`.

    python3 tools/test_export_video_studio.py          # from comfy-mobile/
"""
from __future__ import annotations

import json
import os
import sqlite3
import struct
import sys
import tempfile
import textwrap
import threading
import unittest
import urllib.error
import urllib.request
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_video_studio as ex  # noqa: E402

UI_WF = {"last_node_id": 2, "last_link_id": 1, "nodes": [
    {"id": 1, "type": "CheckpointLoaderSimple", "pos": [0, 0], "size": [300, 100], "flags": {}, "order": 0, "mode": 0,
     "inputs": [], "outputs": [{"name": "MODEL", "type": "MODEL", "links": [1]}], "properties": {}, "widgets_values": ["x.safetensors"]},
    {"id": 2, "type": "CLIPTextEncode", "pos": [0, 200], "size": [300, 100], "flags": {}, "order": 1, "mode": 0,
     "inputs": [{"name": "clip", "type": "CLIP", "link": None}], "outputs": [], "properties": {}, "widgets_values": ["wan2.2 cinematic"]}],
    "links": [[1, 1, 0, 2, 0, "MODEL"]], "groups": [], "config": {}, "extra": {}, "version": 0.4}
API_WF = {"3": {"class_type": "KSampler", "inputs": {"seed": 1, "steps": 20, "model": ["4", 0]}},
          "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "ltx.safetensors"}}}


def tiny_png(rgb=(200, 80, 40), size=4) -> bytes:
    """A valid size×size PNG (stdlib only) — a stand-in for a real thumbnail."""
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
    row = b"\x00" + bytes(rgb) * size
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * size)) + chunk(b"IEND", b""))


def tiny_mp4() -> bytes:
    """An `ftyp` + empty `moov` box: enough for the exporter and the /media/ route (not playable)."""
    ftyp = b"isom\x00\x00\x02\x00isomiso2mp41"
    return struct.pack(">I", 8 + len(ftyp)) + b"ftyp" + ftyp + struct.pack(">I", 8) + b"moov" + b"\x00" * 2048


def build_tree(root: Path) -> None:
    (root / ".gitignore").write_text("*\n# this tree must never sync anywhere\n")

    # ---- media stand-ins, laid out like the live tree (bytes never enter the bundle) ----
    (root / "data" / "reference_recipes").mkdir(parents=True)    # 590 .jpg in the live tree: THE recipe thumbnails
    (root / "static" / "thumbs").mkdir(parents=True)
    (root / "static" / "previews").mkdir(parents=True)
    (root / "videos" / "burst").mkdir(parents=True)              # 140 example .mp4 (68 in burst/)
    (root / "config").mkdir()                                    # 371 images beside the json/cards they describe
    (root / "data" / "reference_recipes" / "part_01.jpg").write_bytes(tiny_png())   # recipe thumb by stem (wins over other stills)
    (root / "data" / "reference_recipes" / "part_03.jpg").write_bytes(tiny_png())   # the only image for part_03
    (root / "data" / "reference_recipes" / "orphan_recipe.jpg").write_bytes(tiny_png())  # no recipe → nowhere
    # the live layout: `<jobId>.json` sidecar (6–20 keyframe records with created_at) + `<jobId>_start.jpg` + `<jobId>_scene_NN.jpg`
    job = {"job_id": "job_7f3a", "name": "Harbor dawn", "status": "done", "created_at": "2026-07-01T06:00:00", "engine": "wan",
           "keyframes": [{"scene": i, "prompt": "keyframe %d" % i, "created_at": "2026-07-01T06:%02d:00" % i, "steps": 20, "cfg": 3.5} for i in range(1, 9)]}
    (root / "data" / "reference_recipes" / "job_7f3a.json").write_text(json.dumps(job))
    (root / "data" / "reference_recipes" / "job_7f3a_start.jpg").write_bytes(tiny_png())
    (root / "data" / "reference_recipes" / "job_7f3a_scene_10.jpg").write_bytes(tiny_png())    # numeric order, not lexical
    (root / "data" / "reference_recipes" / "job_7f3a_scene_01.jpg").write_bytes(tiny_png())
    (root / "data" / "reference_recipes" / "job_7f3a_scene_02.jpg").write_bytes(tiny_png())
    (root / "data" / "reference_recipes" / "job_0c21.json").write_text(json.dumps(                # no name field, no images → id, placeholder
        [{"scene": i, "prompt": "kf %d" % i, "created_at": "2026-07-02"} for i in range(6)]))
    (root / "static" / "thumbs" / "part_01.jpg").write_bytes(tiny_png())              # same stem as the LoRA file
    (root / "static" / "thumbs" / "part_01_thumb.png").write_bytes(tiny_png())        # thumb-marked still → example
    (root / "videos" / "part_01.mp4").write_bytes(tiny_mp4())                         # stem → recipe/LoRA example
    for i in range(10):                                                                 # more examples than the cap
        (root / "static" / "previews" / ("part_01_sample%d.png" % i)).write_bytes(tiny_png((i, i, i)))
    (root / "static" / "previews" / "drone_card.png").write_bytes(tiny_png())         # referenced by field only
    (root / "config" / "golden_hour.png").write_bytes(tiny_png())                      # copy-card stem match
    (root / "config" / "jonah.png").write_bytes(tiny_png())                            # character stem match
    (root / "config" / "workflow_part_docs.png").write_bytes(tiny_png())              # beside a 25-record file → attached to none
    (root / "videos" / "wrapped.mp4").write_bytes(tiny_mp4())                         # stem → workflow example
    (root / "videos" / "showreel.mp4").write_bytes(tiny_mp4())                        # tied to nothing → Videos section
    (root / "videos" / "showreel.jpg").write_bytes(tiny_png())                         # its poster
    (root / "videos" / "burst" / "burst_0001.mp4").write_bytes(tiny_mp4())            # → Videos section
    (root / "videos" / "burst" / "burst_0002.mp4").write_bytes(tiny_mp4())            # → Videos section
    (root / "static" / "thumbs" / "part_00.webp").write_bytes(tiny_png())            # referenced by Video Studio URL
    (root / "static" / "thumbs" / "part_01.jpg.bak").write_bytes(tiny_png())          # backup names never served
    (root / "secret.json").write_text(json.dumps({"api_key": "sk-abcdefghijklmnopqrstuvwxyz"}))  # must not be reachable via /media/
    # internal QA trees: never indexed, never surfaced, even when stems match real records
    for qa in ("qc", "reviews", "evidence", "audits", "tests", "tmp_claude", "verify-20260723", "report_assets",
               "mobile-ui-shots", "h3_recipe_guard", "output", "tmp"):
        (root / qa).mkdir()
        (root / qa / "golden_hour.png").write_bytes(tiny_png())
        (root / qa / "part_03.mp4").write_bytes(tiny_mp4())
        (root / qa / "qa_clip.mp4").write_bytes(tiny_mp4())

    # ---- real content -------------------------------------------------------
    parts = {}
    for i in range(25):
        parts["part_%02d.safetensors" % i] = {
            "civitai": {"model_id": 1000 + i, "version_id": 2000 + i},
            "trained_words": ["tw%d" % i, "cinematic"],
            "author_settings": {"steps": 20 + i % 5, "cfg": 3.5, "lora_strength": 0.8},
            "notes": "part %d" % i,
        }
    parts["part_00.safetensors"]["preview_url"] = "http://127.0.0.1:8140/static/thumbs/part_00.webp"
    parts["part_02.safetensors"]["example"] = "https://civitai.com/images/123.mp4"   # external → unresolved, dropped
    (root / "config" / "workflow_part_docs.json").write_text(json.dumps(parts))

    (root / "adapter_cards.py").write_text(textwrap.dedent('''
        ADAPTER_CARDS = [
            {"file": "part_01.safetensors", "name": "Part One", "rating": 5, "benched": True, "notes": "best motion"},
            {"file": "drone_v2.safetensors", "rating": "B+", "triggers": "drone shot, aerial", "thumb": "/static/previews/drone_card.png"},
            {"name": "bare_name_card", "rating": 4},
        ]
        BENCHED = {"part_02.safetensors": {"rating": 3.5, "comment": "ok"}}
    '''))

    (root / "copies").mkdir()
    (root / "copies" / "copy_cards.json").write_text(json.dumps({
        "Golden hour": "golden hour, warm rim light, 35mm",
        "Noir": "high contrast, venetian blinds, smoke",
        "Macro": "macro lens, shallow depth of field",
    }))

    (root / "presets.yaml").write_text(textwrap.dedent('''
        - name: Fast 4-step
          steps: 4
          cfg: 1.0
          width: 832
          height: 480
        - name: Quality
          settings: {steps: 30, cfg: 4.0}
    '''))

    (root / "cast.yaml").write_text(textwrap.dedent('''
        characters:
          - name: Jonah
            appearance: weathered fisherman, 60s
            trigger_words: [jonah_lora]
          - name: Vee
            look: cyberpunk courier
    '''))

    (root / "vault").mkdir()
    (root / "vault" / "assets.json").write_text(json.dumps([
        {"name": "hero_ref.png", "path": "vault/img/hero_ref.png", "size": 12345, "mime": "image/png"},
        {"name": "clip1.mp4", "path": "vault/clip1.mp4", "bytes": 999, "duration": 5.2},
    ]))

    (root / "workflows").mkdir()
    (root / "workflows" / "wrapped.json").write_text(json.dumps(UI_WF))
    (root / "workflows" / "ltx_api.json").write_text(json.dumps(API_WF))
    (root / "workflows" / "ltx_api_2.jpg").write_bytes(tiny_png())                     # beside a single-record file → attached

    # ---- decoys: generic JSON the loose rules promoted ----------------------
    (root / "state").mkdir()
    # render queue / job records: prompt + steps + cfg + status (was → presets / copy cards)
    jobs = [{"id": "job-%04d" % i, "prompt": "a cat %d" % i, "negative": "blurry", "steps": 20, "cfg": 3.5,
             "width": 832, "height": 480, "status": "done", "created_at": "2026-10-16T00:00:%02d" % (i % 60),
             "output_path": "renders/out_%04d.mp4" % i} for i in range(400)]
    (root / "state" / "render_queue.json").write_text(json.dumps(jobs))
    # prompt log: plain text records (was → copy cards, thousands of them)
    (root / "state" / "prompt_log.jsonl").write_text("\n".join(json.dumps({"text": "prompt %d" % i, "ts": i}) for i in range(300)))
    # model index: every file on disk with size/mtime (was → loras, no opinion attached)
    models = [{"file": "model_%04d.safetensors" % i, "size": 1000 + i, "mtime": 1.0 * i, "sha256": "%064x" % i} for i in range(500)]
    (root / "state" / "model_index.json").write_text(json.dumps(models))
    # generic settings/defaults blobs (was → recipes via `settings` / `defaults`)
    (root / "config" / "ui_defaults.json").write_text(json.dumps({"defaults": {"theme": "dark", "steps": 20, "cfg": 3.5}, "settings": {"autosave": True}}))
    # static manifest: paths + sizes under a deep assets dir (was → assets, 11k of them)
    (root / "static" / "assets" / "icons").mkdir(parents=True)
    manifest = {"icon_%03d.svg" % i: {"path": "static/assets/icons/icon_%03d.svg" % i, "size": 200 + i} for i in range(200)}
    (root / "static" / "assets" / "icons" / "manifest.json").write_text(json.dumps(manifest))
    # per-run metadata with author-ish words in values, but no strong keys
    runs = [{"name": "run %d" % i, "author": "brad", "params": {"seed": i, "steps": 20}, "elapsed": 12.5} for i in range(150)]
    (root / "state" / "runs.json").write_text(json.dumps(runs))
    # a tokenizer dump: `tokens` used to count as trigger words
    (root / "state" / "word_counts.json").write_text(json.dumps([{"text": "foo", "tokens": ["f", "oo"], "count": 3}] * 50))
    # sqlite with a jobs table full of prompts and a real loras table
    con = sqlite3.connect(str(root / "studio.db"))
    con.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, prompt TEXT, steps INTEGER, cfg REAL, status TEXT)")
    con.executemany("INSERT INTO jobs VALUES (?, ?, ?, ?, ?)", [(i, "job prompt %d" % i, 20, 3.5, "ok") for i in range(250)])
    con.execute("CREATE TABLE loras (id INTEGER PRIMARY KEY, filename TEXT, rating INTEGER, trigger_words TEXT)")
    con.execute("INSERT INTO loras VALUES (1, 'db_card.safetensors', 4, 'tw_db')")
    con.commit()
    con.close()


class TightClassifier(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name) / "video-studio"
        cls.root.mkdir()
        build_tree(cls.root)
        bundle = ex.export(cls.root, max_mb=25, raw_all=False, raw_max_kb=256, include_dirs=set(), verbose=False, raw_total_mb=1.0)
        cls.result = bundle.to_json(None)
        cls.bundle = bundle

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def sources(self, section: str):
        return [r["source"] for r in self.result[section]]

    def test_real_content_is_classified(self) -> None:
        c = self.result["counts"]
        self.assertEqual(c["recipes"], 25 + 2, self.sources("recipes"))         # 25 part docs + 2 reference-recipe jobs
        self.assertEqual(c["copyCards"], 3, self.sources("copyCards"))
        self.assertEqual(c["presets"], 2, self.sources("presets"))
        self.assertEqual(c["characters"], 2, self.sources("characters"))
        self.assertEqual(c["assets"], 2, self.sources("assets"))
        self.assertEqual(c["workflows"], 2, self.sources("workflows"))
        rated = [l for l in self.result["loras"] if l["rating"] is not None]
        files = {l["file"] for l in rated}
        self.assertEqual(files, {"part_01.safetensors", "drone_v2.safetensors", "bare_name_card", "part_02.safetensors", "db_card.safetensors"}, files)
        # part docs also feed LoRA Lab with trigger words (unrated)
        self.assertEqual(self.result["counts"]["loras"], 25 + 3, self.sources("loras"))

    def test_decoys_stay_in_raw(self) -> None:
        for section in ex.SECTIONS:
            for src in self.sources(section):
                self.assertFalse(src.startswith("state/"), "%s promoted %s" % (section, src))
                self.assertFalse(src.startswith("static/"), "%s promoted %s" % (section, src))
                self.assertFalse(src.startswith("config/ui_defaults"), "%s promoted %s" % (section, src))
                self.assertFalse(src.startswith("studio.db#jobs"), "%s promoted %s" % (section, src))
        raw = self.result["raw"]
        for src in ("state/render_queue.json", "state/prompt_log.jsonl", "state/model_index.json", "config/ui_defaults.json",
                    "static/assets/icons/manifest.json", "state/runs.json", "state/word_counts.json", "studio.db#jobs"):
            self.assertIn(src, raw, "decoy %s missing from raw" % src)
            self.assertIn("shape", raw[src])

    def test_totals_are_on_the_order_of_the_recon(self) -> None:
        c = self.result["counts"]
        self.assertLess(c["recipes"] + c["presets"] + c["copyCards"] + c["assets"] + c["characters"], 60, c)
        self.assertLess(c["loras"], 40, c)

    def test_raw_budget_keeps_shapes_only_beyond_cap(self) -> None:
        raw = self.result["raw"]
        self.assertLessEqual(self.bundle.raw_bytes, 1024 * 1024)
        truncated = [k for k, v in raw.items() if v.get("data") is None]
        for k in truncated:
            self.assertIn("truncated", raw[k])
            self.assertIn("shape", raw[k])

    def test_digest_has_no_values(self) -> None:
        digest = ex.format_digest(self.bundle, self.result)
        for leak in ("golden hour", "a cat 7", "weathered fisherman", "job prompt 3", "best motion"):
            self.assertNotIn(leak, digest)

    def test_loose_rules_would_have_promoted_the_decoys(self) -> None:
        """Documents why the tight rules exist: shape alone must never promote."""
        job = {"prompt": "a cat", "steps": 20, "cfg": 3.5, "status": "done"}
        self.assertEqual(ex.record_kind(job, None), "unknown")
        self.assertEqual(ex.record_kind({"text": "prompt 1", "ts": 1}, None), "unknown")
        self.assertEqual(ex.record_kind({"file": "m.safetensors", "size": 1, "mtime": 2.0}, None), "unknown")
        self.assertEqual(ex.record_kind({"defaults": {"steps": 20}}, None), "unknown")
        self.assertEqual(ex.record_kind({"path": "a/b.svg", "size": 3}, None), "unknown")
        self.assertEqual(ex.record_kind({"path": "a/b.svg", "size": 3}, "assets"), "assets")
        self.assertEqual(ex.record_kind({"name": "x", "tokens": ["a"]}, None), "unknown")
        # strong signals still promote without any file-name hint
        self.assertEqual(ex.record_kind({"file": "m.safetensors", "rating": 4}, None), "loras")
        self.assertEqual(ex.record_kind({"lora": "m.safetensors", "trained_words": ["x"]}, None), "recipes")
        self.assertEqual(ex.record_kind({"lora": "m.safetensors", "author_settings": {"steps": 8}}, None), "recipes")
        self.assertEqual(ex.record_kind(API_WF, None), "workflows")

    # ---- media ------------------------------------------------------------------
    def by_file(self, section: str, key: str, value: str):
        hits = [r for r in self.result[section] if r.get(key) == value]
        self.assertEqual(len(hits), 1, "%s %s=%s → %d hits" % (section, key, value, len(hits)))
        return hits[0]

    def all_media_paths(self):
        for section in ex.SECTIONS:
            for r in self.result[section]:
                for p in [r.get("thumb")] + [e["path"] for e in r.get("examples", [])] + [e.get("poster") for e in r.get("examples", [])]:
                    if p:
                        yield section, p
        for v in self.result["videos"]:
            for p in (v["path"], v.get("poster")):
                if p:
                    yield "videos", p

    def test_media_bytes_and_media_dirs_never_enter_the_bundle(self) -> None:
        encoded = json.dumps(self.result)
        self.assertNotIn("\\u0089PNG", encoded)
        self.assertNotIn("ftyp", encoded)
        self.assertEqual(self.result["counts"]["assets"], 2)                       # videos/ and config/ images did not become assets
        for a in self.result["assets"]:
            self.assertFalse(a["source"].startswith(("videos", "config", "data/reference")))
        for _, p in self.all_media_paths():
            self.assertFalse(p.startswith("/") or ".." in p or "://" in p, p)
            self.assertTrue((self.root / p).is_file(), p)

    def test_qa_dirs_are_never_surfaced(self) -> None:
        qa = ("qc/", "reviews/", "evidence/", "audits/", "tests/", "tmp_claude/", "verify-20260723/", "report_assets/",
              "mobile-ui-shots/", "h3_recipe_guard/", "output/", "tmp/")
        for section, p in self.all_media_paths():
            self.assertFalse(p.startswith(qa), "%s surfaced QA media %s" % (section, p))
        self.assertFalse(any(rel.startswith(qa) for rel in self.bundle.media.paths.values()))
        # 12 QA dirs × 3 files are not indexed; the counted files are exactly the real ones
        self.assertEqual(self.result["counts"]["mediaFiles"], 31)
        # a QA still with a matching stem never beats the real one
        self.assertEqual(self.by_file("copyCards", "title", "Golden hour")["thumb"], "config/golden_hour.png")

    def test_recipe_thumb_comes_from_reference_recipes_by_stem(self) -> None:
        recipe = next(r for r in self.result["recipes"] if r["loras"][0]["file"] == "part_01.safetensors")
        self.assertEqual(recipe["thumb"], "data/reference_recipes/part_01.jpg")
        kinds = {e["kind"] for e in recipe["examples"]}
        self.assertIn("video", kinds)
        video = next(e for e in recipe["examples"] if e["kind"] == "video")
        self.assertEqual(video["path"], "videos/part_01.mp4")                       # stem match → attached, not a Videos entry
        self.assertEqual(video.get("poster"), "data/reference_recipes/part_01.jpg")
        self.assertLessEqual(len(recipe["examples"]), 6)                            # cap honoured (10 samples + more exist)
        self.assertIn("static/thumbs/part_01_thumb.png", [e["path"] for e in recipe["examples"]])
        part3 = next(r for r in self.result["recipes"] if r["loras"][0]["file"] == "part_03.safetensors")
        self.assertEqual(part3["thumb"], "data/reference_recipes/part_03.jpg")
        self.assertEqual(part3["examples"], [])                                    # QA part_03.mp4 copies ignored
        # the LoRA card fed by that recipe carries the same visuals
        card = self.by_file("loras", "file", "part_01.safetensors")
        self.assertEqual(card["thumb"], "data/reference_recipes/part_01.jpg")
        self.assertIn("videos/part_01.mp4", [e["path"] for e in card["examples"]])

    def test_reference_recipe_job_is_one_card_with_start_thumb_and_scene_examples(self) -> None:
        job = self.by_file("recipes", "source", "data/reference_recipes/job_7f3a.json")
        self.assertEqual(job["name"], "Harbor dawn")                                 # short name field, never the prompt
        self.assertEqual(job["thumb"], "data/reference_recipes/job_7f3a_start.jpg")
        self.assertEqual([e["path"] for e in job["examples"]],
                         ["data/reference_recipes/job_7f3a_scene_01.jpg", "data/reference_recipes/job_7f3a_scene_02.jpg",
                          "data/reference_recipes/job_7f3a_scene_10.jpg"])
        self.assertEqual(job["kind"], "reference")
        self.assertIn("reference", job["tags"])
        self.assertIn("8 keyframes", job["notes"])
        self.assertEqual(job["engine"], "wan")
        # not split: no keyframe became its own record anywhere, and nothing landed in raw
        self.assertEqual(sum(1 for r in self.result["recipes"] if r["source"].startswith("data/reference_recipes/job_7f3a")), 1)
        self.assertNotIn("data/reference_recipes/job_7f3a.json", self.result["raw"])
        for section in ex.SECTIONS:
            for r in self.result[section]:
                self.assertFalse(r["source"].startswith("data/reference_recipes/job_7f3a.json."), r["source"])
        # a job without a name field or images: id as title, placeholder in the app
        bare = self.by_file("recipes", "source", "data/reference_recipes/job_0c21.json")
        self.assertEqual(bare["name"], "job_0c21")
        self.assertIsNone(bare["thumb"])
        self.assertEqual(bare["examples"], [])
        self.assertIn("6 keyframes", bare["notes"])
        # why the special path exists: the tight classifier (rightly) drops keyframe rows as job-like
        self.assertEqual(ex.record_kind({"scene": 1, "prompt": "x", "created_at": "2026", "steps": 20, "cfg": 3.5}, "recipes"), "unknown")
        # scene images are claimed: not loose, not attached to any other card
        for section, p in self.all_media_paths():
            if p.startswith("data/reference_recipes/job_7f3a"):
                self.assertEqual(section, "recipes")

    def test_thumb_by_field_including_video_studio_urls(self) -> None:
        drone = self.by_file("loras", "file", "drone_v2.safetensors")
        self.assertEqual(drone["thumb"], "static/previews/drone_card.png")          # `/static/...` → relative
        part0 = next(r for r in self.result["recipes"] if r["loras"][0]["file"] == "part_00.safetensors")
        self.assertEqual(part0["thumb"], "static/thumbs/part_00.webp")             # http://mac:8140/static/... → relative
        part2 = next(r for r in self.result["recipes"] if r["loras"][0]["file"] == "part_02.safetensors")
        self.assertIsNone(part2["thumb"])                                           # external URL dropped
        self.assertEqual(part2["examples"], [])
        self.assertGreaterEqual(self.bundle.media_stats["unresolved"], 1)

    def test_config_images_attach_by_stem_or_beside_a_single_record(self) -> None:
        self.assertEqual(self.by_file("copyCards", "title", "Golden hour")["thumb"], "config/golden_hour.png")
        self.assertEqual(self.by_file("characters", "name", "Jonah")["thumb"], "config/jonah.png")
        ltx = self.by_file("workflows", "name", "ltx_api")
        self.assertEqual(ltx["thumb"], "workflows/ltx_api_2.jpg")                   # beside its single-record file
        # a still beside a 25-record file belongs to none of them
        for _, p in self.all_media_paths():
            self.assertNotEqual(p, "config/workflow_part_docs.png")
        self.assertIsNone(self.by_file("copyCards", "title", "Noir")["thumb"])    # untied → placeholder in the app
        self.assertEqual(self.by_file("copyCards", "title", "Noir")["examples"], [])
        self.assertGreaterEqual(self.result["counts"]["visuals"], 5)

    def test_videos_attach_by_stem_else_videos_section(self) -> None:
        wf = self.by_file("workflows", "name", "wrapped")
        self.assertIsNone(wf["thumb"])                                              # video only, no still
        self.assertEqual(wf["examples"], [{"path": "videos/wrapped.mp4", "kind": "video"}])
        videos = self.result["videos"]
        self.assertEqual([v["path"] for v in videos], ["videos/burst/burst_0001.mp4", "videos/burst/burst_0002.mp4", "videos/showreel.mp4"])
        self.assertEqual(self.result["counts"]["videos"], 3)
        showreel = next(v for v in videos if v["path"] == "videos/showreel.mp4")
        self.assertEqual(showreel["poster"], "videos/showreel.jpg")
        self.assertEqual(showreel["folder"], "videos")
        self.assertEqual(showreel["name"], "showreel")
        self.assertEqual(videos[0]["folder"], "videos/burst")
        for v in videos:
            self.assertEqual(v["kind"], "video")
            self.assertEqual(v["source"], v["path"])
        # attached clips are not repeated in the Videos section
        self.assertNotIn("videos/wrapped.mp4", [v["path"] for v in videos])
        self.assertNotIn("videos/part_01.mp4", [v["path"] for v in videos])

    def test_media_route_is_jailed_to_the_root(self) -> None:
        ex.OUT_DIR.mkdir(parents=True, exist_ok=True)
        httpd = ex.make_server(0, self.root, host="127.0.0.1")
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        base = "http://127.0.0.1:%d" % port

        def get(path: str, headers=None, method="GET"):
            req = urllib.request.Request(base + path, headers=headers or {}, method=method)
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    return r.status, dict(r.headers), r.read()
            except urllib.error.HTTPError as e:
                return e.code, dict(e.headers), b""

        try:
            status, hdr, body = get("/media/static/thumbs/part_01_thumb.png")
            self.assertEqual(status, 200)
            self.assertEqual(hdr["Content-Type"], "image/png")
            self.assertEqual(hdr["Access-Control-Allow-Origin"], "*")
            self.assertEqual(body, (self.root / "static/thumbs/part_01_thumb.png").read_bytes())
            # byte ranges for <video>
            status, hdr, body = get("/media/videos/part_01.mp4", {"Range": "bytes=4-7"})
            self.assertEqual(status, 206)
            self.assertEqual(body, b"ftyp")
            self.assertEqual(hdr["Content-Range"], "bytes 4-7/%d" % (self.root / "videos/part_01.mp4").stat().st_size)
            status, _, _ = get("/media/videos/part_01.mp4", method="HEAD")
            self.assertEqual(status, 200)
            # jail: traversal, encoded traversal, absolute, data files, backups, hidden, outside root
            for bad in ("/media/../secret.json", "/media/%2e%2e/secret.json", "/media/static/../../secret.json",
                        "/media//etc/passwd", "/media/secret.json", "/media/config/workflow_part_docs.json",
                        "/media/static/thumbs/part_01.jpg.bak", "/media/.gitignore", "/media/", "/media/static/thumbs/missing.png",
                        "/media/static/thumbs/part_01_thumb.png/..", "/media/qc/golden_hour.png", "/media/verify-20260723/qa_clip.mp4"):
                status, _, body = get(bad)
                self.assertEqual(status, 404, bad)
                self.assertNotIn(b"sk-", body)
            # bundle dir still served as before
            status, _, _ = get("/nope.json")
            self.assertEqual(status, 404)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_resolve_media_request_rejects_symlink_escape(self) -> None:
        outside = Path(self.tmp.name) / "outside.png"
        outside.write_bytes(tiny_png())
        link = self.root / "static" / "thumbs" / "escape.png"
        try:
            os.symlink(str(outside), str(link))
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        try:
            self.assertIsNone(ex.resolve_media_request(self.root, "/media/static/thumbs/escape.png"))
        finally:
            link.unlink()

    def test_path_hint_uses_file_name_only(self) -> None:
        self.assertIsNone(ex.path_hint("static/assets/icons/manifest.json"))
        self.assertEqual(ex.path_hint("vault/assets.json"), "assets")
        self.assertEqual(ex.path_hint("config/workflow_part_docs.json"), "recipes")
        self.assertEqual(ex.path_hint("adapter_cards.py/BENCHED"), "loras")
        self.assertIsNone(ex.path_hint("some/author_notes/state.json"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
