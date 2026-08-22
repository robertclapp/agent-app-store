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

Open `index.html` in a browser — or serve it:

```bash
npx serve .
```

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
# Exchange API
cd exchange-api
pip install pytest pytest-asyncio httpx
pytest tests/ -v

# CLI generators
cd create-mcp-server
npm install
npm test
```

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
