#!/usr/bin/env python3
"""Put Mac and Skytech records that are not in the phone catalog into studio-thumbs.

Reads what is already on disk. Does not download models and does not queue a render.
Media is linked, not copied. A LoRA file that is not installed on Skytech stays out.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
THUMBS = ROOT / "public" / "studio-thumbs"
INDEX = THUMBS / "index.json"
STUDIO = Path.home() / "archon-staging" / "video-studio"
RECIPES = STUDIO / "config" / "civitai_recipes"
RECIPES_OFF = STUDIO / "config" / "civitai_recipes_off"
ORIGINALS = STUDIO / "config" / "original_workflows"
PREVIEWS = Path("/Volumes/SABRENT/build-caches/archon-cold/video-studio/copy_previews")
LORA_PREVIEWS = Path(
    "/Volumes/SABRENT/build-caches/archon-cold/video-studio/data-media/.active-20261004T192253-d3050f9a/lora_previews"
)
SKYTECH_LORAS = Path("/tmp/skytech-loras.json")
MEDIA = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm", ".mov"}


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def link(src: Path, dest: Path) -> bool:
    if dest.exists() or dest.is_symlink():
        return dest.exists()
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.symlink_to(src)
    return True


def slash_files(graph: dict) -> dict:
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for key, value in list(inputs.items()):
            if isinstance(value, str) and "\\" in value and (
                key.endswith("_name") or key in {"image", "image_path", "lora", "ckpt_name"} or ".safetensors" in value.lower()
            ):
                inputs[key] = value.replace("\\", "/")
    return graph


def is_api(graph) -> bool:
    if not isinstance(graph, dict) or not graph:
        return False
    sample = next(iter(graph.values()))
    return isinstance(sample, dict) and isinstance(sample.get("class_type"), str)


def text_at(graph: dict, node_id, field: str) -> str:
    node = graph.get(str(node_id)) if node_id is not None else None
    if not isinstance(node, dict):
        return ""
    value = (node.get("inputs") or {}).get(field)
    return value if isinstance(value, str) else ""


def node_id(value):
    text = str(value).strip() if value is not None else ""
    return int(text) if text.isdigit() else None


def main() -> None:
    index = load_json(INDEX)
    copies = index["copies"]
    workflows = index["workflows"]
    loras = index["loras"]
    before = {"copies": len(copies), "workflows": len(workflows), "loras": len(loras)}

    copy_ids = {str(row.get("civitaiId") or "") for row in copies}
    added_copies = []
    for path in sorted(RECIPES.glob("*.json")):
        if not path.stem.isdigit() or path.stem in copy_ids:
            continue
        recipe = load_json(path)
        graph = ((recipe.get("graph_as_posted") or {}).get("prompt"))
        if not is_api(graph):
            continue
        slots = ((recipe.get("app") or {}).get("slots")) or {}
        prompt_slot = slots.get("prompt") or {}
        image_slot = slots.get("image") or {}
        write_json(THUMBS / "runs" / f"c-{path.stem}.json", slash_files(graph))
        poster = PREVIEWS / f"{path.stem}.jpg"
        preview = PREVIEWS / f"{path.stem}.mp4"
        linked_poster = link(poster, THUMBS / "copies" / poster.name)
        linked_preview = link(preview, THUMBS / "copies" / preview.name)
        examples = [f"copies/{preview.name}"] if linked_preview else []
        copies.append(
            {
                "name": recipe.get("family") or recipe.get("base_model") or f"Civitai {path.stem}",
                "model": recipe.get("family") or recipe.get("base_model") or "",
                "author": recipe.get("author") or "",
                "duration": recipe.get("duration_s"),
                "civitaiId": path.stem,
                "favorite": False,
                "poster": f"copies/{poster.name}" if linked_poster else None,
                "preview": f"copies/{preview.name}" if linked_preview else None,
                "examples": examples,
                "workflowFile": f"runs/c-{path.stem}.json",
                "prompt": text_at(graph, prompt_slot.get("node"), prompt_slot.get("field") or "text"),
                "promptNodeId": node_id(prompt_slot.get("node")),
                "promptField": prompt_slot.get("field"),
                "imageNodeId": node_id(image_slot.get("node")) if image_slot else None,
                "imageField": image_slot.get("field") if image_slot else None,
            }
        )
        added_copies.append(path.stem)

    pulled = []
    if RECIPES_OFF.is_dir():
        seen = set()
        for path in RECIPES_OFF.rglob("*.json"):
            stem = path.stem.split(".")[0]
            if stem.isdigit() and stem not in copy_ids and stem not in added_copies and stem not in seen:
                seen.add(stem)
                pulled.append(stem)

    run_names = {path.name for path in (THUMBS / "runs").glob("*.json")}
    added_workflows = []
    workflows_without_thumb = 0
    for path in sorted(ORIGINALS.glob("*.json")):
        entry = load_json(path)
        graph_path = (entry.get("api_graph") or {}).get("path")
        graph_file = ORIGINALS / graph_path if graph_path and not os.path.isabs(graph_path) else Path(graph_path or "")
        if not graph_file.is_file():
            graph_file = STUDIO / (graph_path or "")
        if not graph_file.is_file():
            continue
        run_name = f"o-{path.stem}.json"
        if run_name in run_names:
            continue
        graph = load_json(graph_file)
        if not is_api(graph):
            continue
        write_json(THUMBS / "runs" / run_name, slash_files(graph))
        art = ORIGINALS / "artifacts" / path.stem
        media = sorted(
            [item for item in art.iterdir() if item.suffix.lower() in MEDIA],
            key=lambda item: (0 if item.stem.lower().startswith("thumb") else 1, item.name),
        ) if art.is_dir() else []
        thumb = None
        examples = []
        for item in media:
            dest_name = f"ow_{path.stem}_{item.name}"
            if link(item, THUMBS / "workflows" / dest_name):
                rel = f"workflows/{dest_name}"
                if thumb is None and item.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                    thumb = rel
                elif len(examples) < 4:
                    examples.append(rel)
        if thumb is None and not examples:
            workflows_without_thumb += 1
        controls = entry.get("controls") or {}
        prompt_name = next((name for name, spec in controls.items() if isinstance(spec, dict) and spec.get("type") == "text"), None)
        image_name = next((name for name, spec in controls.items() if isinstance(spec, dict) and spec.get("type") == "image"), None)
        bindings = ((entry.get("manifest") or {}).get("bindings")) or {}
        prompt_bind = (bindings.get(prompt_name) or [{}])[0] if prompt_name else {}
        image_bind = (bindings.get(image_name) or [{}])[0] if image_name else {}
        workflows.append(
            {
                "name": entry.get("label") or path.stem,
                "model": entry.get("engine") or "",
                "author": "",
                "thumb": thumb,
                "examples": examples,
                "favorite": False,
                "workflowFile": f"runs/{run_name}",
                "prompt": text_at(graph, prompt_bind.get("node"), prompt_bind.get("input") or "text"),
                "promptNodeId": node_id(prompt_bind.get("node")),
                "promptField": prompt_bind.get("input"),
                "imageNodeId": node_id(image_bind.get("node")) if image_bind else None,
                "imageField": image_bind.get("input") if image_bind else None,
            }
        )
        added_workflows.append(path.stem)

    installed = defaultdict(list)
    if SKYTECH_LORAS.is_file():
        for rel in load_json(SKYTECH_LORAS):
            if isinstance(rel, str) and rel.strip():
                installed[os.path.basename(rel).lower()].append(rel.replace("\\", "/"))
    indexed_files = {os.path.basename(row.get("file") or "").lower() for row in loras if (row.get("file") or "").strip()}
    preview_names = {path.name.lower(): path for path in LORA_PREVIEWS.iterdir() if path.is_file()} if LORA_PREVIEWS.is_dir() else {}
    cards = load_json(STUDIO / "config" / "lora_cards.json")["cards"]
    added_loras = []
    loras_no_thumb = 0
    not_installed = []
    ambiguous = []
    seen_new = set(indexed_files)
    for card in cards.values():
        for option in card.get("options") or []:
            for filename in option.get("files") or []:
                base = os.path.basename(filename).lower()
                if not base or base in seen_new:
                    continue
                paths = installed.get(base) or []
                if not paths:
                    not_installed.append(base)
                    seen_new.add(base)
                    continue
                if len(paths) != 1:
                    ambiguous.append(base)
                    seen_new.add(base)
                    continue
                version = option.get("version_id")
                model = card.get("model_id")
                thumb_src = None
                for candidate in (f"cv_{version}.jpg" if version else "", f"cv_{model}.jpg" if model else ""):
                    if candidate and candidate.lower() in preview_names:
                        thumb_src = preview_names[candidate.lower()]
                        break
                thumb = None
                if thumb_src is not None:
                    dest = THUMBS / "loras" / thumb_src.name
                    if link(thumb_src, dest):
                        thumb = f"loras/{thumb_src.name}"
                if thumb is None:
                    loras_no_thumb += 1
                trigger = option.get("trigger") or ""
                if not trigger:
                    words = option.get("trained_words") or []
                    trigger = ", ".join(word for word in words if isinstance(word, str))
                loras.append(
                    {
                        "name": card.get("name") or base,
                        "file": paths[0],
                        "thumb": thumb,
                        "trigger": trigger,
                        "rating": None,
                        "model": option.get("base_model") or card.get("arch") or "",
                        "author": card.get("author") or "",
                        "civitaiId": str(model) if model else None,
                        "favorite": False,
                    }
                )
                seen_new.add(base)
                added_loras.append(base)

    bare = [row.get("name") for row in workflows if not row.get("thumb") and not row.get("examples") and not str(row.get("workflowFile") or "").startswith("runs/o-")]
    write_json(INDEX, index)
    summary = {
        "before": before,
        "after": {"copies": len(copies), "workflows": len(workflows), "loras": len(loras)},
        "added_copies": added_copies,
        "pulled_copy_ids": len(pulled),
        "added_workflows": len(added_workflows),
        "new_workflows_without_local_thumb": workflows_without_thumb,
        "older_workflows_without_local_thumb": len(bare),
        "added_loras": len(added_loras),
        "added_loras_without_local_thumb": loras_no_thumb,
        "lora_files_not_installed": len(not_installed),
        "lora_files_ambiguous": len(ambiguous),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
