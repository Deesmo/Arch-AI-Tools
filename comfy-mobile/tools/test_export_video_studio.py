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
import sys
import tempfile
import textwrap
import unittest
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


def build_tree(root: Path) -> None:
    (root / ".gitignore").write_text("*\n# this tree must never sync anywhere\n")

    # ---- real content -------------------------------------------------------
    (root / "config").mkdir()
    parts = {}
    for i in range(25):
        parts["part_%02d.safetensors" % i] = {
            "civitai": {"model_id": 1000 + i, "version_id": 2000 + i},
            "trained_words": ["tw%d" % i, "cinematic"],
            "author_settings": {"steps": 20 + i % 5, "cfg": 3.5, "lora_strength": 0.8},
            "notes": "part %d" % i,
        }
    (root / "config" / "workflow_part_docs.json").write_text(json.dumps(parts))

    (root / "adapter_cards.py").write_text(textwrap.dedent('''
        ADAPTER_CARDS = [
            {"file": "part_01.safetensors", "name": "Part One", "rating": 5, "benched": True, "notes": "best motion"},
            {"file": "drone_v2.safetensors", "rating": "B+", "triggers": "drone shot, aerial"},
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
        self.assertEqual(c["recipes"], 25, self.sources("recipes"))
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

    def test_path_hint_uses_file_name_only(self) -> None:
        self.assertIsNone(ex.path_hint("static/assets/icons/manifest.json"))
        self.assertEqual(ex.path_hint("vault/assets.json"), "assets")
        self.assertEqual(ex.path_hint("config/workflow_part_docs.json"), "recipes")
        self.assertEqual(ex.path_hint("adapter_cards.py/BENCHED"), "loras")
        self.assertIsNone(ex.path_hint("some/author_notes/state.json"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
