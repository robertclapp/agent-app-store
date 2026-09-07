"""
Shared test fixtures for the Agent Knowledge Exchange API.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.database import get_db, init_db, close_db


@pytest_asyncio.fixture
async def client():
    """Provide an async HTTP test client with a fresh in-memory database."""
    # Use in-memory SQLite for test isolation
    import app.db.database as db_mod
    db_mod.DATABASE_URL = ":memory:"
    db_mod._db = None

    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_db()


@pytest.fixture
def sample_signal():
    """A valid signal payload for testing."""
    return {
        "tool": "github-mcp",
        "signal": "reliability",
        "context": {
            "task": "create-issue",
            "success": True,
            "latency_ms": 340,
            "retries": 0,
        },
        "agent_id": "test-agent-001",
    }


@pytest.fixture
def sample_workflow():
    """A valid workflow payload for testing."""
    return {
        "name": "PR Review Pipeline",
        "description": "Review and merge PRs with AI assistance",
        "goal": "deploy-code",
        "steps": [
            {"tool": "github-mcp", "action": "get_pull_request"},
            {"tool": "anthropic-api", "action": "review_code"},
            {"tool": "slack-mcp", "action": "post_review_summary"},
        ],
        "success_rate": 0.95,
        "invocations": 150,
        "agent_id": "test-agent-001",
    }
