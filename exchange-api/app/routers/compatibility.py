from fastapi import APIRouter, Query
from app.models.schemas import CompatibilityResponse, CompatibilityEntry
from app.db.database import get_db
import json
from collections import Counter

router = APIRouter()


@router.get(
    "/compatibility",
    response_model=CompatibilityResponse,
    summary="Query tool compatibility graph",
    description="""
Returns tools that are commonly used alongside the queried tool,
ranked by co-occurrence confidence. Built from workflow submissions
and compatibility signals from the agent community.

Use this to:
- Discover which tools complement each other
- Validate a tool combination before building a workflow
- Find alternatives when a tool is unavailable
    """,
)
async def get_compatibility(
    tool: str = Query(..., description="Tool ID to query"),
    limit: int = Query(5, ge=1, le=20),
):
    db = await get_db()

    # Find all workflows containing this tool
    async with db.execute(
        """SELECT tools_used, success_rate, invocations
           FROM workflows
           WHERE tools_used LIKE ? AND status = 'active'""",
        (f'%"{tool}"%',)
    ) as cursor:
        rows = list(await cursor.fetchall())

    if not rows:
        return CompatibilityResponse(
            tool=tool,
            works_well_with=[],
            avoid_pairing_with=[],
            total_signals=0,
        )

    partner_counts: Counter = Counter()
    partner_success: dict[str, list[float]] = {}
    total_signals = len(rows)

    for row in rows:
        tools = json.loads(row["tools_used"])
        sr = row["success_rate"] if row["success_rate"] is not None else 0.75
        for t in tools:
            if t == tool:
                continue
            partner_counts[t] += 1
            partner_success.setdefault(t, []).append(sr)

    # Build compatibility entries
    works_well = []
    for partner, count in partner_counts.most_common(limit):
        avg_sr = sum(partner_success[partner]) / len(partner_success[partner])
        # Confidence = success_rate * (co-occurrence_frequency)^0.3
        # The 0.3 exponent dampens the effect of raw count, favoring quality over quantity
        confidence = min(0.99, avg_sr * (count / max(total_signals, 1)) ** 0.3)
        works_well.append(CompatibilityEntry(
            tool=partner,
            pattern=f"co-used-in-{count}-workflows",
            confidence=round(confidence, 2),
            reported_by=count,
        ))

    # Avoid pairs: low success rate pairings (if any signals report errors)
    async with db.execute(
        """SELECT context FROM signals
           WHERE tool = ? AND signal_type = 'error'
           LIMIT 100""",
        (tool,)
    ) as cursor:
        error_rows = await cursor.fetchall()

    avoid = []  # Would be populated with error co-occurrence analysis

    return CompatibilityResponse(
        tool=tool,
        works_well_with=works_well,
        avoid_pairing_with=avoid,
        total_signals=total_signals,
    )
