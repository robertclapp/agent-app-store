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


@pytest.mark.asyncio
async def test_root_redirects_to_docs(client):
    """GET / should redirect to /docs."""
    resp = await client.get("/", follow_redirects=False)
    assert resp.status_code == 307
    assert "/docs" in resp.headers.get("location", "")


def test_compose_healthcheck_uses_python_runtime():
    """The slim Python image has Python and urllib, but does not install curl."""
    compose_path = Path(__file__).resolve().parents[1] / "docker-compose.yml"
    compose = yaml.safe_load(compose_path.read_text())
    command = compose["services"]["api"]["healthcheck"]["test"]

    assert command[:2] == ["CMD", "python"]
    assert "urllib.request.urlopen" in command[3]
    assert "curl" not in " ".join(command)
