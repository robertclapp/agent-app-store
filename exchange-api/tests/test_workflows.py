"""
Tests for the /api/v1/workflows endpoint.
Verifies workflow creation, querying, and ranking.
"""

import pytest


@pytest.mark.asyncio
async def test_create_workflow_success(client, sample_workflow):
    """POST /workflows with valid data should return 200 with full detail."""
    resp = await client.post("/api/v1/workflows", json=sample_workflow)
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "PR Review Pipeline"
    assert body["goal"] == "deploy-code"
    assert body["step_count"] == 3
    assert body["success_rate"] == 0.95
    assert "id" in body
    assert set(body["tools"]) == {"github-mcp", "anthropic-api", "slack-mcp"}


@pytest.mark.asyncio
async def test_create_workflow_missing_steps(client):
    """POST /workflows without steps should return 422."""
    payload = {
        "name": "Bad Workflow",
        "goal": "deploy-code",
    }
    resp = await client.post("/api/v1/workflows", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_workflow_rejects_empty_steps(client):
    resp = await client.post("/api/v1/workflows", json={
        "name": "Empty Workflow",
        "goal": "deploy-code",
        "steps": [],
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_workflow_invalid_success_rate(client, sample_workflow):
    """POST /workflows with success_rate > 1.0 should return 422."""
    sample_workflow["success_rate"] = 1.5
    resp = await client.post("/api/v1/workflows", json=sample_workflow)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_workflow_rejects_every_unknown_tool(client, sample_workflow):
    """Every workflow step must reference the central tool registry."""
    sample_workflow["steps"].extend([
        {"tool": "unknown-z", "action": "do_thing"},
        {"tool": "unknown-a", "action": "do_other_thing"},
        {"tool": "unknown-z", "action": "repeat"},
    ])

    resp = await client.post("/api/v1/workflows", json=sample_workflow)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Unknown tool ID(s): unknown-a, unknown-z"

    # Rejection happens before persistence; a partially valid workflow must
    # never become discoverable.
    listed = await client.get("/api/v1/workflows", params={"goal": "deploy-code"})
    assert listed.json() == []


@pytest.mark.asyncio
async def test_list_workflows_by_goal(client, sample_workflow):
    """GET /workflows?goal=X should return matching workflows."""
    # Create a workflow first
    await client.post("/api/v1/workflows", json=sample_workflow)

    resp = await client.get("/api/v1/workflows", params={"goal": "deploy-code"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) >= 1
    assert body[0]["goal"] == "deploy-code"


@pytest.mark.asyncio
async def test_list_workflows_empty_results(client):
    """GET /workflows for a nonexistent goal should return empty list."""
    resp = await client.get("/api/v1/workflows", params={"goal": "nonexistent-goal"})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_workflows_min_success_rate_filter(client, sample_workflow):
    """GET /workflows with min_success_rate should filter correctly."""
    await client.post("/api/v1/workflows", json=sample_workflow)

    # Should include our workflow (0.95 >= 0.9)
    resp = await client.get("/api/v1/workflows", params={"goal": "deploy", "min_success_rate": 0.9})
    assert resp.status_code == 200
    assert len(resp.json()) >= 1

    # Should exclude our workflow (0.95 < 0.99)
    resp = await client.get("/api/v1/workflows", params={"goal": "deploy", "min_success_rate": 0.99})
    assert resp.status_code == 200
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_list_workflows_limit(client, sample_workflow):
    """GET /workflows with limit should cap results."""
    # Create multiple workflows
    for i in range(5):
        wf = {**sample_workflow, "name": f"Workflow {i}"}
        await client.post("/api/v1/workflows", json=wf)

    resp = await client.get("/api/v1/workflows", params={"goal": "deploy", "limit": 2})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_workflow_deduplicates_tools(client):
    """Workflow tools list should deduplicate when same tool used multiple times."""
    payload = {
        "name": "Multi-step GitHub",
        "goal": "code-review",
        "steps": [
            {"tool": "github-mcp", "action": "get_pr"},
            {"tool": "github-mcp", "action": "add_comment"},
            {"tool": "github-mcp", "action": "merge_pr"},
        ],
    }
    resp = await client.post("/api/v1/workflows", json=payload)
    assert resp.status_code == 200
    assert resp.json()["tools"] == ["github-mcp"]
