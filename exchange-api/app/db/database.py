"""
Database layer — SQLite for development, Postgres for production.
Uses aiosqlite for async access. Swap DATABASE_URL for Postgres in prod.
"""

import os
import aiosqlite
import json
from pathlib import Path

DATABASE_URL = os.getenv("DATABASE_URL", "data/exchange.db")
_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        Path("data").mkdir(exist_ok=True)
        _db = await aiosqlite.connect(DATABASE_URL)
        _db.row_factory = aiosqlite.Row
    return _db


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
    """)
    await db.commit()
