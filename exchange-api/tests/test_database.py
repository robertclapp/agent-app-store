"""
Tests for the database layer's DSN handling.

get_db() must create the directory the configured DATABASE_URL actually
lives in — not a hard-coded ./data — now that SQLite URI DSNs are accepted.
"""

from pathlib import Path

import pytest

import app.db.database as db_mod


@pytest.mark.parametrize(
    ("dsn", "expected"),
    [
        ("data/exchange.db", Path("data")),
        ("/srv/exchange/exchange.db", Path("/srv/exchange")),
        ("file:/srv/exchange/exchange.db?mode=ro", Path("/srv/exchange")),
        ("file:data/exchange.db?mode=rwc", Path("data")),
        ("exchange.db", None),
        (":memory:", None),
        ("file::memory:?cache=shared", None),
    ],
)
def test_db_parent_derives_directory_from_dsn(dsn, expected):
    assert db_mod._db_parent(dsn) == expected


@pytest.mark.asyncio
async def test_get_db_creates_the_configured_parent_directory(tmp_path, monkeypatch):
    """A nested, not-yet-existing directory in DATABASE_URL must be created."""
    target = tmp_path / "nested" / "deeper" / "exchange.db"
    monkeypatch.setattr(db_mod, "DATABASE_URL", str(target))
    monkeypatch.setattr(db_mod, "_db", None)

    conn = await db_mod.get_db()
    try:
        assert target.parent.is_dir()
        assert (await (await conn.execute("SELECT 1")).fetchone())[0] == 1
    finally:
        await db_mod.close_db()


@pytest.mark.asyncio
async def test_get_db_honours_sqlite_uri_dsn(tmp_path, monkeypatch):
    """A file: URI DSN is opened as a URI (uri=True), not as a literal filename."""
    target = tmp_path / "uri" / "exchange.db"
    monkeypatch.setattr(db_mod, "DATABASE_URL", f"file:{target}?mode=rwc")
    monkeypatch.setattr(db_mod, "_db", None)

    conn = await db_mod.get_db()
    try:
        await conn.execute("CREATE TABLE t (x INTEGER)")
        await conn.commit()
    finally:
        await db_mod.close_db()

    # The database landed at the path inside the URI, and no literal file
    # named "file:..." was created next to it.
    assert target.is_file()
    assert not any(p.name.startswith("file:") for p in tmp_path.iterdir())


@pytest.mark.asyncio
async def test_database_status_distinguishes_readonly_from_unavailable(tmp_path, monkeypatch):
    """
    "readonly" means the file is there and readable but this process cannot
    write it — the ownership case an operator must fix. "unavailable" means
    it cannot be opened at all. Sending someone to check ownership of a file
    that does not exist would be the wrong diagnosis.
    """
    import sqlite3

    ro = tmp_path / "ro.db"
    sqlite3.connect(ro).close()
    # Premise of "readonly": reads succeed through the same DSN.
    reader = sqlite3.connect(f"file:{ro}?mode=ro", uri=True)
    assert reader.execute("SELECT 1").fetchone() == (1,)
    reader.close()

    monkeypatch.setattr(db_mod, "DATABASE_URL", f"file:{ro}?mode=ro")
    assert await db_mod.database_status() == "readonly"

    monkeypatch.setattr(db_mod, "DATABASE_URL", str(tmp_path / "missing-dir" / "x.db"))
    assert await db_mod.database_status() == "unavailable"


@pytest.mark.asyncio
async def test_database_status_reports_writable_when_merely_locked(tmp_path, monkeypatch):
    """
    Write contention is not an outage. Another connection holding SQLite's
    RESERVED lock makes the probe wait out its busy timeout and then report
    the database writable; otherwise heavy write load would flip /health to
    503 and take a healthy deployment out of rotation.
    """
    import sqlite3

    target = tmp_path / "busy.db"
    monkeypatch.setattr(db_mod, "DATABASE_URL", str(target))
    holder = sqlite3.connect(target, isolation_level=None)
    holder.execute("CREATE TABLE t (x INTEGER)")
    holder.execute("BEGIN IMMEDIATE")
    holder.execute("INSERT INTO t VALUES (1)")
    try:
        assert await db_mod.database_status() == "writable"
    finally:
        holder.execute("ROLLBACK")
        holder.close()
