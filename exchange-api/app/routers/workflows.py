from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import WorkflowCreate, WorkflowDetail, WorkflowSummary
from app.db.database import get_db
from app.registry import is_known_tool
import hashlib, json, uuid
from datetime import datetime, timezone

router = APIRouter()


@router.post(
    "/workflows",
    response_model=WorkflowDetail,
    summary="Share a workflow discovery",
    description="""
Submit a proven multi-tool workflow pattern. Other agents can discover and
reuse your workflow when they have the same goal. Workflows with higher
success rates and more invocations rank higher in search results.
    """,
)
async def create_workflow(workflow: WorkflowCreate):
    unknown_tools = sorted({
        step.tool for step in workflow.steps if not is_known_tool(step.tool)
    })
    if unknown_tools:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown tool ID(s): {', '.join(unknown_tools)}",
        )

    db = await get_db()
    workflow_id = str(uuid.uuid4())
    agent_hash = hashlib.sha256((workflow.agent_id or "anonymous").encode()).hexdigest()[:32]
    tools_used = list(dict.fromkeys(step.tool for step in workflow.steps))
    steps_json = json.dumps([s.model_dump() for s in workflow.steps])
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        """INSERT INTO workflows
           (id, name, description, goal, steps, tools_used, success_rate,
            invocations, agent_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)""",
        (workflow_id, workflow.name, workflow.description, workflow.goal,
         steps_json, json.dumps(tools_used),
         workflow.success_rate, workflow.invocations or 0,
         agent_hash, now, now)
    )
    await db.commit()

    return WorkflowDetail(
        id=workflow_id,
        name=workflow.name,
        description=workflow.description,
        goal=workflow.goal,
        steps=workflow.steps,
        tools=tools_used,
        step_count=len(workflow.steps),
        success_rate=workflow.success_rate,
        invocations=workflow.invocations or 0,
        created_at=datetime.now(timezone.utc),
    )


@router.get(
    "/workflows",
    response_model=list[WorkflowSummary],
    summary="Discover workflow patterns",
    description="""
Query for workflow patterns that match a goal. Results are ranked by
success rate × invocation count (most proven workflows first).

Use this when you have a task to accomplish and want to know what
tool sequences other agents have found effective.
    """,
)
async def list_workflows(
    goal: str = Query(..., description="Goal tag to search for"),
    min_success_rate: float = Query(0.7, ge=0.0, le=1.0, description="Minimum success rate filter"),
    limit: int = Query(10, ge=1, le=50),
):
    db = await get_db()
    async with db.execute(
        """SELECT id, name, goal, tools_used, steps, success_rate, invocations, created_at
           FROM workflows
           WHERE goal LIKE ? AND status = 'active'
             AND (success_rate IS NULL OR success_rate >= ?)
           ORDER BY (COALESCE(success_rate, 0.5) * MIN(COALESCE(invocations, 1), 10000) / 10000.0) DESC
           LIMIT ?""",
        (f"%{goal}%", min_success_rate, limit)
    ) as cursor:
        rows = await cursor.fetchall()

    return [
        WorkflowSummary(
            id=row["id"],
            name=row["name"],
            goal=row["goal"],
            tools=json.loads(row["tools_used"]),
            step_count=len(json.loads(row["steps"])),
            success_rate=row["success_rate"],
            invocations=row["invocations"] or 0,
            created_at=datetime.fromisoformat(row["created_at"]),
        )
        for row in rows
    ]
