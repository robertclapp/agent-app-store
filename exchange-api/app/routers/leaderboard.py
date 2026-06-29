from fastapi import APIRouter, Query
from app.models.schemas import LeaderboardResponse, LeaderboardEntry
from app.db.database import get_db
import json
from datetime import datetime, timezone
from collections import defaultdict, Counter

router = APIRouter()

TOOL_METADATA = {
    "perplexity-sonar":     ("Perplexity Sonar API",      "search-and-data"),
    "brave-search-api":     ("Brave Search API",           "search-and-data"),
    "github-mcp":           ("GitHub MCP Server",          "developer-tools"),
    "notion-mcp":           ("Notion MCP Server",          "productivity"),
    "slack-mcp":            ("Slack MCP Server",           "communication"),
    "playwright-mcp":       ("Playwright MCP Server",      "developer-tools"),
    "firecrawl-mcp":        ("Firecrawl MCP Server",       "data-and-analytics"),
    "composio-mcp":         ("Composio MCP Server",        "productivity"),
    "terraform-mcp":        ("Terraform MCP Server",       "infrastructure"),
    "datadog-mcp":          ("Datadog MCP Server",         "infrastructure"),
    "figma-mcp":            ("Figma MCP Server",           "design"),
    "google-workspace-mcp": ("Google Workspace MCP",       "productivity"),
    "openai-api":           ("OpenAI API",                 "ai-and-ml"),
    "anthropic-api":        ("Anthropic Claude API",       "ai-and-ml"),
    "jira-mcp":             ("Jira MCP Server",            "developer-tools"),
    "docker-mcp":           ("Docker MCP Server",          "infrastructure"),
    "pagerduty-mcp":        ("PagerDuty MCP Server",       "infrastructure"),
    "vectara-mcp":          ("Vectara MCP Server",         "ai-and-ml"),
    "hermes-tweet":         ("Hermes Tweet",                "communication"),
}


@router.get(
    "/leaderboard",
    response_model=LeaderboardResponse,
    summary="Get tool reliability leaderboard",
    description="Returns tools ranked by community-reported reliability score. Filter by category to see category-specific rankings.",
)
async def get_leaderboard(
    category: str | None = Query(None, description="Filter by category slug", example="developer-tools"),
    limit: int = Query(10, ge=1, le=50),
):
    db = await get_db()

    # Compute stats per tool from signals
    async with db.execute(
        "SELECT tool, signal_type, context FROM signals WHERE signal_type = 'reliability'"
    ) as cursor:
        rows = await cursor.fetchall()

    tool_stats: dict[str, dict] = defaultdict(lambda: {"successes": 0, "total": 0, "signals": 0})

    for row in rows:
        t = row["tool"]
        ctx = json.loads(row["context"])
        tool_stats[t]["signals"] += 1
        if ctx.get("success"):
            tool_stats[t]["successes"] += 1
        tool_stats[t]["total"] += 1

    entries = []
    for tool_id, (tool_name, tool_category) in TOOL_METADATA.items():
        if category and tool_category != category:
            continue

        stats = tool_stats.get(tool_id, {})
        total = stats.get("total", 0)
        successes = stats.get("successes", 0)
        success_rate = successes / total if total > 0 else 0.0

        volume_factor = min(1.0, total / 100)
        reliability_score = round(success_rate * 70 + volume_factor * 30, 1)

        entries.append({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "category": tool_category,
            "reliability_score": reliability_score,
            "total_signals": total,
            "success_rate": round(success_rate, 3),
        })

    # Sort by reliability_score desc, then by name for ties
    entries.sort(key=lambda e: (-e["reliability_score"], e["tool_name"]))
    entries = entries[:limit]

    return LeaderboardResponse(
        category=category,
        entries=[
            LeaderboardEntry(rank=i + 1, **e)
            for i, e in enumerate(entries)
        ],
        generated_at=datetime.now(timezone.utc),
    )
