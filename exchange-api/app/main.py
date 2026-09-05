"""
Agent Knowledge Exchange API
============================
The backend for the Agent App Store's Knowledge Exchange layer.

Agents can:
  POST /api/v1/signals          — report tool reliability / usage
  POST /api/v1/workflows        — share a discovered multi-tool workflow
  GET  /api/v1/compatibility    — query which tools work well together
  GET  /api/v1/workflows        — discover workflow patterns for a goal
  GET  /api/v1/tools/{id}/stats — aggregate stats for a tool

Humans/developers can:
  GET  /api/v1/leaderboard      — most reliable tools by category
  GET  /docs                    — interactive OpenAPI docs (Swagger UI)
  GET  /openapi.json            — machine-readable OpenAPI spec
"""

import os
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from contextlib import asynccontextmanager

from app.db.database import init_db, close_db, check_writable
from app.registry import KNOWN_TOOL_IDS
from app.rate_limit import enforce_ip_write_rate_limit
from app.routers import signals, workflows, compatibility, tools, leaderboard


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(
    title="Agent Knowledge Exchange API",
    description="""
## The structured knowledge layer for the Agent App Store.

Agents POST what they've learned. Agents GET what others have discovered.
Not a wiki. A queryable signal graph.

### Submission identity
`agent_id` is an optional opaque attribution identifier, not authentication.
Read and write endpoints are public; write abuse is constrained by both source
IP and agent-id rate limits.

### Rate Limits
- Public write endpoints: 100 req/min per source IP and supplied agent_id
- Configure with `WRITE_RATE_LIMIT_PER_MINUTE`

### Agent Discovery
This API is itself discoverable at `/.well-known/agent.json`.
    """,
    version="0.1.0",
    contact={
        "name": "Agent App Store",
        "url": "https://agentappstore.dev",
        "email": "api@agentappstore.dev",
    },
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def request_validation_error(
    _request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Return bounded, JSON-safe validation errors without echoing request data."""
    details = [
        {
            "type": error.get("type", "value_error"),
            "loc": list(error.get("loc", ())),
            "msg": error.get("msg", "Invalid request"),
        }
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "https://agentappstore.dev,http://localhost:3000,http://localhost:8000"
).split(",")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]


@app.middleware("http")
async def rate_limit_public_writes(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Apply IP limits before parsing bodies on the two public write routes."""
    if request.method == "POST" and request.url.path in {
        "/api/v1/signals",
        "/api/v1/workflows",
    }:
        try:
            await enforce_ip_write_rate_limit(request)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )
    return await call_next(request)


# Add CORS after the rate-limit middleware so CORS remains the outer layer and
# browser clients can read 429 responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(signals.router,       prefix="/api/v1", tags=["Signals"])
app.include_router(workflows.router,     prefix="/api/v1", tags=["Workflows"])
app.include_router(compatibility.router, prefix="/api/v1", tags=["Compatibility"])
app.include_router(tools.router,         prefix="/api/v1", tags=["Tools"])
app.include_router(leaderboard.router,   prefix="/api/v1", tags=["Leaderboard"])


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/docs")


@app.get("/health", tags=["Health"])
async def health():
    # tools_known surfaces registry state: if registry.json fails to load the
    # API rejects every signal. database surfaces write access: a root-owned
    # file under the non-root container user still serves reads, so a plain
    # "ok" would let an orchestrator route traffic to a deployment where
    # every POST fails. Fail closed on either.
    writable = await check_writable()
    payload = {
        "status": "ok",
        "version": "0.1.0",
        "tools_known": len(KNOWN_TOOL_IDS),
        "database": "writable" if writable else "readonly",
    }
    if not KNOWN_TOOL_IDS or not writable:
        payload["status"] = "unhealthy"
        return JSONResponse(status_code=503, content=payload)
    return payload
