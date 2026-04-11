# The `/.well-known/agent.json` Specification

**Version:** 0.1.0  
**Status:** Draft  
**Published:** 2026-04-10  
**Registry:** [Agent App Store](https://agentappstore.dev)  
**IETF Well-Known URI:** Proposed — `agent` (pending RFC 8615 registration)  
**License:** CC0 1.0 Universal (public domain)

---

## Abstract

This document defines `agent.json` — a machine-readable manifest that any web-accessible service can publish at `/.well-known/agent.json` to describe how AI agents should discover and interact with it. The goal is a universal, protocol-agnostic entry point for agentic discovery, analogous to `robots.txt` for crawlers and `security.txt` for vulnerability disclosure.

---

## 1. Motivation

AI agents increasingly need to interact with third-party services on behalf of users. Today, agents either rely on hardcoded integrations, user-supplied credentials, or brittle HTML parsing. There is no standard way for a service to say:

> "Here is what I can do for agents, how to authenticate, what my rate limits are, and where to find structured tool definitions."

`agent.json` fills that gap. It is the handshake between a service and any agent that wants to use it.

### Design Principles

1. **Simple by default.** A minimal valid `agent.json` is five lines. Complexity is opt-in.
2. **Protocol-agnostic.** Supports REST, MCP, GraphQL, gRPC, and future protocols without modification to the core schema.
3. **Agent-readable first.** Every field is chosen for what an LLM reasoning about tool selection needs, not for human documentation.
4. **Versioned and extensible.** The `spec_version` field enables non-breaking evolution. Vendor extensions use namespaced keys.
5. **Privacy-respecting.** Publishing `agent.json` is opt-in. Agents MUST NOT assume any service supports agentic access without an explicit manifest.

---

## 2. The Manifest

### 2.1 Location

A service MUST publish its manifest at:

```
https://{domain}/.well-known/agent.json
```

The file MUST be served:
- Over HTTPS
- With `Content-Type: application/json`
- With appropriate CORS headers if cross-origin agent access is expected (`Access-Control-Allow-Origin: *` is recommended)

### 2.2 Minimal Valid Manifest

```json
{
  "spec_version": "0.1.0",
  "name": "Acme Corp API",
  "description": "Manage orders, inventory, and customer accounts for Acme Corp.",
  "contact": "agent-support@acme.com",
  "capabilities": ["order-management", "inventory-lookup", "customer-accounts"]
}
```

This is enough for an agent to know the service exists, what it does, and who to contact about agentic access issues. All other fields are optional.

---

## 3. Full Schema Reference

```json
{
  "$schema": "https://agentappstore.dev/schema/agent-json/0.1.0",
  "spec_version": "0.1.0",

  // ── Identity ──────────────────────────────────────────────────────────────
  "name": "string — Human-readable service name",
  "description": "string — 1-3 sentence description optimized for LLM tool selection",
  "homepage": "https://...",
  "logo_url": "https://...",
  "contact": "email or URL for agent-related issues",

  // ── Capabilities ──────────────────────────────────────────────────────────
  "capabilities": ["array", "of", "capability", "slugs"],
  "tags": ["optional", "semantic", "tags", "for", "search"],
  "languages": ["en", "es"],

  // ── Tool Definitions (where agents get structured schemas) ─────────────────
  "tools": [
    {
      "protocol": "mcp | rest | graphql | grpc | openapi",
      "name": "string",
      "description": "string — what this tool does, for LLM reasoning",
      "endpoint": "https://... | npx package-name | docker image:tag",
      "schema_url": "https://... (OpenAPI, AsyncAPI, GraphQL SDL)",
      "docs_url": "https://..."
    }
  ],

  // ── Authentication ─────────────────────────────────────────────────────────
  "auth": {
    "type": "none | api_key | oauth2 | mtls | custom",
    // For api_key:
    "key_header": "Authorization",
    "key_prefix": "Bearer",
    "key_acquisition_url": "https://...",
    // For oauth2:
    "oauth2": {
      "authorization_url": "https://...",
      "token_url": "https://...",
      "scopes": { "read": "Read access", "write": "Write access" },
      "pkce_required": true
    }
  },

  // ── Rate Limits ────────────────────────────────────────────────────────────
  "rate_limits": {
    "requests_per_minute": 60,
    "requests_per_day": 10000,
    "tokens_per_minute": null,
    "burst_limit": 10,
    "retry_after_header": "Retry-After"
  },

  // ── Agent Behavior Hints ───────────────────────────────────────────────────
  "agent_hints": {
    "preferred_invocation": "mcp",
    "idempotent_methods": ["GET", "HEAD"],
    "destructive_actions_require_confirmation": true,
    "max_concurrent_requests": 5,
    "supports_streaming": true,
    "supports_webhooks": false,
    "data_residency": "US",
    "pii_in_requests": false
  },

  // ── Pricing ────────────────────────────────────────────────────────────────
  "pricing": {
    "model": "free | per_request | per_token | subscription | custom",
    "free_tier": true,
    "free_tier_details": "1000 requests/month at no cost",
    "pricing_url": "https://..."
  },

  // ── Trust & Compliance ─────────────────────────────────────────────────────
  "trust": {
    "verified_by": ["agentappstore.dev"],
    "certifications": ["SOC2", "HIPAA", "GDPR"],
    "terms_of_service_url": "https://...",
    "privacy_policy_url": "https://...",
    "agent_terms_url": "https://... (agent-specific TOS if different)"
  },

  // ── Discovery ──────────────────────────────────────────────────────────────
  "discovery": {
    "listed_in": ["https://agentappstore.dev", "https://glama.ai"],
    "registry_ids": {
      "agentappstore": "acme-corp-api",
      "mcp_registry": "acme/mcp-server"
    }
  },

  // ── Versioning & Lifecycle ─────────────────────────────────────────────────
  "version": "2.1.0",
  "status": "stable | beta | deprecated",
  "deprecated_at": null,
  "sunset_date": null,
  "changelog_url": "https://...",

  // ── Vendor Extensions (use reverse-domain prefix) ──────────────────────────
  "x-anthropic-mcp-compatible": true,
  "x-openai-plugin-id": "acme-corp"
}
```

---

## 4. Field Definitions

### 4.1 `spec_version` (required)
Semver string. Agents use this to determine which fields to expect. MUST be `"0.1.0"` for this version of the spec.

### 4.2 `name` (required)
Human-readable service name. Should match the brand name agents would recognize. Max 64 characters.

### 4.3 `description` (required)
A 1-3 sentence description written for LLM tool selection reasoning. Prioritize what the service *does* for an agent over marketing language. Good: *"Sends transactional email and SMS via REST API. Supports templating, scheduling, and delivery webhooks."* Bad: *"The world's leading communication platform."*

### 4.4 `capabilities`
Array of capability slugs drawn from the [AgentStore Capability Taxonomy](https://agentappstore.dev/capabilities). Agents use these for semantic tool matching. Use the taxonomy where possible; free-form slugs are permitted but reduce discoverability.

**Standard capability slugs (partial list):**
```
web-search        email              calendar-read      calendar-write
file-read         file-write         database-read      database-write
code-execution    browser-control    image-generation   audio-transcription
payment-processing order-management  crm-read           crm-write
messaging         notifications      analytics          monitoring
```

### 4.5 `tools`
Array of tool definition objects. Each describes one way an agent can invoke this service. A service may list multiple protocols (e.g., both MCP and REST).

#### `tools[].protocol` values:
| Value | Meaning |
|-------|---------|
| `mcp` | Model Context Protocol server |
| `rest` | Standard REST/HTTP API |
| `openapi` | REST API with OpenAPI schema at `schema_url` |
| `graphql` | GraphQL API |
| `grpc` | gRPC service |
| `a2a` | Google Agent-to-Agent protocol |
| `custom` | Described at `docs_url` |

### 4.6 `auth`

#### `auth.type` values:
| Value | Meaning |
|-------|---------|
| `none` | No authentication required |
| `api_key` | Static API key in header or query param |
| `oauth2` | OAuth 2.0 with PKCE recommended |
| `mtls` | Mutual TLS |
| `custom` | Described at `docs_url` |

### 4.7 `agent_hints`
Optional hints that help agents behave correctly:

- **`preferred_invocation`** — If both MCP and REST are listed, which should agents prefer?
- **`destructive_actions_require_confirmation`** — Agent SHOULD pause and confirm with user before actions that cannot be undone
- **`pii_in_requests`** — Warns agents that requests will contain PII; relevant for logging and privacy policies

### 4.8 `trust.verified_by`
Array of registry URLs that have independently verified this manifest. Agents MAY give additional trust weight to verified services. Verification is not self-attestable — it must be performed by the listed registry.

---

## 5. Agent Behavior Requirements

Agents consuming `agent.json` SHOULD follow these rules:

1. **Fetch before assuming.** Always fetch `/.well-known/agent.json` before attempting to use an unknown service. Do not guess at API endpoints.
2. **Respect `status: deprecated`.** Do not use deprecated services for new workflows. Warn if an existing workflow depends on one.
3. **Honor rate limits.** Use `rate_limits` to plan request cadence. Implement exponential backoff using `retry_after_header`.
4. **Confirm destructive actions.** If `agent_hints.destructive_actions_require_confirmation` is `true`, pause before write/delete operations and verify intent with the user or orchestrator.
5. **Prefer `preferred_invocation`.** When multiple protocols are listed, use the service's stated preference unless the agent's framework doesn't support it.
6. **Cache with freshness.** Cache `agent.json` for no longer than 24 hours. Respect `Cache-Control` headers.

---

## 6. Service Publisher Requirements

Services publishing `agent.json` MUST:

1. Serve the file at exactly `/.well-known/agent.json` (not a redirect target)
2. Keep the manifest accurate — outdated manifests that mislead agents are a trust violation
3. Honor the stated `rate_limits` — don't publish limits you don't enforce
4. Not claim `verified_by` registries that haven't verified the service

Services SHOULD:
1. Submit to at least one registry listed in `discovery.listed_in`
2. Maintain a `changelog_url` so agents can detect breaking changes
3. Provide an `agent_terms_url` if their standard TOS doesn't cover automated access

---

## 7. Versioning & Evolution

The spec uses semantic versioning. Rules for evolution:

- **Patch (0.1.x):** Clarifications, examples, editorial fixes. No schema changes.
- **Minor (0.x.0):** New optional fields. Backward compatible. Agents MUST ignore unknown fields.
- **Major (x.0.0):** Breaking changes. `spec_version` bump required. Transition period of 12 months minimum before old versions are retired.

Agents MUST NOT reject manifests with unknown fields (forward compatibility).

---

## 8. Full Example — Real Service

```json
{
  "$schema": "https://agentappstore.dev/schema/agent-json/0.1.0",
  "spec_version": "0.1.0",
  "name": "Resend Email API",
  "description": "Send transactional and marketing email via REST API or MCP. Supports React Email templates, scheduling up to 72 hours ahead, webhooks for delivery events, and domain-level analytics.",
  "homepage": "https://resend.com",
  "logo_url": "https://resend.com/static/favicon.png",
  "contact": "support@resend.com",
  "capabilities": ["email", "notifications", "analytics"],
  "tags": ["email", "transactional", "smtp", "react-email", "webhooks"],
  "tools": [
    {
      "protocol": "mcp",
      "name": "resend-mcp",
      "description": "Send email, manage domains, list audiences, and retrieve analytics through MCP tool calls.",
      "endpoint": "npx resend-mcp",
      "docs_url": "https://resend.com/docs/mcp"
    },
    {
      "protocol": "openapi",
      "name": "resend-rest",
      "description": "Full REST API with OpenAPI 3.1 schema.",
      "endpoint": "https://api.resend.com",
      "schema_url": "https://resend.com/openapi.json",
      "docs_url": "https://resend.com/docs/api-reference"
    }
  ],
  "auth": {
    "type": "api_key",
    "key_header": "Authorization",
    "key_prefix": "Bearer",
    "key_acquisition_url": "https://resend.com/api-keys"
  },
  "rate_limits": {
    "requests_per_minute": 100,
    "requests_per_day": 100000,
    "burst_limit": 20,
    "retry_after_header": "Retry-After"
  },
  "agent_hints": {
    "preferred_invocation": "mcp",
    "idempotent_methods": ["GET"],
    "destructive_actions_require_confirmation": false,
    "max_concurrent_requests": 10,
    "supports_streaming": false,
    "pii_in_requests": true
  },
  "pricing": {
    "model": "per_request",
    "free_tier": true,
    "free_tier_details": "3,000 emails/month free. Paid plans from $20/month.",
    "pricing_url": "https://resend.com/pricing"
  },
  "trust": {
    "certifications": ["SOC2"],
    "terms_of_service_url": "https://resend.com/terms",
    "privacy_policy_url": "https://resend.com/privacy"
  },
  "discovery": {
    "listed_in": ["https://agentappstore.dev"],
    "registry_ids": {
      "agentappstore": "resend-mcp"
    }
  },
  "version": "1.0.0",
  "status": "stable",
  "changelog_url": "https://resend.com/changelog"
}
```

---

## 9. Minimal Example — Simple Service

```json
{
  "spec_version": "0.1.0",
  "name": "Weather Now API",
  "description": "Returns current weather and 7-day forecast for any location by coordinates or city name. No auth required.",
  "contact": "api@weather-now.example",
  "capabilities": ["weather-lookup"],
  "tools": [
    {
      "protocol": "rest",
      "name": "weather-rest",
      "endpoint": "https://api.weather-now.example/v1",
      "docs_url": "https://weather-now.example/docs"
    }
  ],
  "auth": { "type": "none" },
  "pricing": { "model": "free", "free_tier": true }
}
```

---

## 10. Capability Taxonomy (v0.1)

The following slugs are part of the official AgentStore taxonomy. Services SHOULD use these where applicable.

### Search & Data
`web-search` `semantic-search` `rag` `database-read` `database-write` `data-extraction` `real-time-data`

### Communication
`email` `sms` `messaging` `notifications` `webhooks` `video-call`

### Productivity
`calendar-read` `calendar-write` `task-management` `document-read` `document-write` `note-taking` `project-management`

### Developer Tools
`code-execution` `repo-management` `issue-tracking` `ci-cd` `code-search` `dependency-management`

### Infrastructure
`container-management` `cloud-provisioning` `monitoring` `logging` `alerting` `secrets-management`

### AI & ML
`text-generation` `image-generation` `audio-transcription` `embedding` `classification` `fine-tuning`

### Commerce
`payment-processing` `order-management` `inventory-lookup` `shipping` `invoicing`

### Identity & Security
`authentication` `authorization` `audit-logging` `vulnerability-scanning`

### Design
`design-inspection` `asset-management` `token-extraction` `prototype-generation`

### Media
`image-processing` `video-processing` `audio-processing` `file-conversion`

---

## 11. Governance

This specification is maintained by the [Agent App Store](https://agentappstore.dev) project. The following principles govern its evolution:

1. **No single vendor controls the spec.** Changes require community review via GitHub issues and a 30-day comment period for non-patch changes.
2. **Backward compatibility is a hard constraint.** Breaking changes require a minimum 12-month deprecation window.
3. **The spec is CC0.** Anyone may implement, fork, or extend it without permission or attribution.
4. **Conflicts of interest are disclosed.** Spec contributors who work for tool vendors must disclose affiliation in PRs.

### How to Contribute

1. Open an issue at [github.com/robertclapp/agent-app-store](https://github.com/robertclapp/agent-app-store/issues) with the `spec` label
2. Discuss the change during the comment period
3. Submit a PR with spec changes, schema updates, and at least one example

---

## 12. IETF Registration (Proposed)

The following is a proposed `.well-known` URI registration per [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615):

```
URI suffix: agent
Change controller: Agent App Store Project <spec@agentappstore.dev>
Specification document: https://agentappstore.dev/spec
Status: Permanent (proposed)
Related information: This URI suffix is intended for use by AI agents
  to discover machine-readable service capability manifests.
```

---

## Appendix A: Relation to Existing Standards

| Standard | Relation |
|----------|----------|
| `robots.txt` (RFC 9309) | Analogous pattern — well-known file that machines read before interacting with a service. `agent.json` is the agentic equivalent. |
| `security.txt` (RFC 9116) | Same `.well-known` pattern for a different audience (security researchers). Direct inspiration. |
| `ai-plugin.json` (OpenAI, deprecated) | Previous attempt at plugin discovery. `agent.json` is protocol-agnostic and not tied to any single LLM provider. |
| OpenAPI / Swagger | Complementary. `agent.json` points to OpenAPI schemas via `tools[].schema_url` but does not replace them. |
| MCP (Anthropic) | Complementary. MCP defines the tool invocation protocol; `agent.json` defines how agents discover that an MCP server exists. |
| Google A2A | Complementary. `agent.json` can reference A2A endpoints alongside MCP and REST. |
| Schema.org | `agent.json` intentionally avoids JSON-LD complexity in favor of simplicity. A Schema.org mapping may be defined in a future version. |

---

## Appendix B: JSON Schema

The authoritative JSON Schema for validating `agent.json` manifests is maintained at:

```
https://agentappstore.dev/schema/agent-json/0.1.0
```

Validators, SDKs, and CI integrations are available at [github.com/robertclapp/agent-app-store](https://github.com/robertclapp/agent-app-store).

---

*This specification is released into the public domain under CC0 1.0. No rights reserved.*
