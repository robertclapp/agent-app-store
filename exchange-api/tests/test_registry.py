"""
Tests for tool registry loading.

The registry failing to load is a silent, high-impact failure: is_known_tool()
starts returning False for everything, so POST /signals 422s on every valid
tool and the leaderboard renders empty. `/health` must then fail closed. These
tests pin down both that it loads and that the fallback is reachable on demand.
"""

import importlib
import json
from pathlib import Path

import pytest

import app.registry as registry_mod


def _reload_with_env(monkeypatch, value):
    """Re-import the registry module under a given REGISTRY_PATH."""
    if value is None:
        monkeypatch.delenv("REGISTRY_PATH", raising=False)
    else:
        monkeypatch.setenv("REGISTRY_PATH", str(value))
    return importlib.reload(registry_mod)


@pytest.fixture(autouse=True)
def _restore_registry_module():
    """Reload with the ambient env after each test so module state is clean."""
    yield
    importlib.reload(registry_mod)


def test_registry_loads_non_empty():
    """The repo-layout fallback must find registry.json and parse tools."""
    mod = importlib.reload(registry_mod)
    assert len(mod.KNOWN_TOOL_IDS) > 0, (
        "Registry loaded empty. is_known_tool() would reject every tool ID."
    )
    assert len(mod.TOOL_METADATA) == len(mod.KNOWN_TOOL_IDS)


def test_registry_matches_registry_json(monkeypatch):
    """Loaded IDs should match registry.json exactly — it is the source of truth."""
    mod = importlib.reload(registry_mod)
    with open(mod._registry_path()) as f:
        expected = {t["id"] for t in json.load(f)["tools"]}
    assert mod.KNOWN_TOOL_IDS == expected


def test_public_registry_copy_matches_canonical_source():
    root = Path(__file__).resolve().parents[2]
    assert (root / ".well-known/agent-tools.json").read_bytes() == (
        root / "registry.json"
    ).read_bytes()


def test_is_known_tool_accepts_real_id():
    mod = importlib.reload(registry_mod)
    known = next(iter(mod.KNOWN_TOOL_IDS))
    assert mod.is_known_tool(known) is True


def test_is_known_tool_rejects_unknown_id():
    mod = importlib.reload(registry_mod)
    assert mod.is_known_tool("definitely-not-a-real-tool-id") is False


def test_registry_path_env_override(monkeypatch, tmp_path):
    """REGISTRY_PATH should win over the repo-layout fallback."""
    custom = tmp_path / "custom-registry.json"
    custom.write_text(json.dumps({
        "tools": [{"id": "only-tool", "name": "Only Tool", "category": "test"}]
    }))

    mod = _reload_with_env(monkeypatch, custom)
    assert mod.KNOWN_TOOL_IDS == {"only-tool"}
    assert mod.TOOL_METADATA["only-tool"] == ("Only Tool", "test")


def test_missing_registry_falls_back_empty_and_warns(monkeypatch, tmp_path, caplog):
    """
    A missing file must degrade to an empty registry *and* log a warning.

    This is the Docker failure mode: the image built from ./exchange-api had no
    registry.json in scope, so the container silently served an empty registry.
    """
    missing = tmp_path / "does-not-exist.json"
    with caplog.at_level("WARNING"):
        mod = _reload_with_env(monkeypatch, missing)

    assert mod.KNOWN_TOOL_IDS == set()
    assert mod.TOOL_METADATA == {}
    assert any("registry" in r.message.lower() for r in caplog.records), (
        "Empty-registry fallback must warn; otherwise the failure is invisible."
    )


def test_malformed_registry_falls_back_empty(monkeypatch, tmp_path):
    """Invalid JSON should degrade the same way rather than crash at import."""
    bad = tmp_path / "bad.json"
    bad.write_text("{not valid json")

    mod = _reload_with_env(monkeypatch, bad)
    assert mod.KNOWN_TOOL_IDS == set()


@pytest.mark.parametrize("payload", [[], {"tools": None}, {"tools": [{"id": "x"}]}, {
    "tools": [{"id": " ", "name": "Blank", "category": "test"}],
}, {
    "tools": [
        {"id": "x", "name": "X", "category": "test"},
        {"id": "x", "name": "Duplicate", "category": "test"},
    ]
}])
def test_structurally_invalid_registry_falls_back_empty(
    monkeypatch, tmp_path, payload
):
    bad = tmp_path / "bad-shape.json"
    bad.write_text(json.dumps(payload))

    mod = _reload_with_env(monkeypatch, bad)
    assert mod.KNOWN_TOOL_IDS == set()


@pytest.mark.asyncio
async def test_health_reports_tools_known(client):
    """/health must expose the registry count so deploys can detect an empty one."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert "tools_known" in body
    assert body["tools_known"] > 0
