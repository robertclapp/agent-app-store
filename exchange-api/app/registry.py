"""
Centralized tool registry — single source of truth for known tools.
Loaded from the root registry.json to stay in sync with the frontend.
"""

import json
from pathlib import Path

# Resolves to the repo-root registry.json: app/ -> exchange-api/ -> repo root.
# Keep the .parent count in sync if this module ever moves.
_REGISTRY_PATH = Path(__file__).resolve().parent.parent.parent / "registry.json"

def _load_registry() -> dict:
    """Load and parse the tool registry from the shared registry.json file."""
    try:
        with open(_REGISTRY_PATH) as f:
            data = json.load(f)
        tools = data.get("tools", [])
        return {
            "tools_by_id": {t["id"]: t for t in tools},
            "tool_ids": {t["id"] for t in tools},
            "metadata": {
                t["id"]: (t["name"], t["category"]) for t in tools
            },
        }
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        # Fallback: return empty if registry.json not found (e.g. in tests)
        return {"tools_by_id": {}, "tool_ids": set(), "metadata": {}}


_REGISTRY = _load_registry()

KNOWN_TOOL_IDS: set[str] = _REGISTRY["tool_ids"]
TOOL_METADATA: dict[str, tuple[str, str]] = _REGISTRY["metadata"]


def is_known_tool(tool_id: str) -> bool:
    """Check if a tool ID exists in the registry."""
    return tool_id in KNOWN_TOOL_IDS
