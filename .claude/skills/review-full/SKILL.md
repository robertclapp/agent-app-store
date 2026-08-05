---
name: review-full
description: Run a comprehensive, phased audit of the Agent App Store project — code review, refactoring, test coverage, and strategic analysis — with test gates between phases.
---

# Full Project Audit

Execute a comprehensive, multi-phase audit. **Do not skip phases. Do not report completion until every phase passes its gate.**

## Phase 0 — Environment

Dependencies may be missing in a fresh session. Install first, so later "failures" are real:

```bash
cd exchange-api && pip install -r requirements-dev.txt
cd create-mcp-server && npm install
```

Record the baseline: run both suites and note the passing count **before** making any changes.

## Phase 1 — Review & Plan (no edits yet)

1. Read `CLAUDE.md` and `registry.json` for project context.
2. Use the `Explore` subagent across three tracks in parallel:
   - Python backend (`exchange-api/`)
   - Frontend (`app.js`, `index.html`, `style.css`)
   - CLI tool (`create-mcp-server/`)
3. Build a checklist of findings, categorized:
   - **Security** (XSS, CORS, auth, input validation)
   - **Bugs** (functional defects, edge cases)
   - **Architecture** (duplication, tight coupling, single-source-of-truth violations)
   - **Testing gaps** (missing coverage, untested paths)
   - **UX/Strategy** (documented in Phase 5)
4. **Gate:** Present the plan and wait for approval before editing.

## Phase 2 — Refactor

For each planned item:
1. Make the edit.
2. Run the relevant suite (the `PostToolUse` hook does this automatically; if it's not active, run manually).
3. Fix failures before moving on. Do **not** batch edits across many files without running tests between them.

**Gate:** Baseline tests from Phase 0 still pass.

## Phase 3 — Expand Test Coverage

1. Add tests for new functionality and previously untested paths.
2. Each new test file covers: happy path, at least one validation/error case, and edge cases from the review.
3. Run both full suites.

**Gate:** 0 failures. Print both summaries.

## Phase 4 — Documentation & Infrastructure

1. Update `README.md` if public APIs changed.
2. Update `.env.example` for any new env vars.
3. Verify `.github/workflows/ci.yml` still matches the project structure.

**Gate:** Docs reflect the current code.

## Phase 5 — Strategic Analysis

Deliver unvarnished feedback on:
- **Spec quality** — strengths, gaps, missing mechanisms
- **UI/UX** — dead CTAs, friction points, missing flows
- **Architecture** — scaling risks, single points of failure
- **Distribution & adoption** — concrete, prioritized go-to-market plan, not generic marketing advice

Be direct about what is weak. Vague praise is not useful.

## Phase 6 — Commit & Push

1. Show `git status` and `git diff --stat`.
2. Commit with a descriptive message and push to the current feature branch.
3. **Do not create a pull request** unless explicitly asked.

## Completion Criteria

Report completion **only when**:
- [ ] Both suites pass (show the output)
- [ ] Every Phase 1 finding is resolved or explicitly deferred with a reason
- [ ] Working tree clean and pushed
- [ ] Strategic analysis delivered
