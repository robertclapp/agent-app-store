"""
Pydantic schemas for all API request and response models.
"""

from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, Literal
from datetime import datetime
from enum import Enum


# ── Enums ──────────────────────────────────────────────────────────────────

class SignalType(str, Enum):
    reliability = "reliability"
    latency = "latency"
    compatibility = "compatibility"
    error = "error"


class WorkflowStatus(str, Enum):
    active = "active"
    deprecated = "deprecated"


# ── Signal models ──────────────────────────────────────────────────────────

class SignalCreate(BaseModel):
    """
    A reliability/usage signal reported by an agent after using a tool.
    Agents submit these automatically to build collective intelligence.
    """
    tool: str = Field(..., description="Tool ID from the AgentStore registry")
    signal: SignalType = Field(..., description="Type of signal being reported")
    context: dict = Field(
        ...,
        description="Contextual data for the signal",
    )
    agent_id: Optional[str] = Field(
        None,
        description="Opaque agent identifier (hashed, not stored raw)",
    )

    model_config = {"json_schema_extra": {"example": {
        "tool": "playwright-mcp",
        "signal": "reliability",
        "context": {
            "task": "form-submission",
            "success": True,
            "latency_ms": 1240,
            "retries": 0,
        },
        "agent_id": "agent_8f3k2mxp",
    }}}


class SignalResponse(BaseModel):
    id: str
    tool: str
    signal: SignalType
    recorded_at: datetime
    accepted: bool = True


# ── Workflow models ────────────────────────────────────────────────────────

class WorkflowStep(BaseModel):
    tool: str = Field(..., description="Tool ID")
    action: str = Field(..., description="Specific action/tool-call name")
    description: Optional[str] = None


class WorkflowCreate(BaseModel):
    """
    A multi-tool workflow pattern discovered by an agent.
    Sharing workflows helps other agents find proven multi-step patterns.
    """
    name: str = Field(..., description="Short, descriptive workflow name")
    description: Optional[str] = Field(None, description="What this workflow accomplishes")
    goal: str = Field(..., description="Canonical goal tag")
    steps: list[WorkflowStep] = Field(..., description="Ordered list of tool invocations")
    success_rate: Optional[float] = Field(
        None, ge=0.0, le=1.0,
        description="Observed success rate (0.0-1.0)",
    )
    invocations: Optional[int] = Field(
        None, ge=0,
        description="Number of times this workflow has been run",
    )
    agent_id: Optional[str] = None

    model_config = {"json_schema_extra": {"example": {
        "name": "PR Review + Deploy Pipeline",
        "goal": "deploy-code",
        "steps": [
            {"tool": "github-mcp", "action": "get_pull_request"},
            {"tool": "anthropic-api", "action": "review_code"},
            {"tool": "slack-mcp", "action": "post_review_summary"},
            {"tool": "github-mcp", "action": "merge_pull_request"},
        ],
        "success_rate": 0.96,
        "invocations": 2341,
    }}}


class WorkflowSummary(BaseModel):
    id: str
    name: str
    goal: str
    tools: list[str]
    step_count: int
    success_rate: Optional[float]
    invocations: int
    created_at: datetime


class WorkflowDetail(WorkflowSummary):
    steps: list[WorkflowStep]
    description: Optional[str]


# ── Compatibility models ───────────────────────────────────────────────────

class CompatibilityEntry(BaseModel):
    tool: str
    pattern: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    reported_by: int = Field(..., description="Number of agents that reported this pairing")


class CompatibilityResponse(BaseModel):
    tool: str
    works_well_with: list[CompatibilityEntry]
    avoid_pairing_with: list[CompatibilityEntry]
    total_signals: int


# ── Tool stats models ──────────────────────────────────────────────────────

class ToolStats(BaseModel):
    tool_id: str
    total_signals: int
    success_rate: float
    avg_latency_ms: Optional[float]
    p95_latency_ms: Optional[float]
    error_rate: float
    top_tasks: list[str]
    common_partners: list[str]
    last_signal_at: Optional[datetime]
    reliability_score: float = Field(
        ..., ge=0.0, le=100.0,
        description="AgentStore reliability score (0-100)"
    )


# ── Leaderboard models ─────────────────────────────────────────────────────

class LeaderboardEntry(BaseModel):
    rank: int
    tool_id: str
    tool_name: str
    category: str
    reliability_score: float
    total_signals: int
    success_rate: float


class LeaderboardResponse(BaseModel):
    category: Optional[str]
    entries: list[LeaderboardEntry]
    generated_at: datetime
