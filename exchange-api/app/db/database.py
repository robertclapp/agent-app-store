"""
Database layer — SQLite for development, Postgres for production.
Uses aiosqlite for async access. Swap DATABASE_URL for Postgres in prod.
"""

import os
import sqlite3
import aiosqlite
import json
from pathlib import Path

DATABASE_URL = os.getenv("DATABASE_URL", "data/exchange.db")
_db: aiosqlite.Connection | None = None


def _is_uri(dsn: str) -> bool:
    """SQLite URI filenames (file:...?mode=ro) need uri=True to be honoured."""
    return dsn.startswith("file:")


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        Path("data").mkdir(exist_ok=True)
        _db = await aiosqlite.connect(DATABASE_URL, uri=_is_uri(DATABASE_URL))
        _db.row_factory = aiosqlite.Row
    return _db


async def check_writable() -> bool:
    """
    Prove the database accepts writes, without changing it.

    Opens a fresh connection (so it never collides with the shared
    connection's transaction state), performs a real write inside a
    transaction, and rolls it back. The write has to be real: SQLite lets
    BEGIN IMMEDIATE succeed on a read-only database and only raises
    "attempt to write a readonly database" when a page is actually
    modified. A root-owned file under the non-root container user — the
    state a botched volume migration leaves — still serves reads and
    passes a plain connect, but fails here. /health uses this so such a
    deployment reports unhealthy instead of accepting traffic and failing
    every POST.

    A database that is merely busy (another writer holds the lock) is
    writable, so lock contention is reported as healthy rather than
    turning write load into a false outage.
    """
    try:
        async with aiosqlite.connect(
            DATABASE_URL, uri=_is_uri(DATABASE_URL), timeout=1.0,
        ) as conn:
            await conn.execute("BEGIN IMMEDIATE")
            await conn.execute("CREATE TABLE __health_write_probe (probe INTEGER)")
            await conn.execute("ROLLBACK")
        return True
    except sqlite3.OperationalError as exc:
        message = str(exc).lower()
        return "locked" in message or "busy" in message
    except Exception:
        return False


async def close_db():
    """Close the database connection for clean shutdown."""
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def init_db():
    db = await get_db()
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS signals (
            id          TEXT PRIMARY KEY,
            tool        TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            context     TEXT NOT NULL,  -- JSON blob
            agent_hash  TEXT,           -- hashed agent_id, never raw
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_signals_tool ON signals(tool);
        CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);

        CREATE TABLE IF NOT EXISTS workflows (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            description  TEXT,
            goal         TEXT NOT NULL,
            steps        TEXT NOT NULL,  -- JSON array
            tools_used   TEXT NOT NULL,  -- JSON array of tool IDs
            success_rate REAL,
            invocations  INTEGER DEFAULT 0,
            agent_hash   TEXT,
            status       TEXT DEFAULT 'active',
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_goal  ON workflows(goal);
        CREATE INDEX IF NOT EXISTS idx_workflows_tools ON workflows(tools_used);

        CREATE TABLE IF NOT EXISTS rate_limits (
            scope         TEXT NOT NULL,
            identity_hash TEXT NOT NULL,
            window_start  INTEGER NOT NULL,
            request_count INTEGER NOT NULL,
            PRIMARY KEY (scope, identity_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_window
            ON rate_limits(window_start);
    """)
    await db.commit()
