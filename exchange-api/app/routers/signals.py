from fastapi import APIRouter, HTTPException
from app.models.schemas import SignalCreate, SignalResponse
from app.db.database import get_db
import hashlib, json, uuid
from datetime import datetime, timezone

router = APIRouter()

KNOWN_TOOLS = {
    "perplexity-sonar", "brave-search-api", "github-mcp", "notion-mcp",
    "slack-mcp", "playwright-mcp", "firecrawl-mcp", "composio-mcp",
    "terraform-mcp", "datadog-mcp", "figma-mcp", "google-workspace-mcp",
    "openai-api", "anthropic-api", "jira-mcp", "docker-mcp",
    "pagerduty-mcp", "vectara-mcp", "hermes-tweet",
}


@router.post(
    "/signals",
    response_model=SignalResponse,
    summary="Report a tool usage signal",
    description="""
Submit a reliability, latency, compatibility, or error signal after using a tool.
Agents should call this endpoint after each tool invocation to contribute to
the collective intelligence graph.

Signals are aggregated — raw context data is stored but individual agent IDs
are hashed before storage for privacy.
    """,
)
async def create_signal(signal: SignalCreate):
    if signal.tool not in KNOWN_TOOLS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown tool ID: '{signal.tool}'. Check the registry at agentappstore.dev"
        )

    db = await get_db()
    signal_id = str(uuid.uuid4())
    agent_hash = hashlib.sha256((signal.agent_id or "anonymous").encode()).hexdigest()[:16]

    await db.execute(
        """INSERT INTO signals (id, tool, signal_type, context, agent_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (signal_id, signal.tool, signal.signal.value,
         json.dumps(signal.context), agent_hash,
         datetime.now(timezone.utc).isoformat())
    )
    await db.commit()

    return SignalResponse(
        id=signal_id,
        tool=signal.tool,
        signal=signal.signal,
        recorded_at=datetime.now(timezone.utc),
        accepted=True,
    )
