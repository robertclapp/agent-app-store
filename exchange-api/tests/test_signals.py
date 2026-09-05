"""
Tests for the /api/v1/signals endpoint.
Verifies signal creation, validation, and privacy (agent_id hashing).
"""

import pytest


@pytest.mark.asyncio
async def test_create_signal_success(client, sample_signal):
    """POST /signals with valid data should return 200 and accepted=True."""
    resp = await client.post("/api/v1/signals", json=sample_signal)
    assert resp.status_code == 200
    body = resp.json()
    assert body["accepted"] is True
    assert body["tool"] == "github-mcp"
    assert body["signal"] == "reliability"
    assert "id" in body
    assert "recorded_at" in body


@pytest.mark.asyncio
async def test_create_signal_unknown_tool(client):
    """POST /signals with an unknown tool ID should return 422."""
    payload = {
        "tool": "nonexistent-tool",
        "signal": "reliability",
        "context": {"task": "test", "success": True},
    }
    resp = await client.post("/api/v1/signals", json=payload)
    assert resp.status_code == 422
    assert "Unknown tool ID" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_signal_invalid_signal_type(client):
    """POST /signals with an invalid signal type should return 422."""
    payload = {
        "tool": "github-mcp",
        "signal": "invalid-type",
        "context": {"task": "test"},
    }
    resp = await client.post("/api/v1/signals", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_signal_missing_context(client):
    """POST /signals without context should return 422."""
    payload = {
        "tool": "github-mcp",
        "signal": "reliability",
    }
    resp = await client.post("/api/v1/signals", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_signal_anonymous(client):
    """POST /signals without agent_id should still succeed (anonymous)."""
    payload = {
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {"task": "test", "success": True},
    }
    resp = await client.post("/api/v1/signals", json=payload)
    assert resp.status_code == 200
    assert resp.json()["accepted"] is True


@pytest.mark.asyncio
async def test_agent_id_is_hashed(client, sample_signal):
    """Verify that raw agent_id is never stored — only a hash."""
    resp = await client.post("/api/v1/signals", json=sample_signal)
    assert resp.status_code == 200

    # Query the database directly to verify hashing
    from app.db.database import get_db
    db = await get_db()
    async with db.execute("SELECT agent_hash FROM signals LIMIT 1") as cursor:
        row = await cursor.fetchone()

    assert row is not None
    agent_hash = row["agent_hash"]
    # Hash should be 32 hex chars (128-bit), not the raw agent_id
    assert len(agent_hash) == 32
    assert agent_hash != sample_signal["agent_id"]


@pytest.mark.asyncio
async def test_all_signal_types_accepted(client):
    """All four signal types should be accepted."""
    contexts = {
        "reliability": {"task": "test", "success": True},
        "latency": {"task": "test", "latency_ms": 12.5},
        "compatibility": {
            "task": "test",
            "partner_tool": "slack-mcp",
            "compatible": True,
        },
        "error": {"task": "test", "error": "timeout"},
    }
    for sig_type, context in contexts.items():
        payload = {
            "tool": "github-mcp",
            "signal": sig_type,
            "context": context,
        }
        resp = await client.post("/api/v1/signals", json=payload)
        assert resp.status_code == 200, f"Signal type '{sig_type}' was rejected"


@pytest.mark.asyncio
@pytest.mark.parametrize("context", [
    {"success": True, "latency_ms": "slow"},
    {"success": "yes", "latency_ms": 10},
    {"success": True, "task": ["not", "hashable"]},
    {"success": True, "latency_ms": -1},
])
async def test_reliability_context_rejects_values_that_break_aggregation(
    client, context
):
    resp = await client.post("/api/v1/signals", json={
        "tool": "github-mcp",
        "signal": "reliability",
        "context": context,
    })
    assert resp.status_code == 422

    stats = await client.get("/api/v1/tools/github-mcp/stats")
    assert stats.status_code == 200
    assert stats.json()["total_signals"] == 0


@pytest.mark.asyncio
async def test_each_signal_type_requires_its_contract(client):
    for signal_type in ["reliability", "latency", "compatibility", "error"]:
        resp = await client.post("/api/v1/signals", json={
            "tool": "github-mcp",
            "signal": signal_type,
            "context": {},
        })
        assert resp.status_code == 422, signal_type


@pytest.mark.asyncio
async def test_context_rejects_non_finite_values_even_in_extension_fields(client):
    resp = await client.post(
        "/api/v1/signals",
        content=(
            '{"tool":"github-mcp","signal":"reliability",'
            '"context":{"success":true,"extension":1e999}}'
        ),
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 422
