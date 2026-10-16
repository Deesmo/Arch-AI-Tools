#!/usr/bin/env python3
"""
export_video_studio.py — pack Brad's Video Studio content into ONE bundle.json
for the comfy-mobile "My Studio" tab. Runs ON the Mac mini; stdlib only.

    python3 export_video_studio.py                 # read ~/archon-staging/video-studio
    python3 export_video_studio.py --root PATH     # another tree
    python3 export_video_studio.py --serve         # serve ~/comfy-mobile-content on 0.0.0.0:8152

What it does
  * walks the Video Studio tree and defensively reads every JSON / JSONL /
    YAML / SQLite / Python-literal / JS-embedded-JSON data source it finds
  * classifies records into: copy cards, recipes (parts with trained words +
    author settings), LoRA cards (+ratings), workflows (ComfyUI UI or API
    JSON), presets, characters, assets (names + metadata only, never media)
  * anything it cannot classify is kept verbatim under `raw`, keyed by the
    source path, so nothing is lost
  * writes ONE file: ~/comfy-mobile-content/bundle.json (+ digest.txt)
  * prints a counts summary and a schema-only digest (keys and types, never
    values) that is safe to paste back for debugging

Guarantees
  * never writes anywhere except ~/comfy-mobile-content/
  * never opens a network connection (--serve only LISTENS, on the tailnet)
  * never includes media bytes; values under secret-looking keys are redacted
  * the Video Studio tree is opened read-only (SQLite via mode=ro)

The bundle shape is defined in comfy-mobile/src/core/content/schema.ts.
Python 3.8+ (macOS system python3 is fine).
"""
from __future__ import annotations

import argparse
import ast
import datetime as _dt
import json
import os
import re
import socket
import sqlite3
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

EXPORTER_NAME = "export_video_studio.py"
EXPORTER_VERSION = "1.0.0"
SCHEMA = "comfy-mobile-content"
SCHEMA_VERSION = 1

OUT_DIR = Path.home() / "comfy-mobile-content"
DEFAULT_ROOT = Path.home() / "archon-staging" / "video-studio"
DEFAULT_PORT = 8152

SECTIONS = ("copyCards", "recipes", "loras", "workflows", "presets", "characters", "assets")

# ---------------------------------------------------------------------------
# What to look at / what to leave alone
# ---------------------------------------------------------------------------

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
    "logs", "log", "status", "tmp", "temp", "cache", "caches", ".cache",
    "thumbs", "thumbnails", "outputs", "output", "renders", "media", "evidence",
    "jobs", "job", "queue", "runs", "history", "backups", "backup", ".bak",
}
DATA_EXT = {".json", ".jsonl", ".ndjson", ".yaml", ".yml", ".db", ".sqlite", ".sqlite3", ".py", ".js", ".txt", ".md"}
# .txt/.md are only read when their NAME looks like content (see TEXT_NAME_HINTS)
TEXT_NAME_HINTS = ("copy", "prompt", "recipe", "trigger", "preset", "character", "snippet")
MEDIA_EXT = {
    ".mp4", ".mov", ".mkv", ".webm", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".heic",
    ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin",
    ".zip", ".tar", ".gz", ".7z", ".pdf", ".ico", ".icns", ".ttf", ".woff", ".woff2",
}
SKIP_NAME_RE = re.compile(r"(\.bak(\b|[-_.])|\.orig$|~$|\.swp$|\.pyc$|^\.DS_Store$|\.min\.js$)", re.I)
SECRET_FILE_RE = re.compile(r"(^\.env|\.pem$|\.key$|secret|credential|token|id_rsa|id_ed25519|\.p12$|\.keychain)", re.I)
SECRET_KEY_RE = re.compile(r"(pass(word|wd)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|bearer|session[_-]?id|\bpin\b|pin[_-]?(code|hash))", re.I)
SECRET_VALUE_RE = re.compile(r"\b(sk-[A-Za-z0-9_-]{16,}|rp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{20,}|tskey-[A-Za-z0-9-]{10,})\b")
MODEL_FILE_RE = re.compile(r"\.(safetensors|pt|pth|ckpt|gguf|bin|lora)$", re.I)

# path tokens → section hint (first match wins; order matters)
PATH_HINTS: List[Tuple[str, Tuple[str, ...]]] = [
    ("copyCards", ("copy_card", "copycard", "copy-card", "copies", "copy_cards", "snippet", "prompt_library", "prompt-library", "prompts")),
    ("recipes", ("recipe", "part_doc", "workflow_part", "parts", "author", "trained")),
    ("loras", ("adapter", "lora", "benched")),
    ("presets", ("preset",)),
    ("characters", ("character", "persona", "cast", "talent")),
    ("assets", ("asset", "vault", "inventory")),
    ("workflows", ("workflow", "graph", "pipeline")),
]

# record-key aliases
K_NAME = ("name", "title", "label", "display_name", "displayName", "model_name", "modelName", "_key", "slug", "id")
K_TEXT = ("text", "prompt", "positive", "positive_prompt", "positivePrompt", "copy", "body", "content", "snippet", "template")
K_NEG = ("negative", "negative_prompt", "negativePrompt", "neg")
K_TRIGGERS = ("trained_words", "trainedWords", "trigger_words", "triggerWords", "triggers", "trigger", "activation", "activation_text", "activation_words", "keywords", "tokens")
K_FILE = ("file", "filename", "fileName", "lora", "lora_file", "loraFile", "lora_name", "loraName", "model_file", "modelFile", "local_file", "local_path", "path", "safetensors", "_key", "name", "model")
K_FILES = ("files", "loras", "lora_files", "adapters")
K_RATING = ("rating", "brad_rating", "bradRating", "stars", "score", "grade", "rank", "verdict_score")
K_SETTINGS = ("author_settings", "authorSettings", "settings", "recommended", "recommended_settings", "recommendedSettings", "defaults", "params", "parameters", "values")
K_NOTES = ("notes", "note", "comment", "comments", "description", "desc", "summary", "verdict", "review", "about")
K_TAGS = ("tags", "categories", "category", "style", "styles", "genre")
K_ENGINE = ("engine", "family", "model_family", "modelFamily", "arch", "architecture", "base_model_family")
K_BASE = ("base_model", "baseModel", "base", "sd_version", "sdVersion")
K_STRENGTH = ("strength", "weight", "lora_strength", "strength_model", "recommended_strength", "recommendedStrength", "default_strength")
K_KIND = ("kind", "type", "part_type", "partType", "model_type", "modelType")
K_FAV = ("favourite", "favorite", "fav", "starred", "pinned")
K_BENCHED = ("benched", "tested", "bench", "verified", "tried")
K_WORKFLOW = ("workflow", "graph", "ui_workflow", "workflow_json", "api_prompt", "prompt_json", "api")
CONTAINER_KEYS = ("items", "cards", "parts", "recipes", "loras", "adapters", "adapter_cards", "presets", "workflows",
                  "characters", "assets", "entries", "data", "results", "records", "copies", "docs", "list", "rows", "cast", "library",
                  "snippets", "prompts", "templates", "cards_by_group", "groups")
SETTINGS_LIKE = {"steps", "cfg", "cfg_scale", "guidance", "width", "height", "frames", "length", "fps", "seed", "sampler", "sampler_name",
                 "scheduler", "shift", "denoise", "strength", "resolution", "aspect", "duration", "seconds", "engine", "model", "checkpoint", "lora"}
CHARACTER_LIKE = {"appearance", "age", "hair", "eyes", "outfit", "personality", "voice", "backstory", "gender", "ethnicity", "body", "look"}
ASSET_LIKE = {"size", "bytes", "mime", "mimetype", "duration", "width", "height", "sha256", "md5", "mtime", "url", "thumbnail"}
LETTER_GRADES = {"S": 5, "A+": 5, "A": 5, "A-": 4.5, "B+": 4, "B": 4, "B-": 3.5, "C+": 3, "C": 3, "C-": 2.5, "D": 2, "E": 1, "F": 1}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Redaction + schema digest (never leaks values)
# ---------------------------------------------------------------------------

def redact(value: Any, key: str = "") -> Any:
    if key and SECRET_KEY_RE.search(key):
        return "<redacted>"
    if isinstance(value, dict):
        return {str(k): redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str) and SECRET_VALUE_RE.search(value):
        return SECRET_VALUE_RE.sub("<redacted>", value)
    if isinstance(value, bytes):
        return "<blob %d bytes>" % len(value)
    return value


_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-. ]{0,40}$")


def shape(value: Any, depth: int = 0, max_depth: int = 6) -> Any:
    """Structural digest: keys and types only. Dict keys that look like data
    (long, non-identifier, or too many) are collapsed so prompts/filenames
    used as keys never appear."""
    if depth > max_depth:
        return "…"
    if isinstance(value, dict):
        keys = list(value.keys())
        if not keys:
            return {}
        ident = [k for k in keys if isinstance(k, str) and _IDENT_RE.match(k) and not MODEL_FILE_RE.search(k)]
        if len(keys) > 25 or len(ident) < len(keys):
            merged: Dict[str, Any] = {}
            for v in list(value.values())[:50]:
                s = shape(v, depth + 1, max_depth)
                if isinstance(s, dict):
                    for k, sv in s.items():
                        merged.setdefault(k, sv)
                else:
                    merged.setdefault("<value>", s)
            return {"<%d keys>" % len(keys): merged}
        return {k: shape(value[k], depth + 1, max_depth) for k in keys}
    if isinstance(value, (list, tuple)):
        if not value:
            return []
        first = shape(value[0], depth + 1, max_depth)
        return [first, "…×%d" % len(value)] if len(value) > 1 else [first]
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    return type(value).__name__


# ---------------------------------------------------------------------------
# Readers: JSON / JSONL / YAML (mini) / SQLite / Python literals / JS-embedded
# ---------------------------------------------------------------------------

def read_json(path: Path) -> Any:
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # tolerate a UTF-8 BOM, trailing commas and // comments (hand-edited configs)
        cleaned = text.lstrip("\ufeff")
        cleaned = re.sub(r"(?m)^\s*//.*$", "", cleaned)
        cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
        return json.loads(cleaned)


def read_jsonl(path: Path, max_lines: int = 5000) -> List[Any]:
    out: List[Any] = []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for i, line in enumerate(fh):
            if i >= max_lines:
                break
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


class _Yaml:
    """A small YAML subset: block mappings/sequences, inline [] / {}, quoted
    scalars, | and > block scalars, comments. Enough for hand-written config."""

    def __init__(self, text: str):
        self.lines: List[Tuple[int, str]] = []
        for raw in text.splitlines():
            if raw.strip() in ("---", "...") or not raw.strip() or raw.lstrip().startswith("#"):
                continue
            indent = len(raw) - len(raw.lstrip(" "))
            self.lines.append((indent, raw.strip()))
        self.pos = 0

    @staticmethod
    def _is_item(s: str) -> bool:
        return s == "-" or s.startswith("- ")

    @staticmethod
    def _strip_comment(s: str) -> str:
        out, quote = [], None
        for i, ch in enumerate(s):
            if quote:
                out.append(ch)
                if ch == quote:
                    quote = None
            elif ch in "\"'":
                quote = ch
                out.append(ch)
            elif ch == "#" and (i == 0 or s[i - 1] in " \t"):
                break
            else:
                out.append(ch)
        return "".join(out).strip()

    @classmethod
    def _split_kv(cls, s: str) -> Optional[Tuple[str, str]]:
        quote, depth = None, 0
        for i, ch in enumerate(s):
            if quote:
                if ch == quote:
                    quote = None
            elif ch in "\"'":
                quote = ch
            elif ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
            elif ch == ":" and depth == 0 and (i + 1 == len(s) or s[i + 1] in " \t"):
                key = s[:i].strip().strip("\"'")
                return key, s[i + 1:].strip()
        return None

    @classmethod
    def scalar(cls, s: str) -> Any:
        s = cls._strip_comment(s)
        if s == "":
            return None
        if s[0] in "\"'" and s[-1] == s[0] and len(s) >= 2:
            inner = s[1:-1]
            return inner.replace('\\"', '"').replace("\\n", "\n") if s[0] == '"' else inner.replace("''", "'")
        if s[0] == "[" and s[-1] == "]":
            return [cls.scalar(p) for p in cls._split_inline(s[1:-1])] if s[1:-1].strip() else []
        if s[0] == "{" and s[-1] == "}":
            out: Dict[str, Any] = {}
            for p in cls._split_inline(s[1:-1]):
                kv = cls._split_kv(p)
                if kv:
                    out[kv[0]] = cls.scalar(kv[1])
            return out
        low = s.lower()
        if low in ("true", "yes", "on"):
            return True
        if low in ("false", "no", "off"):
            return False
        if low in ("null", "~", "none"):
            return None
        if re.fullmatch(r"[-+]?\d+", s):
            return int(s)
        if re.fullmatch(r"[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?", s):
            return float(s)
        return s

    @staticmethod
    def _split_inline(s: str) -> List[str]:
        parts, buf, quote, depth = [], [], None, 0
        for ch in s:
            if quote:
                buf.append(ch)
                if ch == quote:
                    quote = None
            elif ch in "\"'":
                quote = ch
                buf.append(ch)
            elif ch in "[{":
                depth += 1
                buf.append(ch)
            elif ch in "]}":
                depth -= 1
                buf.append(ch)
            elif ch == "," and depth == 0:
                parts.append("".join(buf).strip())
                buf = []
            else:
                buf.append(ch)
        if "".join(buf).strip():
            parts.append("".join(buf).strip())
        return parts

    def parse(self) -> Any:
        if not self.lines:
            return None
        return self.block(self.lines[0][0])

    def block(self, indent: int) -> Any:
        if self.pos >= len(self.lines):
            return None
        _, content = self.lines[self.pos]
        return self.seq(indent) if self._is_item(content) else self.map(indent)

    def value_or_block(self, val: str, key_indent: int) -> Any:
        val = self._strip_comment(val)
        if val in ("|", ">", "|-", ">-", "|+", ">+"):
            parts = []
            while self.pos < len(self.lines) and self.lines[self.pos][0] > key_indent:
                parts.append(self.lines[self.pos][1])
                self.pos += 1
            return ("\n" if val[0] == "|" else " ").join(parts)
        if val != "":
            return self.scalar(val)
        if self.pos < len(self.lines):
            ind, content = self.lines[self.pos]
            if ind > key_indent or (ind == key_indent and self._is_item(content)):
                return self.block(ind)
        return None

    def map(self, indent: int) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        while self.pos < len(self.lines):
            ind, content = self.lines[self.pos]
            if ind < indent or (ind == indent and self._is_item(content)):
                break
            if ind > indent:
                self.pos += 1  # stray deeper line; skip rather than loop forever
                continue
            kv = self._split_kv(content)
            self.pos += 1
            if not kv:
                out.setdefault("_text", []).append(content)
                continue
            out[kv[0]] = self.value_or_block(kv[1], indent)
        return out

    def seq(self, indent: int) -> List[Any]:
        out: List[Any] = []
        while self.pos < len(self.lines):
            ind, content = self.lines[self.pos]
            if ind != indent or not self._is_item(content):
                break
            self.pos += 1
            item = content[1:].strip()
            if item == "":
                if self.pos < len(self.lines) and self.lines[self.pos][0] > indent:
                    out.append(self.block(self.lines[self.pos][0]))
                else:
                    out.append(None)
                continue
            kv = self._split_kv(item)
            if kv and not (item[0] in "\"'[{"):
                m: Dict[str, Any] = {kv[0]: self.value_or_block(kv[1], indent + 2)}
                if self.pos < len(self.lines) and self.lines[self.pos][0] > indent and not self._is_item(self.lines[self.pos][1]):
                    m.update(self.map(self.lines[self.pos][0]))
                out.append(m)
            else:
                out.append(self.scalar(item))
        return out


def read_yaml(path: Path) -> Any:
    return _Yaml(path.read_text(encoding="utf-8", errors="replace")).parse()


def read_sqlite(path: Path, max_rows: int = 5000) -> Dict[str, List[Dict[str, Any]]]:
    uri = "file:%s?mode=ro" % path.resolve().as_uri()[7:]
    con = sqlite3.connect(uri, uri=True, timeout=2)
    try:
        con.row_factory = sqlite3.Row
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        out: Dict[str, List[Dict[str, Any]]] = {}
        for t in tables:
            rows: List[Dict[str, Any]] = []
            for r in con.execute('SELECT * FROM "%s" LIMIT %d' % (t.replace('"', '""'), max_rows)):
                row: Dict[str, Any] = {}
                for k in r.keys():
                    v = r[k]
                    if isinstance(v, bytes):
                        v = "<blob %d bytes>" % len(v)
                    elif isinstance(v, str) and v[:1] in "[{":
                        try:
                            v = json.loads(v)
                        except ValueError:
                            pass
                    row[k] = v
                rows.append(row)
            out[t] = rows
        return out
    finally:
        con.close()


def read_py_literals(path: Path) -> Dict[str, Any]:
    """Module-level `NAME = {...}` / `NAME = [...]` literals (e.g. adapter_cards.py)."""
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
    out: Dict[str, Any] = {}
    for node in tree.body:
        targets: List[ast.expr] = []
        value: Optional[ast.expr] = None
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        if value is None or not isinstance(value, (ast.Dict, ast.List, ast.Tuple)):
            continue
        try:
            lit = ast.literal_eval(value)
        except Exception:
            continue
        if not lit:
            continue
        for t in targets:
            if isinstance(t, ast.Name):
                out[t.id] = lit
    return out


def read_js_embedded(path: Path, max_hits: int = 50) -> Dict[str, Any]:
    """JSON objects embedded in JS (workflow_library.js etc.): find `"nodes"` /
    `"class_type"` markers and decode the enclosing object with raw_decode."""
    text = path.read_text(encoding="utf-8", errors="replace")
    dec = json.JSONDecoder()
    out: Dict[str, Any] = {}
    claimed: List[Tuple[int, int]] = []
    for m in re.finditer(r'"(nodes|last_node_id|class_type)"\s*:', text):
        if any(a <= m.start() < b for a, b in claimed):
            continue
        start = m.start()
        tries = 0
        best = None
        while tries < 400 and start >= 0:
            start = text.rfind("{", 0, start)
            if start < 0:
                break
            tries += 1
            try:
                obj, end = dec.raw_decode(text, start)
            except ValueError:
                continue
            if isinstance(obj, dict) and (isinstance(obj.get("nodes"), list) or _looks_like_api_prompt(obj)):
                best = (obj, start, end)
                # keep walking back a little for an outer wrapper {"name":..., "workflow": {...}}
                outer_start = text.rfind("{", 0, start)
                if outer_start >= 0:
                    try:
                        outer, oend = dec.raw_decode(text, outer_start)
                        if isinstance(outer, dict) and any(isinstance(v, dict) and v is not outer and (isinstance(v.get("nodes"), list) or _looks_like_api_prompt(v)) for v in outer.values()):
                            best = (outer, outer_start, oend)
                    except ValueError:
                        pass
                break
        if best:
            obj, s, e = best
            claimed.append((s, e))
            out["offset_%d" % s] = obj
            if len(out) >= max_hits:
                break
    return out


def read_text_lines(path: Path) -> List[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    return blocks


# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------

def _looks_like_api_prompt(d: Any) -> bool:
    return isinstance(d, dict) and bool(d) and all(isinstance(v, dict) and isinstance(v.get("class_type"), str) for v in d.values())


def _looks_like_ui_workflow(d: Any) -> bool:
    return isinstance(d, dict) and isinstance(d.get("nodes"), list) and ("links" in d or "last_node_id" in d or "version" in d)


def workflow_format(d: Any) -> Optional[str]:
    if _looks_like_ui_workflow(d):
        return "ui"
    if _looks_like_api_prompt(d):
        return "api"
    return None


def path_hint(rel: str) -> Optional[str]:
    low = rel.lower()
    for section, tokens in PATH_HINTS:
        if any(t in low for t in tokens):
            return section
    return None


def first(rec: Dict[str, Any], keys: Iterable[str], types: Tuple[type, ...] = (str, int, float, bool, list, dict)) -> Any:
    for k in keys:
        if k in rec and rec[k] is not None and rec[k] != "" and isinstance(rec[k], types):
            return rec[k]
    lowmap = {str(k).lower(): k for k in rec.keys()}
    for k in keys:
        kk = lowmap.get(k.lower())
        if kk is not None and rec[kk] is not None and rec[kk] != "" and isinstance(rec[kk], types):
            return rec[kk]
    return None


def as_words(v: Any) -> List[str]:
    out: List[str] = []

    def push(x: Any) -> None:
        if isinstance(x, (list, tuple)):
            for y in x:
                push(y)
        elif isinstance(x, dict):
            push(x.get("word") or x.get("text") or x.get("name") or x.get("value"))
        elif isinstance(x, str):
            parts = re.split(r"[,;\n]", x) if re.search(r"[,;\n]", x) else [x]
            for p in parts:
                p = p.strip()
                if p:
                    out.append(p)
        elif isinstance(x, (int, float)) and not isinstance(x, bool):
            out.append(str(x))

    push(v)
    seen, uniq = set(), []
    for w in out:
        if w.lower() not in seen:
            seen.add(w.lower())
            uniq.append(w)
    return uniq


def as_rating(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, str):
        s = v.strip()
        if s.upper() in LETTER_GRADES:
            return float(LETTER_GRADES[s.upper()])
        stars = s.count("★") + s.count("*")
        if stars and set(s) <= set("★☆* "):
            return float(stars)
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(?:/\s*(\d+))?", s)
        if not m:
            return None
        v = float(m.group(1))
        if m.group(2):
            v = v / float(m.group(2)) * 5
    if isinstance(v, (int, float)):
        f = float(v)
        if f > 10:
            f = f / 20.0
        elif f > 5:
            f = f / 2.0
        return max(0.0, min(5.0, round(f * 2) / 2))
    return None


def as_num(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def as_bool(v: Any) -> Optional[bool]:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        if v.lower() in ("true", "yes", "y", "1", "on"):
            return True
        if v.lower() in ("false", "no", "n", "0", "off"):
            return False
    return None


def model_basename(v: Any) -> Optional[str]:
    if isinstance(v, str) and MODEL_FILE_RE.search(v.strip()):
        return v.strip().replace("\\", "/").split("/")[-1]
    return None


def lora_files_in(rec: Dict[str, Any]) -> List[str]:
    files: List[str] = []
    for k in K_FILE:
        f = model_basename(rec.get(k))
        if f and f not in files:
            files.append(f)
    for k in K_FILES:
        v = rec.get(k)
        if isinstance(v, list):
            for item in v:
                f = model_basename(item) if isinstance(item, str) else (model_basename(first(item, K_FILE)) if isinstance(item, dict) else None)
                if f and f not in files:
                    files.append(f)
        elif isinstance(v, dict):
            for kk, item in v.items():
                f = model_basename(kk) or (model_basename(item) if isinstance(item, str) else None)
                if f and f not in files:
                    files.append(f)
    return files


def civitai_of(rec: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    c = rec.get("civitai")
    out: Dict[str, Any] = {}
    if isinstance(c, dict):
        out = {"modelId": c.get("modelId", c.get("model_id")), "versionId": c.get("versionId", c.get("version_id")), "url": c.get("url")}
    elif isinstance(c, str):
        out = {"url": c}
    for k, dst in (("civitai_model_id", "modelId"), ("civitaiModelId", "modelId"), ("model_id", "modelId"), ("modelId", "modelId"),
                   ("civitai_version_id", "versionId"), ("civitaiVersionId", "versionId"), ("version_id", "versionId"), ("versionId", "versionId"),
                   ("civitai_url", "url"), ("civitaiUrl", "url")):
        if rec.get(k) is not None and out.get(dst) is None:
            out[dst] = rec[k]
    url = rec.get("url") or rec.get("link") or rec.get("source_url")
    if isinstance(url, str) and "civitai" in url and not out.get("url"):
        out["url"] = url
    out = {k: v for k, v in out.items() if v not in (None, "")}
    return out or None


def record_kind(rec: Dict[str, Any], hint: Optional[str]) -> str:
    """Decide which section a record belongs to. Hint = path-derived guess."""
    keys = {str(k).lower() for k in rec.keys()}
    if workflow_format(rec):
        return "workflows"
    for k in K_WORKFLOW:
        if workflow_format(rec.get(k)):
            return "workflows"
    has_triggers = any(k.lower() in keys for k in K_TRIGGERS)
    has_settings = any(k.lower() in keys for k in K_SETTINGS if k.lower() not in ("values", "params", "parameters"))
    files = lora_files_in(rec)
    has_rating = any(k.lower() in keys for k in K_RATING)
    has_bench = any(k.lower() in keys for k in K_BENCHED) or any(k.lower() in keys for k in K_FAV)
    has_text = any(k.lower() in keys for k in K_TEXT)
    settings_keys = keys & SETTINGS_LIKE

    if hint == "loras" and (files or has_rating):
        return "loras"
    if hint == "recipes" and (has_triggers or has_settings or files):
        return "recipes"
    if hint == "copyCards" and has_text:
        return "copyCards"
    if hint == "characters":
        return "characters"
    if hint == "assets":
        return "assets"
    if hint == "presets" and (settings_keys or has_settings or "values" in keys):
        return "presets"
    # shape-based fallbacks
    if files and (has_rating or has_bench):
        return "loras"
    if has_triggers or has_settings:
        return "recipes"
    if files and not has_text:
        return "loras"
    if keys & CHARACTER_LIKE and ("name" in keys or "character" in keys):
        return "characters"
    if has_text and len(settings_keys) >= 2:
        return "presets"
    if has_text:
        return "copyCards"
    if len(settings_keys) >= 2:
        return "presets"
    if ("path" in keys or "filename" in keys or "file" in keys) and (keys & ASSET_LIKE):
        return "assets"
    if hint == "assets" or hint == "characters":
        return hint
    return "unknown"


# ---------------------------------------------------------------------------
# Record extraction (handles list / dict-of-records / wrapper objects)
# ---------------------------------------------------------------------------

def iter_records(data: Any, source: str, hint: Optional[str], depth: int = 0) -> Iterable[Tuple[Dict[str, Any], str]]:
    if depth > 4:
        return
    if isinstance(data, dict):
        if workflow_format(data):
            yield data, source
            return
        if any(workflow_format(data.get(k)) for k in K_WORKFLOW):
            yield data, source
            return
        lowkeys = {str(k).lower(): k for k in data.keys()}
        containers = [lowkeys[ck] for ck in CONTAINER_KEYS if ck in lowkeys and isinstance(data[lowkeys[ck]], (list, dict)) and data[lowkeys[ck]]]
        if not containers:
            # any key holding a list of dicts is a container too ({"snippets": [...]})
            containers = [k for k, v in data.items() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)]
        if containers:
            # carry scalar siblings (e.g. "engine": "wan") down as context
            ctx = {k: v for k, v in data.items() if k not in containers and isinstance(v, (str, int, float, bool))}
            for ck in containers:
                for rec, sub in iter_records(data[ck], "%s.%s" % (source, ck), hint, depth + 1):
                    if ctx:
                        merged = dict(ctx)
                        merged.update(rec)
                        merged["_context"] = list(ctx.keys())
                        rec = merged
                    yield rec, sub
            return
        values = list(data.values())
        if values and all(isinstance(v, dict) for v in values) and len(values) >= 1:
            # dict-of-records keyed by id / filename / name
            if all(record_kind(v, hint) != "unknown" or len(v) >= 2 for v in values):
                for k, v in data.items():
                    rec = dict(v)
                    rec.setdefault("_key", str(k))
                    yield rec, "%s[%s]" % (source, _short_key(str(k)))
                return
        if values and all(isinstance(v, str) for v in values) and hint == "copyCards":
            for k, v in data.items():
                yield {"title": str(k), "text": v}, "%s[%s]" % (source, _short_key(str(k)))
            return
        if values and all(isinstance(v, list) for v in values) and len(values) <= 50:
            # {"section": [records...]} — e.g. copies grouped by category
            for k, v in data.items():
                for rec, sub in iter_records(v, "%s.%s" % (source, _short_key(str(k))), hint, depth + 1):
                    rec = dict(rec)
                    rec.setdefault("category", str(k))
                    yield rec, sub
            return
        yield data, source
        return
    if isinstance(data, list):
        for i, item in enumerate(data):
            if isinstance(item, dict):
                if workflow_format(item) or len(item) >= 1:
                    yield item, "%s[%d]" % (source, i)
            elif isinstance(item, str) and hint == "copyCards" and item.strip():
                yield {"text": item}, "%s[%d]" % (source, i)
            elif isinstance(item, list):
                for rec, sub in iter_records(item, "%s[%d]" % (source, i), hint, depth + 1):
                    yield rec, sub


def _short_key(k: str) -> str:
    k = re.sub(r"\s+", "_", k.strip())
    return k if len(k) <= 48 else k[:45] + "…"


# ---------------------------------------------------------------------------
# Converters → bundle records
# ---------------------------------------------------------------------------

_counter = {"n": 0}


def new_id(prefix: str) -> str:
    _counter["n"] += 1
    return "%s-%04d" % (prefix, _counter["n"])


def _name(rec: Dict[str, Any], fallback: str) -> str:
    n = first(rec, K_NAME, (str, int))
    if n is None:
        return fallback
    n = str(n)
    return n if n.strip() else fallback


def _notes(rec: Dict[str, Any]) -> Optional[str]:
    n = first(rec, K_NOTES, (str, list))
    if isinstance(n, list):
        n = "\n".join(str(x) for x in n)
    return str(n).strip() or None if n is not None else None


def _tags(rec: Dict[str, Any]) -> List[str]:
    return as_words(first(rec, K_TAGS, (str, list)))


def _settings(rec: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k in K_SETTINGS:
        v = rec.get(k)
        if isinstance(v, dict):
            out.update(v)
        elif isinstance(v, str) and k in ("author_settings", "recommended", "recommended_settings"):
            out.setdefault("_text", v)
    # loose top-level sampler settings count too
    for k in SETTINGS_LIKE:
        if k in rec and not isinstance(rec[k], (dict, list)) and k not in out and k not in ("engine", "model", "lora"):
            out[k] = rec[k]
    return out


def _engine(rec: Dict[str, Any]) -> Optional[str]:
    e = first(rec, K_ENGINE, (str,))
    if e:
        return str(e)
    b = first(rec, K_BASE, (str,))
    if b:
        return guess_engine(str(b))
    return None


def guess_engine(s: str) -> Optional[str]:
    low = s.lower()
    for token, label in (("wan", "Wan"), ("ltx", "LTX"), ("hunyuan", "Hunyuan"), ("flux", "Flux"), ("sdxl", "SDXL"), ("pony", "Pony"),
                         ("illustrious", "Illustrious"), ("sd 1.5", "SD1.5"), ("sd1.5", "SD1.5"), ("sd15", "SD1.5"), ("chroma", "Chroma"),
                         ("qwen", "Qwen"), ("z-image", "Z-Image"), ("zimage", "Z-Image"), ("skyreels", "SkyReels"), ("vace", "Wan VACE")):
        if token in low:
            return label
    return None


def to_copy_card(rec: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    text = first(rec, K_TEXT, (str,))
    if not text or not str(text).strip():
        return None
    title = _name(rec, str(text).strip().splitlines()[0][:48])
    return {
        "id": new_id("copy"), "source": source, "title": title, "text": str(text).strip(),
        "negative": first(rec, K_NEG, (str,)), "category": first(rec, ("category", "group", "section", "folder"), (str,)),
        "tags": _tags(rec), "notes": _notes(rec),
    }


def to_recipe(rec: Dict[str, Any], source: str) -> Dict[str, Any]:
    files = lora_files_in(rec)
    triggers = as_words(first(rec, K_TRIGGERS, (str, list, dict)))
    strength = as_num(first(rec, K_STRENGTH, (int, float, str)))
    return {
        "id": new_id("recipe"), "source": source,
        "name": _name(rec, files[0] if files else "Recipe"),
        "triggerWords": triggers,
        "loras": [{"file": f, "strength": strength, "triggerWords": triggers} for f in files],
        "settings": _settings(rec),
        "prompt": first(rec, ("prompt", "positive", "positive_prompt", "example_prompt", "prompt_format", "format"), (str,)),
        "negativePrompt": first(rec, K_NEG, (str,)),
        "engine": _engine(rec) or (guess_engine(files[0]) if files else None),
        "kind": first(rec, K_KIND, (str,)),
        "baseModel": first(rec, K_BASE, (str,)),
        "civitai": civitai_of(rec),
        "notes": _notes(rec),
        "tags": _tags(rec),
    }


def to_lora(rec: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    files = lora_files_in(rec)
    if not files:
        key = rec.get("_key") or first(rec, ("name", "lora", "file"), (str,))
        if not isinstance(key, str) or not key.strip():
            return None
        files = [key.strip()]  # name without extension; the app matches stem-insensitively
    used = {"_key", "_context"}
    for group in (K_NAME, K_FILE, K_FILES, K_RATING, K_TRIGGERS, K_NOTES, K_TAGS, K_ENGINE, K_BASE, K_STRENGTH, K_FAV, K_BENCHED, ("civitai",)):
        used.update(group)
    extra = {k: v for k, v in rec.items() if k not in used}
    return {
        "id": new_id("lora"), "source": source, "file": files[0],
        "name": first(rec, ("name", "title", "label", "display_name", "model_name"), (str,)),
        "rating": as_rating(first(rec, K_RATING, (str, int, float))),
        "favourite": as_bool(first(rec, K_FAV, (bool, int, str))),
        "benched": as_bool(first(rec, K_BENCHED, (bool, int, str))),
        "triggerWords": as_words(first(rec, K_TRIGGERS, (str, list, dict))),
        "strength": as_num(first(rec, K_STRENGTH, (int, float, str))),
        "baseModel": first(rec, K_BASE, (str,)),
        "engine": _engine(rec) or guess_engine(files[0]),
        "notes": _notes(rec),
        "tags": _tags(rec),
        "civitai": civitai_of(rec),
        "extra": extra,
    }


def to_workflow(rec: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    wf = rec if workflow_format(rec) else None
    if wf is None:
        for k in K_WORKFLOW:
            if workflow_format(rec.get(k)):
                wf = rec[k]
                break
    if wf is None:
        return None
    fmt = workflow_format(wf) or "unknown"
    name = _name(rec, source.rsplit("/", 1)[-1]) if wf is not rec else source.rsplit("/", 1)[-1]
    if wf is rec:
        # UI workflows carry no name; use the file (or embedded offset) name
        name = re.sub(r"\.(json|js)$", "", name)
    return {
        "id": new_id("workflow"), "source": source, "name": name, "format": fmt, "workflow": wf,
        "nodeCount": len(wf["nodes"]) if fmt == "ui" else len(wf),
        "engine": (_engine(rec) if wf is not rec else None) or guess_engine(json.dumps(wf)[:20000]),
        "notes": _notes(rec) if wf is not rec else None,
        "tags": _tags(rec) if wf is not rec else [],
    }


def to_preset(rec: Dict[str, Any], source: str) -> Dict[str, Any]:
    values = _settings(rec)
    if not values:
        values = {k: v for k, v in rec.items() if not isinstance(v, (dict, list)) and k not in K_NAME and k not in K_TEXT and k not in K_NOTES and not str(k).startswith("_")}
    return {
        "id": new_id("preset"), "source": source, "name": _name(rec, "Preset"), "engine": _engine(rec), "values": values,
        "prompt": first(rec, K_TEXT, (str,)), "negativePrompt": first(rec, K_NEG, (str,)), "notes": _notes(rec), "tags": _tags(rec),
    }


def to_character(rec: Dict[str, Any], source: str) -> Dict[str, Any]:
    desc = first(rec, ("description", "desc", "appearance", "prompt", "look", "bio", "summary"), (str,))
    attrs = {k: v for k, v in rec.items() if not str(k).startswith("_") and k not in K_NAME and not MODEL_FILE_RE.search(str(v)) if isinstance(v, (str, int, float, bool, list, dict))}
    return {
        "id": new_id("character"), "source": source, "name": _name(rec, "Character"), "description": desc,
        "triggerWords": as_words(first(rec, K_TRIGGERS, (str, list))), "loras": lora_files_in(rec), "tags": _tags(rec), "attributes": attrs,
    }


def to_asset(rec: Dict[str, Any], source: str) -> Dict[str, Any]:
    path = first(rec, ("path", "file", "filename", "relpath", "url"), (str,))
    meta = {k: v for k, v in rec.items() if not str(k).startswith("_") and isinstance(v, (str, int, float, bool)) and k not in ("path", "file", "filename")}
    return {
        "id": new_id("asset"), "source": source, "name": _name(rec, str(path).split("/")[-1] if path else "Asset"),
        "kind": first(rec, ("kind", "type", "mime", "category"), (str,)), "path": path, "tags": _tags(rec), "meta": meta,
    }


# ---------------------------------------------------------------------------
# Bundle assembly
# ---------------------------------------------------------------------------

class Bundle:
    def __init__(self, root: Path):
        self.root = root
        self.data: Dict[str, Any] = {k: [] for k in SECTIONS}
        self.raw: Dict[str, Any] = {}
        self.skipped: List[Dict[str, str]] = []
        self.digest: List[Dict[str, Any]] = []
        self.lora_index: Dict[str, Dict[str, Any]] = {}
        self.workflow_sigs: Dict[str, Tuple[int, Dict[str, Any]]] = {}

    def add_lora(self, card: Dict[str, Any], prefer: bool) -> None:
        key = re.sub(r"\.[a-z0-9]+$", "", card["file"].lower())
        cur = self.lora_index.get(key)
        if cur is None:
            self.lora_index[key] = card
            self.data["loras"].append(card)
            return
        # merge: ratings/notes from adapter cards win, trigger words union
        if card.get("rating") is not None and (cur.get("rating") is None or prefer):
            cur["rating"] = card["rating"]
        for k in ("name", "favourite", "benched", "strength", "baseModel", "engine", "notes", "civitai"):
            if cur.get(k) in (None, "", []) and card.get(k) not in (None, "", []):
                cur[k] = card[k]
            elif prefer and card.get(k) not in (None, "", []):
                cur[k] = card[k]
        for w in card.get("triggerWords", []):
            if w.lower() not in {x.lower() for x in cur["triggerWords"]}:
                cur["triggerWords"].append(w)
        for t in card.get("tags", []):
            if t not in cur["tags"]:
                cur["tags"].append(t)
        for k, v in card.get("extra", {}).items():
            cur["extra"].setdefault(k, v)
        if card["source"] not in cur["source"]:
            cur["source"] += " | " + card["source"]
        if MODEL_FILE_RE.search(card["file"]) and not MODEL_FILE_RE.search(cur["file"]):
            cur["file"] = card["file"]

    def add_workflow(self, wf: Dict[str, Any]) -> None:
        """De-duplicate identical workflows (the tree has .bak copies and the
        same graph embedded in JS); keep the best-described copy."""
        sig = json.dumps(wf["workflow"], sort_keys=True)[:4000] + str(wf["nodeCount"])
        score = (0 if "#offset_" in wf["name"] else 2) + (1 if wf.get("notes") else 0) + (1 if wf.get("tags") else 0)
        cur = self.workflow_sigs.get(sig)
        if cur is None:
            self.workflow_sigs[sig] = (score, wf)
            self.data["workflows"].append(wf)
            return
        if score > cur[0]:
            idx = self.data["workflows"].index(cur[1])
            self.data["workflows"][idx] = wf
            self.workflow_sigs[sig] = (score, wf)

    def ingest(self, rel: str, kind: str, data: Any, hint: Optional[str], raw_all: bool, raw_max_bytes: int) -> None:
        data = redact(data)
        counts: Dict[str, int] = {}
        unknown: List[Tuple[Dict[str, Any], str]] = []
        lora_prefer = hint == "loras"
        for rec, sub in iter_records(data, rel, hint):
            section = record_kind(rec, hint)
            out: Optional[Dict[str, Any]] = None
            if section == "copyCards":
                out = to_copy_card(rec, sub)
            elif section == "recipes":
                out = to_recipe(rec, sub)
                # a recipe about a LoRA file also feeds the LoRA Lab (trigger words)
                for f in lora_files_in(rec):
                    card = to_lora(dict(rec, file=f), sub)
                    if card:
                        card["rating"] = card["rating"] if lora_prefer else card["rating"]
                        self.add_lora(card, prefer=False)
            elif section == "loras":
                out = to_lora(rec, sub)
                if out:
                    self.add_lora(out, prefer=lora_prefer)
                    counts["loras"] = counts.get("loras", 0) + 1
                    out = None
            elif section == "workflows":
                out = to_workflow(rec, sub)
                if out:
                    self.add_workflow(out)
                    counts["workflows"] = counts.get("workflows", 0) + 1
                    out = None
            elif section == "presets":
                out = to_preset(rec, sub)
            elif section == "characters":
                out = to_character(rec, sub)
            elif section == "assets":
                out = to_asset(rec, sub)
            if out is not None:
                self.data[section].append(out)
                counts[section] = counts.get(section, 0) + 1
            elif section not in ("loras", "workflows"):
                unknown.append((rec, sub))
        total = sum(counts.values())
        keep_raw = raw_all or total == 0 or unknown
        if keep_raw:
            payload = data if total == 0 or raw_all else [dict(r, _source=s) for r, s in unknown]
            encoded = json.dumps(payload, default=str)
            entry: Dict[str, Any] = {"source": rel, "kind": kind, "shape": shape(payload)}
            if len(encoded) <= raw_max_bytes:
                entry["data"] = payload
            else:
                entry["data"] = None
                entry["truncated"] = "%d bytes > raw cap" % len(encoded)
            self.raw[rel] = entry
        self.digest.append({"source": rel, "kind": kind, "shape": shape(data), "classified": counts, "unclassified": len(unknown)})

    def to_json(self, host: Optional[str]) -> Dict[str, Any]:
        counts = {k: len(v) for k, v in self.data.items()}
        counts["raw"] = len(self.raw)
        counts["skipped"] = len(self.skipped)
        out: Dict[str, Any] = {
            "schema": SCHEMA, "version": SCHEMA_VERSION,
            "exportedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "exporter": {"name": EXPORTER_NAME, "version": EXPORTER_VERSION, "root": str(self.root), "host": host},
        }
        out.update(self.data)
        out["raw"] = self.raw
        out["skipped"] = self.skipped
        out["counts"] = counts
        return out


# ---------------------------------------------------------------------------
# Walk
# ---------------------------------------------------------------------------

def walk(root: Path, max_bytes: int, include_dirs: set) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if (d.lower() not in SKIP_DIRS or d.lower() in include_dirs) and not SKIP_NAME_RE.search(d) and not d.startswith("."))
        for fn in sorted(filenames):
            p = Path(dirpath) / fn
            ext = p.suffix.lower()
            if ext in MEDIA_EXT or ext not in DATA_EXT:
                continue
            if SKIP_NAME_RE.search(fn) or SECRET_FILE_RE.search(fn):
                continue
            if ext in (".txt", ".md") and not any(t in fn.lower() for t in TEXT_NAME_HINTS):
                continue
            try:
                if p.stat().st_size > max_bytes or p.is_symlink():
                    continue
            except OSError:
                continue
            yield p


def export(root: Path, max_mb: float, raw_all: bool, raw_max_kb: int, include_dirs: set, verbose: bool) -> Bundle:
    bundle = Bundle(root)
    max_bytes = int(max_mb * 1024 * 1024)
    raw_max = raw_max_kb * 1024
    for p in walk(root, max_bytes, include_dirs):
        rel = str(p.relative_to(root)).replace(os.sep, "/")
        ext = p.suffix.lower()
        hint = path_hint(rel)
        t0 = time.time()
        try:
            if ext == ".json":
                bundle.ingest(rel, "json", read_json(p), hint, raw_all, raw_max)
            elif ext in (".jsonl", ".ndjson"):
                bundle.ingest(rel, "jsonl", read_jsonl(p), hint, raw_all, raw_max)
            elif ext in (".yaml", ".yml"):
                try:
                    bundle.ingest(rel, "yaml", read_yaml(p), hint, raw_all, raw_max)
                except Exception as e:  # fall back to text so nothing is lost
                    bundle.ingest(rel, "text", {"_text": read_text_lines(p), "_yaml_error": type(e).__name__}, hint, raw_all, raw_max)
            elif ext in (".db", ".sqlite", ".sqlite3"):
                tables = read_sqlite(p)
                for table, rows in tables.items():
                    bundle.ingest("%s#%s" % (rel, table), "sqlite", rows, path_hint("%s/%s" % (rel, table)) or hint, raw_all, raw_max)
                if not tables:
                    bundle.skipped.append({"source": rel, "reason": "sqlite: no tables"})
            elif ext == ".py":
                lits = read_py_literals(p)
                if not lits:
                    continue
                for var, lit in lits.items():
                    bundle.ingest("%s::%s" % (rel, var), "py", lit, path_hint("%s/%s" % (rel, var)) or hint, raw_all, raw_max)
            elif ext == ".js":
                found = read_js_embedded(p)
                if not found:
                    continue
                for key, obj in found.items():
                    bundle.ingest("%s#%s" % (rel, key), "js-embedded", obj, hint or "workflows", raw_all, raw_max)
            elif ext in (".txt", ".md"):
                blocks = read_text_lines(p)
                if blocks:
                    bundle.ingest(rel, "text", blocks, hint or "copyCards", raw_all, raw_max)
        except Exception as e:  # never let one bad file sink the export
            bundle.skipped.append({"source": rel, "reason": "%s: %s" % (type(e).__name__, str(e)[:120])})
            if verbose:
                log("  skip %s (%s: %s)" % (rel, type(e).__name__, str(e)[:120]))
            continue
        if verbose:
            log("  read %s (%.0f ms)" % (rel, (time.time() - t0) * 1000))
    return bundle


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def tailnet_ip() -> Optional[str]:
    """Local address a tailnet peer would reach us on. UDP connect() sends no
    packets; it only asks the kernel which interface would be used."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("100.100.100.100", 53))
            ip = s.getsockname()[0]
        finally:
            s.close()
        return ip if ip.startswith("100.") else None
    except OSError:
        return None


def format_digest(bundle: Bundle, result: Dict[str, Any]) -> str:
    lines = ["# comfy-mobile content digest (schema only — keys and types, no values)",
             "exporter %s %s · root %s · %s" % (EXPORTER_NAME, EXPORTER_VERSION, bundle.root, result["exportedAt"]), ""]
    lines.append("## counts")
    for k, v in result["counts"].items():
        lines.append("  %-11s %d" % (k, v))
    lines.append("")
    lines.append("## bundle shape")
    lines.append(json.dumps(shape(result), indent=1))
    lines.append("")
    lines.append("## per-source")
    for d in bundle.digest:
        cls = ", ".join("%s=%d" % kv for kv in sorted(d["classified"].items())) or "-"
        lines.append("- %s [%s] classified: %s; unclassified: %d" % (d["source"], d["kind"], cls, d["unclassified"]))
        lines.append("    shape: " + json.dumps(d["shape"])[:600])
    if bundle.skipped:
        lines.append("")
        lines.append("## skipped")
        for s in bundle.skipped:
            lines.append("- %s — %s" % (s["source"], s["reason"]))
    return "\n".join(lines) + "\n"


def write_outputs(result: Dict[str, Any], digest: str, dry_run: bool) -> Tuple[Path, Path]:
    OUT_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    bundle_path = OUT_DIR / "bundle.json"
    digest_path = OUT_DIR / "digest.txt"
    if dry_run:
        return bundle_path, digest_path
    tmp = OUT_DIR / ".bundle.json.tmp"
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"), default=str)
    os.replace(tmp, bundle_path)
    digest_path.write_text(digest, encoding="utf-8")
    return bundle_path, digest_path


# ---------------------------------------------------------------------------
# --serve: plain http.server with CORS, tailnet-facing, no directory escapes
# ---------------------------------------------------------------------------

class ContentHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # CORS preflight
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("%s %s %s\n" % (time.strftime("%H:%M:%S"), self.client_address[0], fmt % args))
        sys.stdout.flush()


def serve(port: int) -> None:
    OUT_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not (OUT_DIR / "bundle.json").exists():
        log("warning: %s/bundle.json does not exist yet — run the export first" % OUT_DIR)
    handler = partial(ContentHandler, directory=str(OUT_DIR))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    ip = tailnet_ip()
    print("Serving %s on 0.0.0.0:%d (CORS *, no-store)" % (OUT_DIR, port))
    print("  phone URL: http://%s:%d/bundle.json" % (ip or "<this-mac-tailnet-ip>", port))
    print("  Ctrl-C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="Video Studio tree (default: %(default)s)")
    ap.add_argument("--serve", action="store_true", help="serve ~/comfy-mobile-content on 0.0.0.0:PORT and exit on Ctrl-C")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="port for --serve (default: %(default)s)")
    ap.add_argument("--max-file-mb", type=float, default=25.0, help="skip data files bigger than this (default: %(default)s)")
    ap.add_argument("--raw-max-kb", type=int, default=1024, help="per-source cap for verbatim `raw` data (default: %(default)s)")
    ap.add_argument("--raw-all", action="store_true", help="keep every parsed source under `raw`, not just unclassified ones")
    ap.add_argument("--include-dir", action="append", default=[], help="also descend into a normally-skipped dir name (e.g. jobs)")
    ap.add_argument("--dry-run", action="store_true", help="print the summary/digest, write nothing")
    ap.add_argument("--quiet", action="store_true", help="only print the counts summary")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every file read")
    args = ap.parse_args(argv)

    if args.serve:
        serve(args.port)
        return 0

    root = Path(os.path.expanduser(args.root)).resolve()
    if not root.is_dir():
        log("error: %s is not a directory" % root)
        return 2

    t0 = time.time()
    bundle = export(root, args.max_file_mb, args.raw_all, args.raw_max_kb, {d.lower() for d in args.include_dir}, args.verbose)
    result = bundle.to_json(socket.gethostname())
    digest = format_digest(bundle, result)
    bundle_path, digest_path = write_outputs(result, digest, args.dry_run)

    size = len(json.dumps(result, default=str))
    print("Video Studio export — %s" % root)
    print("  copy cards  %d" % result["counts"]["copyCards"])
    print("  recipes     %d  (trigger words on %d)" % (result["counts"]["recipes"], sum(1 for r in result["recipes"] if r["triggerWords"])))
    print("  LoRA cards  %d  (rated %d)" % (result["counts"]["loras"], sum(1 for l in result["loras"] if l["rating"] is not None)))
    print("  workflows   %d  (ui %d / api %d)" % (result["counts"]["workflows"], sum(1 for w in result["workflows"] if w["format"] == "ui"), sum(1 for w in result["workflows"] if w["format"] == "api")))
    print("  presets     %d" % result["counts"]["presets"])
    print("  characters  %d" % result["counts"]["characters"])
    print("  assets      %d" % result["counts"]["assets"])
    print("  raw sources %d · skipped %d · %d sources read · %.1f s" % (result["counts"]["raw"], result["counts"]["skipped"], len(bundle.digest), time.time() - t0))
    if args.dry_run:
        print("  (dry run — nothing written)")
    else:
        print("  wrote %s (%.1f KB) and %s" % (bundle_path, size / 1024, digest_path.name))
    if not args.quiet:
        print("")
        print(digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
