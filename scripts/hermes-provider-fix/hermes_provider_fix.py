#!/usr/bin/env python3
"""Stop Hermes Agent from routing through OpenRouter when direct provider keys exist.

Hermes resolves an unspecified provider by checking OPENAI_API_KEY / OPENROUTER_API_KEY
*before* it looks at the Anthropic, Gemini or xAI keys, and treats a match as "use
OpenRouter". An OpenAI key in ~/.hermes/.env is therefore enough to send every request
to openrouter.ai -- authenticated with that OpenAI key -- while the Anthropic, Gemini
and xAI keys sitting in the same file are never reached.

This tool reports every path that reaches OpenRouter, optionally checks which direct
keys actually work, and repoints Hermes at them. Diagnosis runs inside the Hermes
interpreter and calls Hermes' own resolver, so what it reports is what Hermes does.

Usage:
    python3 hermes_provider_fix.py                     # diagnose (read-only)
    python3 hermes_provider_fix.py --verify            # diagnose + live key checks
    python3 hermes_provider_fix.py --verify --apply    # check, then repoint config
    python3 hermes_provider_fix.py --apply --provider anthropic

API key values are never printed, logged or written -- only the names of the
environment variables holding them.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Direct providers this tool knows how to verify and select, in the order it
# prefers them when picking a replacement for OpenRouter. Provider ids and env
# var names are Hermes' own (hermes_cli.auth.PROVIDER_REGISTRY).
DIRECT_PROVIDERS: Tuple[str, ...] = ("anthropic", "openai-api", "xai", "gemini")

PROVIDER_LABELS: Dict[str, str] = {
    "anthropic": "Anthropic (Claude)",
    "openai-api": "OpenAI (direct API)",
    "xai": "xAI (Grok)",
    "gemini": "Google (Gemini)",
}

# First env var present wins, mirroring PROVIDER_REGISTRY[...].api_key_env_vars.
PROVIDER_KEY_VARS: Dict[str, Tuple[str, ...]] = {
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"),
    "openai-api": ("OPENAI_API_KEY",),
    "xai": ("XAI_API_KEY",),
    "gemini": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
}

# Vendor slugs returned by hermes_cli.model_normalize.detect_vendor, mapped to
# the provider that serves that vendor directly.
VENDOR_TO_PROVIDER: Dict[str, str] = {
    "anthropic": "anthropic",
    "openai": "openai-api",
    "x-ai": "xai",
    "google": "gemini",
}

# Provider names that route to OpenRouter rather than the vendor they name.
# "openai" is an alias for openrouter in hermes_cli.providers.ALIASES; the others
# are OpenRouter itself under the names the picker and docs use.
OPENROUTER_ALIASES = frozenset({"openrouter", "open-router", "openai"})

# Auxiliary task slots that accept their own provider override.
AUX_TASKS: Tuple[str, ...] = (
    "vision",
    "web_extract",
    "compression",
    "approval",
    "title_generation",
    "tts_audio_tags",
    "skills_hub",
    "mcp",
    "triage_specifier",
    "kanban_decomposer",
    "profile_describer",
    "curator",
    "background_review",
    "moa_reference",
    "moa_aggregator",
)

SEVERITY_ORDER = {"blocker": 0, "warning": 1, "note": 2}
SEVERITY_MARK = {"blocker": "[!]", "warning": "[~]", "note": "[i]"}


@dataclass
class Finding:
    """One reason Hermes reaches OpenRouter, or one thing worth cleaning up."""

    severity: str
    title: str
    detail: str
    remedy: str
    # Config keys `--apply` can clear outright with `hermes config unset`.
    config_unset: Tuple[str, ...] = ()
    # True when --apply resolves this finding some other way (e.g. by setting
    # model.provider). Findings that are neither are reported as manual work.
    auto_fixed: bool = False

    @property
    def needs_manual_edit(self) -> bool:
        return self.severity != "note" and not self.config_unset and not self.auto_fixed


@dataclass
class KeyStatus:
    """Result of a live credential check for one provider."""

    provider: str
    env_var: Optional[str] = None
    state: str = "absent"  # absent | ok | unauthorized | no_credit | error | unchecked
    note: str = ""

    @property
    def present(self) -> bool:
        return self.env_var is not None

    @property
    def usable(self) -> bool:
        return self.state == "ok"


@dataclass
class Setup:
    """Everything discovered about the local Hermes installation."""

    home: Path
    config_path: Path
    env_path: Path
    python: Optional[Path]
    cli: Optional[Path]
    # Effective configuration (user values merged over Hermes' defaults) --
    # what Hermes actually acts on.
    config: Dict[str, Any] = field(default_factory=dict)
    # Only what the user wrote to config.yaml. `hermes config unset` can clear
    # these; merged defaults must not be reported as user settings.
    user_config: Dict[str, Any] = field(default_factory=dict)
    env_names: Tuple[str, ...] = ()
    resolution: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def find_home() -> Path:
    override = os.environ.get("HERMES_HOME", "").strip()
    return Path(override).expanduser() if override else Path.home() / ".hermes"


def find_python(home: Path) -> Optional[Path]:
    """Locate the interpreter that can import hermes_cli.

    The git installer puts the venv under <home>/hermes-agent/venv; root-mode
    installs land in /usr/local/lib/hermes-agent. Anything else (pipx, Homebrew,
    a relocated venv) is found via the `hermes` launcher's own shebang, and a
    plain pip install into the ambient interpreter via sys.executable.
    """
    candidates = [
        home / "hermes-agent" / "venv" / "bin" / "python",
        Path("/usr/local/lib/hermes-agent/venv/bin/python"),
        Path(sys.executable),
    ]
    shebang = _python_from_launcher(find_cli(home))
    if shebang is not None:
        candidates.insert(0, shebang)

    for candidate in candidates:
        if candidate.is_file() and _imports_hermes(candidate):
            return candidate
    return None


def _python_from_launcher(cli: Optional[Path]) -> Optional[Path]:
    """Read the interpreter path out of the `hermes` console script's shebang."""
    if cli is None or not cli.is_file():
        return None
    try:
        with cli.open("rb") as handle:
            first = handle.readline(512).decode("utf-8", "replace").strip()
    except OSError:
        return None
    if not first.startswith("#!"):
        return None
    # "#!/path/to/python" or "#!/usr/bin/env python3"
    parts = first[2:].strip().split()
    if not parts:
        return None
    interpreter = parts[1] if parts[0].endswith("env") and len(parts) > 1 else parts[0]
    path = Path(interpreter)
    return path if path.is_absolute() else None


def _imports_hermes(python: Path) -> bool:
    try:
        proc = subprocess.run(
            [str(python), "-c", "import hermes_cli"],
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


def find_cli(home: Path, python: Optional[Path] = None) -> Optional[Path]:
    candidates = [
        home / "hermes-agent" / "venv" / "bin" / "hermes",
        Path.home() / ".local" / "bin" / "hermes",
        Path("/usr/local/bin/hermes"),
    ]
    if python is not None:
        # In a venv install the console script sits beside the interpreter.
        candidates.insert(0, python.parent / "hermes")
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    found = shutil.which("hermes")
    return Path(found) if found else None


# ---------------------------------------------------------------------------
# Reading the live configuration
# ---------------------------------------------------------------------------

# Loads ~/.hermes/.env exactly the way Hermes does (including external secret
# sources), then asks Hermes' own resolver what it will do. Only the *name* of
# the env var holding the resolved key crosses back out of the subprocess.
_PROBE = r"""
import json, os, sys

result = {"ok": False}
try:
    from hermes_cli.env_loader import load_hermes_dotenv
    load_hermes_dotenv()
except Exception as exc:  # pragma: no cover - depends on local install
    result["env_error"] = "%s: %s" % (type(exc).__name__, exc)

env_names = sorted(
    name for name, value in os.environ.items()
    if (name.endswith(("_API_KEY", "_TOKEN", "_KEY")) or name.endswith("_BASE_URL"))
    and str(value).strip()
)
result["env_names"] = env_names

try:
    from hermes_cli.config import load_config
    result["config"] = load_config() or {}
except Exception as exc:
    result["config_error"] = "%s: %s" % (type(exc).__name__, exc)
    result["config"] = {}

try:
    import yaml
    from hermes_constants import get_hermes_home
    raw_path = os.path.join(str(get_hermes_home()), "config.yaml")
    with open(raw_path, "r", encoding="utf-8") as handle:
        result["user_config"] = yaml.safe_load(handle) or {}
except Exception:
    result["user_config"] = {}

try:
    from hermes_cli.runtime_provider import (
        resolve_requested_provider,
        resolve_runtime_provider,
    )
    requested = resolve_requested_provider()
    runtime = resolve_runtime_provider()
    key = runtime.get("api_key") or ""
    key_env = ""
    for name, value in os.environ.items():
        if value and key and value.strip() == key.strip():
            key_env = name
            break
    result["resolution"] = {
        "requested": requested,
        "provider": runtime.get("provider"),
        "base_url": runtime.get("base_url"),
        "source": runtime.get("source"),
        "api_mode": runtime.get("api_mode"),
        "key_env": key_env,
        "key_present": bool(key),
    }
    result["ok"] = True
except Exception as exc:
    result["resolve_error"] = "%s: %s" % (type(exc).__name__, exc)

try:
    from hermes_cli.auth import PROVIDER_REGISTRY
    result["registry"] = list(PROVIDER_REGISTRY.keys())
except Exception:
    result["registry"] = []

json.dump(result, sys.stdout)
"""


def probe(python: Path, home: Path) -> Dict[str, Any]:
    """Run the diagnostic probe inside the Hermes interpreter."""
    env = dict(os.environ)
    env["HERMES_HOME"] = str(home)
    try:
        proc = subprocess.run(
            [str(python), "-c", _PROBE],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "probe_error": str(exc)}
    if proc.returncode != 0:
        return {
            "ok": False,
            "probe_error": (proc.stderr or "").strip()[-2000:] or "probe exited non-zero",
        }
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "probe_error": (proc.stdout or "")[-2000:]}


def load_setup() -> Setup:
    home = find_home()
    python = find_python(home)
    setup = Setup(
        home=home,
        config_path=home / "config.yaml",
        env_path=home / ".env",
        python=python,
        cli=find_cli(home, python),
    )
    if setup.python is None:
        return setup

    data = probe(setup.python, home)
    setup.config = data.get("config") or {}
    setup.user_config = data.get("user_config") or {}
    setup.env_names = tuple(data.get("env_names") or ())
    setup.resolution = data.get("resolution") or {}
    if not data.get("ok"):
        for key in ("probe_error", "resolve_error", "config_error", "env_error"):
            if data.get(key):
                setup.resolution.setdefault("error", f"{key}: {data[key]}")
                break
    return setup


# ---------------------------------------------------------------------------
# Config traversal helpers
# ---------------------------------------------------------------------------


def dig(config: Dict[str, Any], *path: str) -> Any:
    node: Any = config
    for part in path:
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def as_text(value: Any) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def is_openrouter_provider(value: Any) -> bool:
    return as_text(value) in OPENROUTER_ALIASES


def is_openrouter_url(value: Any) -> bool:
    return "openrouter.ai" in as_text(value)


def looks_like_openrouter_slug(model: Any) -> bool:
    """True for aggregator-style "vendor/model" ids.

    Direct providers want native ids (claude-sonnet-4-6, not
    anthropic/claude-sonnet-4.6). Slash-form ids that a direct provider does
    use natively -- Fireworks accounts/..., HuggingFace org/model -- belong to
    providers this tool never selects, so treating slashes as aggregator-shaped
    is safe here.
    """
    text = as_text(model)
    return "/" in text and not text.startswith("accounts/")


# ---------------------------------------------------------------------------
# Diagnosis
# ---------------------------------------------------------------------------


def diagnose(setup: Setup) -> List[Finding]:
    findings: List[Finding] = []
    config = setup.config
    resolved = as_text(setup.resolution.get("provider"))
    model_provider_raw = dig(config, "model", "provider")
    model_provider = as_text(model_provider_raw)

    findings.extend(_diagnose_main_model(setup, resolved, model_provider, model_provider_raw))
    findings.extend(_diagnose_aux(config))
    findings.extend(_diagnose_fallbacks(config))
    findings.extend(_diagnose_env(setup))
    findings.extend(_diagnose_credential_pool(setup))
    findings.extend(_diagnose_leftovers(setup.user_config, resolved))

    findings.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 9))
    return findings


def _diagnose_main_model(
    setup: Setup,
    resolved: str,
    model_provider: str,
    model_provider_raw: Any,
) -> List[Finding]:
    findings: List[Finding] = []
    key_env = setup.resolution.get("key_env") or ""

    # 'openai' is checked against the config rather than the resolved provider:
    # one Hermes code path aliases it to OpenRouter, another rejects it as an
    # unknown provider, so the resolver may raise instead of returning a value.
    if model_provider == "openai":
        findings.append(
            Finding(
                severity="blocker",
                title="model.provider is 'openai', which is not the direct OpenAI API",
                detail=(
                    "Hermes aliases the bare name 'openai' to 'openrouter' "
                    "(hermes_cli.providers.ALIASES) and its resolver rejects it outright as an "
                    "unknown provider. Either way you never reach api.openai.com. The direct "
                    "OpenAI provider is called 'openai-api'."
                ),
                remedy="Set model.provider to 'openai-api' (or another direct provider).",
                auto_fixed=True,
            )
        )
    elif resolved == "openrouter":
        if not model_provider:
            detail = (
                "config.yaml has no model.provider, so Hermes auto-detects one. "
                "Auto-detection returns OpenRouter as soon as OPENAI_API_KEY or "
                "OPENROUTER_API_KEY exists -- it checks those before the Anthropic, "
                "Gemini and xAI keys, which are never reached."
            )
        elif model_provider == "auto":
            detail = (
                "model.provider is 'auto'. Auto-detection returns OpenRouter as soon "
                "as OPENAI_API_KEY or OPENROUTER_API_KEY exists, before it looks at "
                "the Anthropic, Gemini and xAI keys."
            )
        else:
            detail = f"model.provider is {model_provider_raw!r}, which routes to OpenRouter."

        if key_env and key_env != "OPENROUTER_API_KEY":
            detail += (
                f" Hermes is currently sending {key_env} to openrouter.ai, which is why "
                "OpenRouter reports no credit on that account."
            )

        findings.append(
            Finding(
                severity="blocker",
                title="Main chat model routes through OpenRouter",
                detail=detail,
                remedy="Set model.provider to a direct provider (anthropic / openai-api / xai / gemini).",
                auto_fixed=True,
            )
        )

    base_url = dig(setup.config, "model", "base_url")
    if is_openrouter_url(base_url):
        findings.append(
            Finding(
                severity="blocker",
                title="model.base_url points at openrouter.ai",
                detail=f"model.base_url = {base_url!r} forces the aggregator regardless of model.provider.",
                remedy="Remove model.base_url so the direct provider's own endpoint is used.",
                config_unset=("model.base_url",),
            )
        )

    model_id = dig(setup.config, "model", "default") or dig(setup.config, "model", "model")
    if model_id and looks_like_openrouter_slug(model_id) and resolved in DIRECT_PROVIDERS:
        findings.append(
            Finding(
                severity="warning",
                title="Model id is in OpenRouter slug form",
                detail=(
                    f"model.default = {model_id!r} is an aggregator-style id, but the provider "
                    f"is {resolved!r}, which expects a native id."
                ),
                remedy="Rewrite the model id to its native form for the direct provider.",
                auto_fixed=True,
            )
        )

    if setup.resolution.get("error"):
        findings.append(
            Finding(
                severity="warning",
                title="Hermes could not resolve a provider at all",
                detail=str(setup.resolution["error"]),
                remedy="Fix the reported error, then re-run this tool.",
                # When a config blocker is already listed, that blocker *is* the
                # cause of the failure, so applying the fix clears this too.
                auto_fixed=any(f.severity == "blocker" for f in findings),
            )
        )

    return findings


def _diagnose_aux(config: Dict[str, Any]) -> List[Finding]:
    """Auxiliary slots pinned to OpenRouter keep billing it after the main model moves."""
    findings: List[Finding] = []
    aux = config.get("auxiliary")
    if not isinstance(aux, dict):
        return findings

    for task in AUX_TASKS:
        block = aux.get(task)
        if not isinstance(block, dict):
            continue

        if is_openrouter_provider(block.get("provider")):
            # An aggregator-shaped model id is only meaningful to the
            # aggregator. Clearing it along with the provider returns the slot
            # to "empty model = use the main chat model"; leaving it behind
            # would send e.g. google/gemini-2.5-flash to Anthropic.
            unset = [f"auxiliary.{task}.provider"]
            aux_model = block.get("model")
            detail = (
                f"auxiliary.{task}.provider = {block.get('provider')!r}. This slot keeps "
                "calling OpenRouter even once the main chat model is direct."
            )
            if looks_like_openrouter_slug(aux_model):
                unset.append(f"auxiliary.{task}.model")
                detail += (
                    f" Its model id ({aux_model!r}) is aggregator-shaped and has to go with it."
                )

            findings.append(
                Finding(
                    severity="blocker",
                    title=f"Auxiliary task '{task}' is pinned to OpenRouter",
                    detail=detail,
                    remedy=(
                        f"Clear auxiliary.{task}.* so the slot follows your main model."
                    ),
                    config_unset=tuple(unset),
                )
            )

        if is_openrouter_url(block.get("base_url")):
            findings.append(
                Finding(
                    severity="blocker",
                    title=f"Auxiliary task '{task}' has an OpenRouter base_url",
                    detail=(
                        f"auxiliary.{task}.base_url = {block.get('base_url')!r}. A base_url "
                        "overrides the provider setting entirely."
                    ),
                    remedy=f"Unset auxiliary.{task}.base_url.",
                    config_unset=(f"auxiliary.{task}.base_url",),
                )
            )

        chain_finding = _chain_finding(
            block.get("fallback_chain"),
            key=f"auxiliary.{task}.fallback_chain",
            title=f"Auxiliary '{task}' falls back to OpenRouter",
        )
        if chain_finding is not None:
            findings.append(chain_finding)

    return findings


def _targets_openrouter(entry: Any) -> bool:
    return isinstance(entry, dict) and (
        is_openrouter_provider(entry.get("provider")) or is_openrouter_url(entry.get("base_url"))
    )


def _chain_finding(chain: Any, key: str, title: str) -> Optional[Finding]:
    """Describe a provider chain that routes to OpenRouter.

    A chain made up entirely of OpenRouter entries can be removed wholesale. A
    mixed chain has to be edited by hand, because dropping it would discard the
    non-OpenRouter entries too.
    """
    if not isinstance(chain, list) or not chain:
        return None

    hits = [index for index, entry in enumerate(chain) if _targets_openrouter(entry)]
    if not hits:
        return None

    positions = ", ".join(f"[{index}]" for index in hits)
    if len(hits) == len(chain):
        return Finding(
            severity="warning",
            title=title,
            detail=(
                f"Every entry in {key} targets OpenRouter ({positions}), so any transient error "
                "on the primary provider lands back on the aggregator."
            ),
            remedy=f"Remove {key} entirely, then rebuild it from direct providers with `hermes fallback`.",
            config_unset=(key,),
        )

    return Finding(
        severity="warning",
        title=title,
        detail=f"{key} mixes OpenRouter entries ({positions}) with other providers.",
        remedy=(
            f"Edit {key} in config.yaml and drop the OpenRouter entries -- removing the whole "
            "list would discard the good ones too."
        ),
    )


def _diagnose_fallbacks(config: Dict[str, Any]) -> List[Finding]:
    findings: List[Finding] = []

    chain_finding = _chain_finding(
        config.get("fallback_providers"),
        key="fallback_providers",
        title="Primary fallback chain routes to OpenRouter",
    )
    if chain_finding is not None:
        findings.append(chain_finding)

    legacy = config.get("fallback_model")
    if _targets_openrouter(legacy):
        findings.append(
            Finding(
                severity="warning",
                title="Legacy fallback_model targets OpenRouter",
                detail=f"fallback_model.provider = {legacy.get('provider')!r}.",
                remedy=(
                    "Remove fallback_model, then add direct-provider fallbacks with `hermes fallback`."
                ),
                config_unset=("fallback_model",),
            )
        )

    if is_openrouter_provider(dig(config, "delegation", "provider")):
        findings.append(
            Finding(
                severity="blocker",
                title="Subagent delegation is pinned to OpenRouter",
                detail="delegation.provider routes delegate_task subagents through OpenRouter.",
                remedy="Unset delegation.provider so subagents inherit the parent agent.",
                config_unset=("delegation.provider",),
            )
        )

    return findings


def _diagnose_env(setup: Setup) -> List[Finding]:
    findings: List[Finding] = []
    names = set(setup.env_names)
    model_provider = as_text(dig(setup.config, "model", "provider"))

    if "OPENROUTER_API_KEY" in names and model_provider in ("", "auto"):
        findings.append(
            Finding(
                severity="warning",
                title="OPENROUTER_API_KEY currently wins the provider auto-detect",
                detail=(
                    "With no explicit model.provider, the presence of OPENROUTER_API_KEY in "
                    "~/.hermes/.env is itself enough to select OpenRouter."
                ),
                remedy=(
                    "Keep the key. Setting model.provider explicitly (--apply does this) makes it "
                    "inert -- it stops winning auto-detect but stays available for `hermes model` "
                    "or `/model openrouter:...` whenever you want it. Nothing needs deleting."
                ),
                auto_fixed=True,
            )
        )

    if "OPENAI_BASE_URL" in names:
        findings.append(
            Finding(
                severity="warning",
                title="OPENAI_BASE_URL is set in the environment",
                detail=(
                    "Hermes honours OPENAI_BASE_URL for the openai-api provider. If it points at "
                    "an aggregator, direct OpenAI calls still leave through that aggregator."
                ),
                remedy="Check its value in ~/.hermes/.env; remove it unless you deliberately proxy OpenAI.",
            )
        )

    if "OPENROUTER_BASE_URL" in names:
        findings.append(
            Finding(
                severity="note",
                title="OPENROUTER_BASE_URL is set in the environment",
                detail="Only affects OpenRouter traffic; harmless once nothing routes there.",
                remedy="No action needed.",
            )
        )

    return findings


def _diagnose_credential_pool(setup: Setup) -> List[Finding]:
    """An OpenRouter entry in auth.json also wins during auto-detection."""
    auth_path = setup.home / "auth.json"
    if not auth_path.is_file():
        return []
    try:
        data = json.loads(auth_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    providers = data.get("providers") if isinstance(data, dict) else None
    has_openrouter = isinstance(providers, dict) and "openrouter" in providers
    active = as_text(data.get("active_provider")) if isinstance(data, dict) else ""

    findings: List[Finding] = []
    model_provider = as_text(dig(setup.config, "model", "provider"))

    if has_openrouter and model_provider in ("", "auto"):
        findings.append(
            Finding(
                severity="warning",
                title="An OpenRouter credential is stored in auth.json",
                detail=(
                    "Auto-detection selects OpenRouter when its credential pool is populated, "
                    "even with no OPENROUTER_API_KEY in the environment."
                ),
                remedy=(
                    "Setting model.provider explicitly (--apply does this) takes precedence. "
                    "To drop the credential entirely: hermes auth remove openrouter"
                ),
            )
        )

    if active in OPENROUTER_ALIASES:
        findings.append(
            Finding(
                severity="note",
                title="auth.json active_provider is OpenRouter",
                detail="Only consulted as a last resort, after an explicit model.provider.",
                remedy="No action needed once model.provider is set.",
            )
        )

    return findings


def _diagnose_leftovers(user_config: Dict[str, Any], resolved: str) -> List[Finding]:
    """OpenRouter-only tuning blocks the user left behind after a migration."""
    if resolved == "openrouter":
        return []

    leftovers = [key for key in ("provider_routing", "openrouter") if key in user_config]
    if not leftovers:
        return []

    return [
        Finding(
            severity="note",
            title="OpenRouter-only settings remain in config.yaml",
            detail=(
                f"{', '.join(leftovers)} only affect OpenRouter traffic and are inert now, "
                "but they make the config look like it still targets the aggregator."
            ),
            remedy="Optional cleanup: " + ", ".join(f"hermes config unset {k}" for k in leftovers),
        )
    ]


# ---------------------------------------------------------------------------
# Live credential verification
# ---------------------------------------------------------------------------


def read_env_file(path: Path) -> Dict[str, str]:
    """Minimal .env reader used only to obtain key values for live probes."""
    values: Dict[str, str] = {}
    if not path.is_file():
        return values
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return values
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        if name.startswith("export "):
            name = name[len("export "):].strip()
        value = value.strip().strip('"').strip("'")
        if name and value:
            values[name] = value
    return values


def collect_keys(setup: Setup) -> Dict[str, str]:
    """Key values for probing: process environment first, then ~/.hermes/.env."""
    keys = read_env_file(setup.env_path)
    for name, value in os.environ.items():
        if value.strip():
            keys.setdefault(name, value.strip())
    return keys


def _request(url: str, headers: Dict[str, str], timeout: float) -> Tuple[int, str]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, ""
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read(600).decode("utf-8", "replace")
        except Exception:  # pragma: no cover - best effort only
            pass
        return exc.code, body
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)
    except Exception as exc:  # pragma: no cover - defensive
        return 0, str(exc)


def probe_provider(provider: str, key: str, timeout: float) -> Tuple[str, str]:
    """Cheap authenticated read against the provider's own model catalogue."""
    if provider == "anthropic":
        status, body = _request(
            "https://api.anthropic.com/v1/models?limit=1",
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
            timeout,
        )
    elif provider == "openai-api":
        status, body = _request(
            "https://api.openai.com/v1/models",
            {"Authorization": f"Bearer {key}"},
            timeout,
        )
    elif provider == "xai":
        status, body = _request(
            "https://api.x.ai/v1/models",
            {"Authorization": f"Bearer {key}"},
            timeout,
        )
    elif provider == "gemini":
        # Gemini takes the key as a query parameter; pass it as a header instead
        # so it cannot leak into proxy or error logs.
        status, body = _request(
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
            {"x-goog-api-key": key},
            timeout,
        )
    else:
        return "unchecked", "no probe defined"

    if 200 <= status < 300:
        return "ok", ""
    if status in (401, 403):
        return "unauthorized", f"HTTP {status}"
    if status in (402, 429):
        return "no_credit", f"HTTP {status}"
    # xAI and Gemini answer a bad key with 400 plus an explicit message rather
    # than 401, so the body is the only reliable signal.
    if status == 400 and _mentions_bad_key(body):
        return "unauthorized", f"HTTP {status}"
    if status == 0:
        return "error", body or "connection failed"
    return "error", f"HTTP {status}"


def _mentions_bad_key(body: str) -> bool:
    lowered = (body or "").lower()
    return any(
        marker in lowered
        for marker in (
            "api key not valid",
            "api_key_invalid",
            "incorrect api key",
            "invalid api key",
            "invalid_api_key",
            "api key expired",
        )
    )


def verify_keys(setup: Setup, timeout: float, live: bool) -> Dict[str, KeyStatus]:
    keys = collect_keys(setup)
    statuses: Dict[str, KeyStatus] = {}

    for provider in DIRECT_PROVIDERS:
        status = KeyStatus(provider=provider)
        for env_var in PROVIDER_KEY_VARS[provider]:
            if keys.get(env_var):
                status.env_var = env_var
                break
        if status.env_var is None:
            statuses[provider] = status
            continue
        if not live:
            status.state = "unchecked"
            statuses[provider] = status
            continue
        state, note = probe_provider(provider, keys[status.env_var], timeout)
        status.state = state
        status.note = note
        statuses[provider] = status

    return statuses


# ---------------------------------------------------------------------------
# Applying the fix
# ---------------------------------------------------------------------------


def choose_provider(
    statuses: Dict[str, KeyStatus],
    requested: Optional[str],
) -> Tuple[Optional[str], str]:
    """Pick the primary provider: explicit request, else best verified key."""
    if requested:
        normalized = requested.strip().lower()
        if normalized == "openai":
            return None, (
                "'openai' is an alias for OpenRouter in Hermes. Use 'openai-api' for the "
                "direct OpenAI API."
            )
        if normalized not in DIRECT_PROVIDERS:
            return None, (
                f"{requested!r} is not one of the direct providers this tool manages "
                f"({', '.join(DIRECT_PROVIDERS)})."
            )
        status = statuses.get(normalized)
        if status and not status.present:
            return None, f"No API key found for {normalized!r} in {', '.join(PROVIDER_KEY_VARS[normalized])}."
        return normalized, ""

    for provider in DIRECT_PROVIDERS:
        if statuses.get(provider, KeyStatus(provider)).usable:
            return provider, ""
    for provider in DIRECT_PROVIDERS:
        status = statuses.get(provider, KeyStatus(provider))
        if status.present and status.state == "unchecked":
            return provider, ""
    return None, (
        "No usable direct provider key found. Add one to ~/.hermes/.env "
        "(ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY or GEMINI_API_KEY)."
    )


def native_model_id(setup: Setup, provider: str, current: Any) -> Optional[str]:
    """Translate the configured model id for `provider` using Hermes' own helpers.

    Returns None when the current id already suits the provider and needs no change.
    """
    if setup.python is None:
        return None

    snippet = textwrap.dedent(
        """
        import json, sys
        provider, current = sys.argv[1], sys.argv[2]
        out = {}
        try:
            from hermes_cli.models import get_default_model_for_provider
            out["default"] = get_default_model_for_provider(provider) or ""
        except Exception:
            out["default"] = ""
        try:
            from hermes_cli.model_normalize import normalize_model_for_provider, detect_vendor
            out["normalized"] = normalize_model_for_provider(current, provider) if current else ""
            out["vendor"] = detect_vendor(current) or "" if current else ""
        except Exception:
            out["normalized"] = ""
            out["vendor"] = ""
        json.dump(out, sys.stdout)
        """
    )
    env = dict(os.environ)
    env["HERMES_HOME"] = str(setup.home)
    try:
        proc = subprocess.run(
            [str(setup.python), "-c", snippet, provider, str(current or "")],
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
        data = json.loads(proc.stdout) if proc.returncode == 0 else {}
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None

    current_text = str(current or "").strip()
    vendor = as_text(data.get("vendor"))
    normalized = str(data.get("normalized") or "").strip()
    fallback = str(data.get("default") or "").strip()

    if not current_text:
        return fallback or None

    # A model id naming a different vendor cannot be normalized into this
    # provider's catalogue, so use the provider's own default instead.
    if VENDOR_TO_PROVIDER.get(vendor, vendor) != provider:
        return fallback or None

    return normalized if normalized and normalized != current_text else None


def run_config(setup: Setup, args: Sequence[str], dry_run: bool) -> bool:
    """Invoke `hermes config ...`, the sanctioned (YAML-safe) write path."""
    if setup.cli is None:
        print(f"    ! hermes CLI not found; run manually: hermes config {' '.join(args)}")
        return False
    printable = f"hermes config {' '.join(args)}"
    if dry_run:
        print(f"    would run: {printable}")
        return True

    env = dict(os.environ)
    env["HERMES_HOME"] = str(setup.home)
    try:
        proc = subprocess.run(
            [str(setup.cli), "config", *args],
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"    ! failed: {printable} ({exc})")
        return False
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        print(f"    ! failed: {printable} -- {detail[-1] if detail else 'non-zero exit'}")
        return False
    print(f"    ran: {printable}")
    return True


def backup_config(setup: Setup, dry_run: bool) -> Optional[Path]:
    if not setup.config_path.is_file():
        return None
    target = setup.config_path.with_suffix(
        f".yaml.bak-provider-fix-{time.strftime('%Y%m%d-%H%M%S')}"
    )
    if dry_run:
        print(f"    would back up {setup.config_path} -> {target.name}")
        return target
    shutil.copy2(setup.config_path, target)
    print(f"    backed up {setup.config_path} -> {target.name}")
    return target


def apply_fix(
    setup: Setup,
    findings: Sequence[Finding],
    statuses: Dict[str, KeyStatus],
    primary: str,
    dry_run: bool,
) -> None:
    heading = "PLANNED CHANGES (dry run)" if dry_run else "APPLYING CHANGES"
    print(heading)
    print("-" * len(heading))

    backup_config(setup, dry_run)

    current_model = dig(setup.config, "model", "default") or dig(setup.config, "model", "model")
    run_config(setup, ["set", "model.provider", primary], dry_run)

    replacement = native_model_id(setup, primary, current_model)
    if replacement:
        print(f"    model id: {current_model!r} -> {replacement!r} (native for {primary})")
        run_config(setup, ["set", "model.default", replacement], dry_run)
    else:
        print(f"    model id: keeping {current_model!r}")

    # Everything the diagnosis found that a single `config unset` can clear.
    for key in sorted({key for finding in findings for key in finding.config_unset}):
        run_config(setup, ["unset", key], dry_run)
    print()

    spares = [
        PROVIDER_LABELS[provider]
        for provider in DIRECT_PROVIDERS
        if provider != primary and statuses.get(provider, KeyStatus(provider)).usable
    ]
    if spares:
        print("Suggested next step -- add your other working keys as fallbacks:")
        print(f"  hermes fallback        ({', '.join(spares)} are available)")
        print()

    manual = [finding for finding in findings if finding.needs_manual_edit]
    if manual:
        print("Not changed automatically -- needs your judgement:")
        for finding in manual:
            print(f"  - {finding.title}")
            print(wrap(finding.remedy, indent="    "))
        print()

    if dry_run:
        print("Nothing was written. Re-run with --apply to make these changes.")
        print()
        return

    _report_post_apply(setup)
    print("Done. Cross-check with `hermes doctor`, then start a session with `hermes`.")
    print()


def _report_post_apply(setup: Setup) -> None:
    """Ask Hermes to resolve a provider again, so the result is verified not assumed."""
    if setup.python is None:
        return
    data = probe(setup.python, setup.home)
    resolution = data.get("resolution") or {}
    print("VERIFIED AFTER WRITING")
    print("----------------------")
    if not resolution or data.get("resolve_error"):
        print(f"  Hermes still cannot resolve a provider: {data.get('resolve_error', 'unknown error')}")
        print()
        return

    provider = resolution.get("provider") or "?"
    print(f"  provider    {provider}")
    print(f"  endpoint    {resolution.get('base_url') or '?'}")
    print(f"  credential  {resolution.get('key_env') or '(none matched a known env var)'}")
    if as_text(provider) == "openrouter":
        print("  Still on OpenRouter -- re-run this tool to see what is holding it there.")
    print()


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def wrap(text: str, indent: str = "      ") -> str:
    return textwrap.fill(
        text, width=96, initial_indent=indent, subsequent_indent=indent
    )


def report_setup(setup: Setup) -> None:
    print("HERMES INSTALLATION")
    print("-------------------")
    print(f"  home        {setup.home}")
    print(f"  config      {setup.config_path}{'' if setup.config_path.is_file() else '  (missing)'}")
    print(f"  env file    {setup.env_path}{'' if setup.env_path.is_file() else '  (missing)'}")
    print(f"  python      {setup.python or 'not found'}")
    print(f"  hermes CLI  {setup.cli or 'not found'}")
    print()


def report_resolution(setup: Setup) -> None:
    resolution = setup.resolution
    print("WHAT HERMES DOES RIGHT NOW")
    print("--------------------------")
    if not resolution:
        print("  Could not ask Hermes to resolve a provider.")
        print()
        return

    if resolution.get("error"):
        print(f"  error       {resolution['error']}")
        print()
        return

    provider = resolution.get("provider") or "?"
    print(f"  requested   {resolution.get('requested') or '(unset -> auto)'}")
    print(f"  provider    {provider}")
    print(f"  endpoint    {resolution.get('base_url') or '?'}")
    print(f"  api mode    {resolution.get('api_mode') or '?'}")
    print(f"  credential  {resolution.get('key_env') or '(none matched a known env var)'}")
    print(f"  source      {resolution.get('source') or '?'}")

    key_env = resolution.get("key_env") or ""
    if as_text(provider) == "openrouter" and key_env and key_env != "OPENROUTER_API_KEY":
        print()
        print(wrap(
            f"Note: {key_env} is being sent to openrouter.ai. That key is not an OpenRouter "
            "credential, so OpenRouter has no balance to draw on for it.",
            indent="  ",
        ))
    print()


def report_keys(statuses: Dict[str, KeyStatus], live: bool) -> None:
    print("DIRECT PROVIDER CREDENTIALS")
    print("---------------------------")
    labels = {
        "ok": "works",
        "unauthorized": "REJECTED (bad or revoked key)",
        "no_credit": "no credit / rate limited",
        "error": "could not check",
        "unchecked": "present (not checked -- pass --verify)",
        "absent": "no key found",
    }
    for provider in DIRECT_PROVIDERS:
        status = statuses.get(provider, KeyStatus(provider))
        label = labels.get(status.state, status.state)
        note = f" [{status.note}]" if status.note else ""
        source = f" via {status.env_var}" if status.env_var else ""
        print(f"  {PROVIDER_LABELS[provider]:22} {label}{source}{note}")
    if not live:
        print()
        print("  Add --verify to check each key against its provider's API.")
    print()


def report_findings(findings: Sequence[Finding]) -> None:
    print("FINDINGS")
    print("--------")
    if not findings:
        print("  Nothing routes through OpenRouter. Setup looks clean.")
        print()
        return

    for finding in findings:
        print(f"  {SEVERITY_MARK.get(finding.severity, '[?]')} {finding.title}")
        print(wrap(finding.detail))
        print(wrap(f"Fix: {finding.remedy}"))
        print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hermes_provider_fix.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Diagnose and fix Hermes Agent routing through OpenRouter when direct "
            "Anthropic / OpenAI / xAI / Gemini keys are already configured."
        ),
        epilog=textwrap.dedent(
            """
            examples:
              %(prog)s                             diagnose only (default, read-only)
              %(prog)s --verify                    also check each key against its provider
              %(prog)s --verify --apply            check, then repoint Hermes at a direct provider
              %(prog)s --apply --provider gemini   force a specific direct provider
            """
        ),
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="make a live authenticated request per provider to see which keys work",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the fix (default is a dry run that only prints the plan)",
    )
    parser.add_argument(
        "--provider",
        metavar="NAME",
        help=f"primary provider to switch to ({', '.join(DIRECT_PROVIDERS)})",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        metavar="SECONDS",
        help="per-request timeout for --verify probes (default: 15)",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    print()
    print("Hermes provider routing check")
    print("=" * 96)
    print()

    setup = load_setup()
    report_setup(setup)

    if setup.python is None:
        # __file__ is absent or "<stdin>" when piped straight into python.
        script = globals().get("__file__") or ""
        name = Path(script).name if script and script != "<stdin>" else "hermes_provider_fix.py"
        print("Could not find a Python interpreter that can import hermes_cli.")
        print("Run this script with the Hermes interpreter, e.g.:")
        print(f"  {setup.home}/hermes-agent/venv/bin/python {name}")
        return 2

    report_resolution(setup)

    statuses = verify_keys(setup, args.timeout, live=args.verify)
    report_keys(statuses, live=args.verify)

    findings = diagnose(setup)
    report_findings(findings)

    blockers = [f for f in findings if f.severity == "blocker"]
    if not blockers and not args.apply and not args.provider:
        return 0

    primary, error = choose_provider(statuses, args.provider)
    if primary is None:
        print(f"Cannot pick a provider: {error}")
        print()
        return 2

    chosen = statuses.get(primary, KeyStatus(primary))
    if chosen.state not in ("ok", "unchecked"):
        print(
            f"Warning: the {PROVIDER_LABELS[primary]} key did not pass verification "
            f"({chosen.state}). Continuing because it was requested explicitly."
        )
        print()

    apply_fix(setup, findings, statuses, primary, dry_run=not args.apply)
    return 1 if blockers and not args.apply else 0


if __name__ == "__main__":
    raise SystemExit(main())
