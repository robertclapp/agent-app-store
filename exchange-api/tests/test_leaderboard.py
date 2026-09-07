"""
Tests for the /api/v1/leaderboard endpoint.
Verifies tool ranking by community-reported reliability.
"""

import pytest


@pytest.mark.asyncio
async def test_leaderboard_empty(client):
    """GET /leaderboard with no signals should return entries with 0 scores."""
    resp = await client.get("/api/v1/leaderboard")
    assert resp.status_code == 200
    body = resp.json()
    assert "entries" in body
    assert "generated_at" in body
    # All tools should appear even without signals
    assert len(body["entries"]) > 0


@pytest.mark.asyncio
async def test_leaderboard_with_signals(client):
    """GET /leaderboard after signals should rank tools by reliability."""
    # Submit signals for two tools with different success rates
    for i in range(10):
        await client.post("/api/v1/signals", json={
            "tool": "github-mcp",
            "signal": "reliability",
            "context": {"task": "test", "success": True, "latency_ms": 100},
        })
    for i in range(10):
        await client.post("/api/v1/signals", json={
            "tool": "slack-mcp",
            "signal": "reliability",
            "context": {"task": "test", "success": i < 5, "latency_ms": 200},
        })

    resp = await client.get("/api/v1/leaderboard")
    entries = resp.json()["entries"]
    # github-mcp (100% success) should rank higher than slack-mcp (50%)
    github_rank = next(e["rank"] for e in entries if e["tool_id"] == "github-mcp")
    slack_rank = next(e["rank"] for e in entries if e["tool_id"] == "slack-mcp")
    assert github_rank < slack_rank


@pytest.mark.asyncio
async def test_leaderboard_category_filter(client):
    """GET /leaderboard?category=X should only return tools in that category."""
    resp = await client.get("/api/v1/leaderboard", params={"category": "developer-tools"})
    assert resp.status_code == 200
    for entry in resp.json()["entries"]:
        assert entry["category"] == "developer-tools"


@pytest.mark.asyncio
async def test_leaderboard_limit(client):
    """GET /leaderboard with limit should cap entries."""
    resp = await client.get("/api/v1/leaderboard", params={"limit": 3})
    assert resp.status_code == 200
    assert len(resp.json()["entries"]) <= 3


@pytest.mark.asyncio
async def test_leaderboard_invalid_limit(client):
    """GET /leaderboard with limit=0 should return 422."""
    resp = await client.get("/api/v1/leaderboard", params={"limit": 0})
    assert resp.status_code == 422
