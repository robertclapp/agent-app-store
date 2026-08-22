"""
Tests for the /api/v1/compatibility endpoint.
Verifies tool co-occurrence analysis and confidence scoring.
"""

import pytest


@pytest.mark.asyncio
async def test_compatibility_no_data(client):
    """GET /compatibility for a tool with no workflows should return empty."""
    resp = await client.get("/api/v1/compatibility", params={"tool": "github-mcp"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["tool"] == "github-mcp"
    assert body["works_well_with"] == []
    assert body["total_signals"] == 0


@pytest.mark.asyncio
async def test_compatibility_with_workflows(client, sample_workflow):
    """GET /compatibility after workflow submissions should return partners."""
    # Submit workflows that use github-mcp with other tools
    await client.post("/api/v1/workflows", json=sample_workflow)

    resp = await client.get("/api/v1/compatibility", params={"tool": "github-mcp"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_signals"] >= 1
    partner_tools = [e["tool"] for e in body["works_well_with"]]
    assert "anthropic-api" in partner_tools or "slack-mcp" in partner_tools


@pytest.mark.asyncio
async def test_compatibility_confidence_range(client, sample_workflow):
    """Confidence scores should be between 0 and 1."""
    await client.post("/api/v1/workflows", json=sample_workflow)

    resp = await client.get("/api/v1/compatibility", params={"tool": "github-mcp"})
    for entry in resp.json()["works_well_with"]:
        assert 0.0 <= entry["confidence"] <= 1.0


@pytest.mark.asyncio
async def test_compatibility_limit(client, sample_workflow):
    """GET /compatibility with limit should cap results."""
    await client.post("/api/v1/workflows", json=sample_workflow)

    resp = await client.get("/api/v1/compatibility", params={"tool": "github-mcp", "limit": 1})
    assert resp.status_code == 200
    assert len(resp.json()["works_well_with"]) <= 1


@pytest.mark.asyncio
async def test_compatibility_missing_tool_param(client):
    """GET /compatibility without tool param should return 422."""
    resp = await client.get("/api/v1/compatibility")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_zero_success_rate_is_not_replaced_by_default(client):
    payload = {
        "name": "Always fails",
        "goal": "test-failure",
        "steps": [
            {"tool": "github-mcp", "action": "start"},
            {"tool": "slack-mcp", "action": "fail"},
        ],
        "success_rate": 0.0,
        "invocations": 5,
    }
    assert (await client.post("/api/v1/workflows", json=payload)).status_code == 200

    body = (await client.get(
        "/api/v1/compatibility", params={"tool": "github-mcp"}
    )).json()
    assert body["works_well_with"][0]["confidence"] == 0.0
