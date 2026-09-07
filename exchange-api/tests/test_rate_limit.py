"""Tests for durable public-write abuse controls."""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_write_rate_limit_is_shared_across_public_write_routes(
    client, monkeypatch
):
    monkeypatch.setenv("WRITE_RATE_LIMIT_PER_MINUTE", "2")

    first = await client.post("/api/v1/signals", json={
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {"success": True},
        "agent_id": "limited-agent",
    })
    second = await client.post("/api/v1/workflows", json={
        "name": "Limited workflow",
        "goal": "rate-limit-test",
        "steps": [{"tool": "github-mcp", "action": "read"}],
        "agent_id": "limited-agent",
    })
    blocked = await client.post("/api/v1/signals", json={
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {"success": True},
        "agent_id": "limited-agent",
    })

    assert first.status_code == second.status_code == 200
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


@pytest.mark.asyncio
async def test_rotating_agent_ids_does_not_bypass_ip_limit(client, monkeypatch):
    monkeypatch.setenv("WRITE_RATE_LIMIT_PER_MINUTE", "1")
    payload = {
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {"success": True},
    }

    first = await client.post(
        "/api/v1/signals",
        json={**payload, "agent_id": "agent-one"},
        headers={"Origin": "http://localhost:3000"},
    )
    blocked = await client.post(
        "/api/v1/signals",
        json={**payload, "agent_id": "agent-two"},
        headers={"Origin": "http://localhost:3000"},
    )

    assert first.status_code == 200
    assert blocked.status_code == 429
    assert blocked.headers["access-control-allow-origin"] == "http://localhost:3000"


@pytest.mark.asyncio
async def test_same_agent_cannot_bypass_limit_by_rotating_ips(client, monkeypatch):
    from app.main import app

    monkeypatch.setenv("WRITE_RATE_LIMIT_PER_MINUTE", "1")
    payload = {
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {"success": True},
        "agent_id": "same-agent",
    }
    first_transport = ASGITransport(app=app, client=("192.0.2.1", 1234))
    second_transport = ASGITransport(app=app, client=("192.0.2.2", 1234))
    async with AsyncClient(transport=first_transport, base_url="http://test") as first_client:
        first = await first_client.post("/api/v1/signals", json=payload)
    async with AsyncClient(transport=second_transport, base_url="http://test") as second_client:
        blocked = await second_client.post("/api/v1/signals", json=payload)

    assert first.status_code == 200
    assert blocked.status_code == 429


@pytest.mark.asyncio
async def test_ip_limit_runs_before_body_validation(client, monkeypatch):
    monkeypatch.setenv("WRITE_RATE_LIMIT_PER_MINUTE", "1")

    invalid = await client.post(
        "/api/v1/signals",
        content=b"not-json",
        headers={"content-type": "application/json"},
    )
    blocked = await client.post("/api/v1/signals", json={
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {"success": True},
    })

    assert invalid.status_code == 422
    assert blocked.status_code == 429
