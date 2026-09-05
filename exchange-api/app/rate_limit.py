"""Atomic, privacy-preserving write rate limits backed by SQLite."""

import hashlib
import os
import time

from fastapi import HTTPException, Request

from app.db.database import get_db


WINDOW_SECONDS = 60


def _configured_limit() -> int:
    try:
        return max(1, int(os.getenv("WRITE_RATE_LIMIT_PER_MINUTE", "100")))
    except ValueError:
        return 100


def _hash_identity(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def _increment(scope: str, identity: str, window_start: int) -> int:
    """Increment one fixed-window counter atomically and return its new value."""
    db = await get_db()
    async with db.execute(
        """
        INSERT INTO rate_limits (scope, identity_hash, window_start, request_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(scope, identity_hash) DO UPDATE SET
            window_start = excluded.window_start,
            request_count = CASE
                WHEN rate_limits.window_start = excluded.window_start
                THEN rate_limits.request_count + 1
                ELSE 1
            END
        RETURNING request_count
        """,
        (scope, _hash_identity(identity), window_start),
    ) as cursor:
        row = await cursor.fetchone()
    await db.commit()
    if row is None:
        raise RuntimeError("Rate-limit counter update returned no row")
    return int(row[0])


async def _enforce(scope: str, identity: str) -> None:
    limit = _configured_limit()
    window_start = int(time.time()) // WINDOW_SECONDS
    db = await get_db()
    await db.execute(
        "DELETE FROM rate_limits WHERE window_start < ?",
        (window_start - 1,),
    )
    await db.commit()
    count = await _increment(scope, identity, window_start)
    if count > limit:
        retry_after = WINDOW_SECONDS - (int(time.time()) % WINDOW_SECONDS)
        raise HTTPException(
            status_code=429,
            detail="Write rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )


async def enforce_ip_write_rate_limit(request: Request) -> None:
    """Limit a public write before FastAPI parses or validates its body."""
    client_ip = request.client.host if request.client else "unknown"
    await _enforce("ip", client_ip)


async def enforce_agent_write_rate_limit(agent_id: str | None) -> None:
    """Also limit a supplied agent identifier after request validation."""
    if agent_id:
        await _enforce("agent", agent_id)
