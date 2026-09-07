# CLAUDE.md — Agent App Store

Durable project context and rules for Claude Code sessions. Read this before making changes.

## Project Overview

Agent App Store is a three-part platform:

1. **Frontend** (vanilla JS/HTML/CSS at repo root) — searchable tool registry UI
2. **exchange-api/** — FastAPI backend for agent knowledge exchange (Python 3.12, SQLite)
3. **create-mcp-server/** — Node.js CLI scaffolder for MCP servers

The `registry.json` at the repo root is the **single source of truth** for the tool list — both the frontend and `exchange-api/app/registry.py` load from it. The public `.well-known/agent-tools.json` is generated from it with `python3 scripts/sync_registry.py`; never edit that copy directly.

## Core Rules

1. **Never report "done" with failing tests.** After any code change, run the full test suite and fix every failure before reporting completion.
   - Python: `cd exchange-api && python3 -m pytest tests/ -v`
   - Node: `cd create-mcp-server && node --test test/test_generators.js`

2. **Run tests incrementally, not just at the end.** After each logical group of file edits, run the relevant suite before moving on. A `PostToolUse` hook (`.claude/hooks/run-tests.sh`) does this automatically on Write/Edit.

3. **Registry consistency.** The tool list lives in `registry.json`. Do not hardcode tool IDs or metadata anywhere else.
   Run `python3 scripts/sync_registry.py --check` before committing.

4. **Never create pull requests unless explicitly asked.** Push to the designated feature branch only.

## Environment Setup

Dependencies are **not** guaranteed to be present in a fresh session. Install before running tests:

```bash
cd exchange-api && python3 -m pip install -r requirements-dev.txt
cd create-mcp-server && npm install
```

If a test suite reports `No module named pytest` or `Cannot find package`, that is a missing-dependency problem, not a regression — install and re-run.

## Python Conventions

- **Path resolution with `__file__`:** Count the `.parent` chain carefully. `exchange-api/app/registry.py` needs exactly three `.parent` calls to reach the repo root (`app -> exchange-api -> root`). Verify with a quick `python3 -c` check before committing.
- **Pydantic v2:** Use `json_schema_extra` for examples on `Field()`. The `example=` kwarg is deprecated.
- **FastAPI Query/Path:** The `example=` kwarg is also deprecated — use `examples=[...]` or omit.
- **Async SQLite:** Always `await db.commit()` after writes. Use parameterized queries (never f-strings for values).

## JavaScript/Frontend Conventions

- **XSS safety:** Any tool data rendered via `innerHTML` must go through `escapeHtml()` (top of `app.js`). Treat registry contents as untrusted.
- **No inline event handlers** (`onclick`, `onmouseover`). Use `addEventListener` and CSS `:hover`.
- **Vanilla JS only.** No framework dependencies. No build step.

## Testing

- **pytest** for the API (`exchange-api/tests/`). In-memory SQLite per test via `conftest.py`.
- **node --test** for the CLI (`create-mcp-server/test/`). Generated files go to `test/output/`, cleaned up in `after()`.
- **Frontend:** `node --test test/frontend.test.js` from the repository root.
- New features require new tests: happy path plus at least one failure case.

## Deployment

- **Exchange API:** Dockerfile + docker-compose.yml in `exchange-api/`. Configure via `.env` (see `.env.example`).
- **CORS:** Origins restricted via `CORS_ORIGINS` env var.
- **CI:** `.github/workflows/ci.yml` runs API tests, CLI tests, frontend validation, and Docker build.

## Git

- Commit messages: concise subject + bullet list of changes.
- Always `git push -u origin <branch>` with retry on network errors.
