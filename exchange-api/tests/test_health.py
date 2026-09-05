"""
Tests for health check and root redirect.
"""

from pathlib import Path

import pytest
import yaml


@pytest.mark.asyncio
async def test_health_check(client):
    """GET /health should return status ok."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["database"] == "writable"


@pytest.mark.asyncio
async def test_health_fails_closed_when_database_is_readonly(client, tmp_path):
    """
    A database the process cannot write must make /health report 503.

    This is the state a botched volume migration leaves behind: the file is
    readable, connect succeeds, GET endpoints work, and every POST fails.
    Before this probe /health said "ok" throughout.
    """
    import sqlite3
    import app.db.database as db_mod

    ro_path = tmp_path / "readonly.db"
    sqlite3.connect(ro_path).close()
    original = db_mod.DATABASE_URL
    # mode=ro is enforced by SQLite itself, so this holds even when the test
    # process is root and file permission bits would not stop it.
    db_mod.DATABASE_URL = f"file:{ro_path}?mode=ro"
    try:
        resp = await client.get("/health")
    finally:
        db_mod.DATABASE_URL = original

    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "unhealthy"
    assert body["database"] == "readonly"


@pytest.mark.asyncio
async def test_health_fails_closed_when_database_cannot_be_opened(client):
    """An unopenable DATABASE_URL (missing directory) must also report 503."""
    import app.db.database as db_mod

    original = db_mod.DATABASE_URL
    db_mod.DATABASE_URL = "/nonexistent-dir-for-health-test/exchange.db"
    try:
        resp = await client.get("/health")
    finally:
        db_mod.DATABASE_URL = original

    assert resp.status_code == 503
    assert resp.json()["database"] == "readonly"


@pytest.mark.asyncio
async def test_root_redirects_to_docs(client):
    """GET / should redirect to /docs."""
    resp = await client.get("/", follow_redirects=False)
    assert resp.status_code == 307
    assert "/docs" in resp.headers.get("location", "")


@pytest.mark.asyncio
async def test_health_is_unhealthy_when_registry_is_empty(client, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "KNOWN_TOOL_IDS", set())
    resp = await client.get("/health")
    assert resp.status_code == 503
    assert resp.json() == {
        "status": "unhealthy",
        "version": "0.1.0",
        "tools_known": 0,
        "database": "writable",
    }


def test_compose_healthcheck_uses_python_runtime():
    """The slim Python image has Python and urllib, but does not install curl."""
    compose_path = Path(__file__).resolve().parents[1] / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())
    command = compose["services"]["api"]["healthcheck"]["test"]

    assert command[:2] == ["CMD", "python"]
    assert "urllib.request.urlopen" in command[3]
    assert "curl" not in " ".join(command)
