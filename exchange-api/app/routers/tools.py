from fastapi import APIRouter, Path
from app.models.schemas import ToolStats
from app.db.database import get_db
import json
import math
from datetime import datetime, timezone
from collections import Counter

router = APIRouter()


@router.get(
    "/tools/{tool_id}/stats",
    response_model=ToolStats,
    summary="Get aggregate stats for a tool",
    description="Returns aggregated reliability, latency, and usage stats for a specific tool built from community-submitted signals.",
)
async def get_tool_stats(
    tool_id: str = Path(..., description="Tool ID"),
):
    db = await get_db()

    async with db.execute(
        "SELECT signal_type, context, created_at FROM signals WHERE tool = ? ORDER BY created_at DESC",
        (tool_id,)
    ) as cursor:
        rows = list(await cursor.fetchall())

    if not rows:
        return ToolStats(
            tool_id=tool_id,
            total_signals=0,
            success_rate=0.0,
            avg_latency_ms=None,
            p95_latency_ms=None,
            error_rate=0.0,
            top_tasks=[],
            common_partners=[],
            last_signal_at=None,
            reliability_score=0.0,
        )

    successes = 0
    latencies = []
    errors = 0
    tasks: Counter = Counter()
    last_signal = None

    for row in rows:
        ctx = json.loads(row["context"])
        sig_type = row["signal_type"]

        task = ctx.get("task")
        if isinstance(task, str):
            tasks[task] += 1

        latency = ctx.get("latency_ms")
        if (
            isinstance(latency, (int, float))
            and not isinstance(latency, bool)
            and math.isfinite(latency)
            and latency >= 0
        ):
            latencies.append(float(latency))

        if sig_type == "reliability":
            if ctx.get("success") is True:
                successes += 1
            else:
                errors += 1
        elif sig_type == "error":
            errors += 1

        if last_signal is None:
            last_signal = datetime.fromisoformat(row["created_at"])

    total = len(rows)
    reliability_signals = successes + errors
    success_rate = successes / reliability_signals if reliability_signals > 0 else 0.0
    error_rate = errors / reliability_signals if reliability_signals > 0 else 0.0
    avg_latency = sum(latencies) / len(latencies) if latencies else None
    p95_latency = sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) > 20 else None

    # Reliability score: weighted combination of success rate, signal volume, latency
    volume_factor = min(1.0, total / 100)  # saturates at 100 signals
    latency_factor = 1.0 if avg_latency is None else max(0.5, 1.0 - (avg_latency / 10000))
    reliability_score = round(success_rate * 70 + volume_factor * 20 + latency_factor * 10, 1)

    # Common partners from workflows
    async with db.execute(
        "SELECT tools_used FROM workflows WHERE tools_used LIKE ? AND status = 'active' LIMIT 50",
        (f'%"{tool_id}"%',)
    ) as cursor:
        wf_rows = await cursor.fetchall()

    partner_counts: Counter = Counter()
    for row in wf_rows:
        for t in json.loads(row["tools_used"]):
            if t != tool_id:
                partner_counts[t] += 1

    return ToolStats(
        tool_id=tool_id,
        total_signals=total,
        success_rate=round(success_rate, 3),
        avg_latency_ms=round(avg_latency, 1) if avg_latency is not None else None,
        p95_latency_ms=round(p95_latency, 1) if p95_latency is not None else None,
        error_rate=round(error_rate, 3),
        top_tasks=[task for task, _ in tasks.most_common(5)],
        common_partners=[tool for tool, _ in partner_counts.most_common(5)],
        last_signal_at=last_signal,
        reliability_score=reliability_score,
    )
