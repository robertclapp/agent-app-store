"""
Tests for health check and root redirect.
"""

import pytest


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
