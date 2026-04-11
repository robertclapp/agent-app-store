"""
Tests for the /api/v1/tools/{tool_id}/stats endpoint.
Verifies aggregate statistics computation from community signals.
"""

import pytest


@pytest.mark.asyncio
async def test_tool_stats_no_signals(client):
    """GET /tools/{id}/stats with no data should return zeroed stats."""
    resp = await client.get("/api/v1/tools/github-mcp/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tool_id"] == "github-mcp"
    assert body["total_signals"] == 0
    assert body["success_rate"] == 0.0
    assert body["reliability_score"] == 0.0
    assert body["top_tasks"] == []
    assert body["common_partners"] == []


@pytest.mark.asyncio
async def test_tool_stats_with_signals(client, sample_signal):
    """GET /tools/{id}/stats should aggregate signals correctly."""
    # Submit multiple signals
    for i in range(5):
        sig = {**sample_signal, "context": {
            "task": "create-issue",
            "success": i < 4,  # 4 successes, 1 failure
            "latency_ms": 200 + i * 100,
        }}
        await client.post("/api/v1/signals", json=sig)

    resp = await client.get("/api/v1/tools/github-mcp/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_signals"] == 5
    assert body["success_rate"] == 0.8  # 4/5
    assert body["error_rate"] == 0.2    # 1/5
    assert body["avg_latency_ms"] is not None
    assert body["reliability_score"] > 0
    assert "create-issue" in body["top_tasks"]


@pytest.mark.asyncio
async def test_tool_stats_reliability_score_range(client, sample_signal):
    """Reliability score should be between 0 and 100."""
    await client.post("/api/v1/signals", json=sample_signal)

    resp = await client.get("/api/v1/tools/github-mcp/stats")
    score = resp.json()["reliability_score"]
    assert 0.0 <= score <= 100.0


@pytest.mark.asyncio
async def test_tool_stats_common_partners(client, sample_signal, sample_workflow):
    """Tool stats should include common partners from workflows."""
    await client.post("/api/v1/signals", json=sample_signal)
    await client.post("/api/v1/workflows", json=sample_workflow)

    resp = await client.get("/api/v1/tools/github-mcp/stats")
    body = resp.json()
    # github-mcp is in the workflow with anthropic-api and slack-mcp
    assert len(body["common_partners"]) >= 1
