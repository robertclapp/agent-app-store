"""
Centralized tool registry — single source of truth for known tools.
Loaded from the root registry.json to stay in sync with the frontend.
"""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def _default_registry_path() -> Path:
    """Repo-layout fallback: app/ -> exchange-api/ -> repo root."""
    return Path(__file__).resolve().parent.parent.parent / "registry.json"


def _registry_path() -> Path:
    """
    Resolve registry.json.

    REGISTRY_PATH takes precedence so deployments can point at the file
    explicitly. The Docker image sets it, because the container has no repo
    checkout and the repo-layout fallback would resolve to /registry.json.
    """
    env_path = os.getenv("REGISTRY_PATH")
    return Path(env_path) if env_path else _default_registry_path()


def _load_registry() -> dict:
    """Load and parse the tool registry from the shared registry.json file."""
    path = _registry_path()
    try:
        with open(path) as f:
            data = json.load(f)
        tools = data.get("tools", [])
        return {
            "tools_by_id": {t["id"]: t for t in tools},
            "tool_ids": {t["id"] for t in tools},
            "metadata": {
                t["id"]: (t["name"], t["category"]) for t in tools
            },
        }
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as exc:
        # Degrade rather than crash, but say so loudly: an empty registry makes
        # is_known_tool() reject every ID, so POST /signals 422s on all input
        # and the leaderboard renders empty. That failure is otherwise silent —
        # /health still returns ok — so this warning is the only signal.
        logger.warning(
            "Tool registry could not be loaded from %s (%s). Falling back to an "
            "empty registry: signal submission will reject every tool ID and the "
            "leaderboard will be empty. Set REGISTRY_PATH to the registry.json "
            "location if this is a packaged deployment.",
            path,
            type(exc).__name__,
        )
        return {"tools_by_id": {}, "tool_ids": set(), "metadata": {}}


_REGISTRY = _load_registry()

KNOWN_TOOL_IDS: set[str] = _REGISTRY["tool_ids"]
TOOL_METADATA: dict[str, tuple[str, str]] = _REGISTRY["metadata"]


def is_known_tool(tool_id: str) -> bool:
    """Check if a tool ID exists in the registry."""
    return tool_id in KNOWN_TOOL_IDS
