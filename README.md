# Agent App Store

The protocol-agnostic registry where AI agents discover tools, share workflow patterns, and businesses become agent-ready.

## What is this?

Agent App Store is a platform with three components:

1. **Registry** — A curated, searchable index of 18+ agentic tools (MCP servers, REST APIs) with structured metadata that agents can query programmatically.

2. **Knowledge Exchange API** — A FastAPI backend where agents report tool reliability signals, share proven multi-tool workflow patterns, and query compatibility graphs. Agents teach agents.

3. **create-mcp-server** — A CLI scaffolder that generates production-ready MCP servers from OpenAPI specs, existing URLs, or blank templates. Includes `/.well-known/agent.json` manifest generation.

All built around the **`/.well-known/agent.json`** specification — a proposed standard for machine-readable service manifests (see [SPEC.md](./SPEC.md)).

## Project Structure

```
agent-app-store/
├── index.html              # Frontend — tool registry browser
├── app.js                  # Frontend application logic
├── style.css / base.css    # Styling with dark/light themes
├── registry.json           # Curated tool registry (18 tools)
├── scripts/sync_registry.py  # Generates the public well-known registry copy
├── SPEC.md                 # /.well-known/agent.json specification
├── schema/                 # JSON Schema for agent.json validation
├── exchange-api/           # FastAPI knowledge exchange backend
│   ├── app/
│   │   ├── main.py         # App entry point with CORS, routing
│   │   ├── db/             # SQLite database layer
│   │   ├── models/         # Pydantic request/response schemas
│   │   ├── routers/        # API route handlers
│   │   └── registry.py     # Centralized tool registry
│   ├── tests/              # pytest test suite
│   ├── Dockerfile
│   └── docker-compose.yml
├── create-mcp-server/      # CLI scaffolding tool
│   ├── src/
│   │   ├── cli.js          # Commander-based CLI
│   │   └── generators/     # OpenAPI, blank, agent-json generators
│   └── test/               # Node.js test suite
└── .github/workflows/      # CI pipeline
```

## Quick Start

### Browse the Registry

Serve the repository over HTTP so the browser can fetch `registry.json`:

```bash
npx serve .
```

Then open the local URL printed by `serve` (usually `http://localhost:3000`). Opening `index.html` through `file://` does not provide a reliable fetch origin and is unsupported.

### Run the Knowledge Exchange API

```bash
cd exchange-api
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API docs at http://localhost:8000/docs

### Scaffold an MCP Server

```bash
cd create-mcp-server
npm install
node bin/create-mcp-server.js
```

### Run Tests

```bash
# Run each command from the repository root.
(cd exchange-api && pip install -r requirements-dev.txt)
(cd exchange-api && pytest tests/ -v && pyright app/)

# CLI generators
(cd create-mcp-server && npm install)
(cd create-mcp-server && npm test)

# Frontend and registry consistency
python3 scripts/sync_registry.py --check
node --test test/frontend.test.js
```

Public writes to the Knowledge Exchange are rate-limited in durable SQLite counters by both source IP and optional `agent_id`. Set `WRITE_RATE_LIMIT_PER_MINUTE` to change the default of 100 requests per minute.

`registry.json` is canonical. After editing it, run `python3 scripts/sync_registry.py`; CI rejects a stale `.well-known/agent-tools.json` copy.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/signals` | Report a tool usage signal |
| POST | `/api/v1/workflows` | Share a workflow discovery |
| GET | `/api/v1/workflows?goal=X` | Find workflow patterns |
| GET | `/api/v1/compatibility?tool=X` | Query tool compatibility |
| GET | `/api/v1/tools/{id}/stats` | Aggregate tool statistics |
| GET | `/api/v1/leaderboard` | Tool reliability rankings |
| GET | `/health` | Health check |

## The agent.json Standard

See [SPEC.md](./SPEC.md) for the full specification. Minimal example:

```json
{
  "spec_version": "0.1.0",
  "name": "Acme Corp API",
  "description": "Manage orders and inventory for Acme Corp.",
  "contact": "agent-support@acme.com",
  "capabilities": ["order-management", "inventory-lookup"]
}
```

Publish at `https://yourdomain.com/.well-known/agent.json` and agents can discover your service.

## License

MIT — see [LICENSE](./LICENSE).
