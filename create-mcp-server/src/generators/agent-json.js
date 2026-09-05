/**
 * agent.json Generator
 * Produces a /.well-known/agent.json manifest from server metadata
 */

import fs from 'fs-extra';
import path from 'path';

export async function generateAgentJson({ meta, outputDir }) {
  const packageName = normalizePackageName(meta.name);
  const displayName = normalizeName(meta.api?.info?.title, packageName);
  const manifest = {
    $schema: 'https://agentappstore.dev/schema/agent-json/0.1.0',
    spec_version: '0.1.0',
    name: displayName,
    description: normalizeDescription(meta.description, `MCP server for ${packageName}`),
    contact: normalizeText(meta.api?.info?.contact?.email, 320) || 'maintainer@example.com',
    capabilities: Array.isArray(meta.capabilities)
      ? meta.capabilities.filter(value => typeof value === 'string').map(value => value.slice(0, 128))
      : [],
    tools: [
      {
        protocol: 'mcp',
        name: packageName,
        description: `MCP server with ${Array.isArray(meta.tools) ? meta.tools.length : 0} tools`,
        endpoint: `npx ${packageName}`,
      },
    ],
    auth: buildAuth(meta.authType, meta.api),
    pricing: {
      model: 'free',
      free_tier: true,
    },
    status: 'beta',
    version: normalizeVersion(meta.api?.info?.version),
    discovery: {
      listed_in: [],
    },
  };

  const baseUrl = safeUri(meta.baseUrl);
  if (baseUrl) {
    manifest.tools.push({
      protocol: 'openapi',
      name: `${packageName}-rest`,
      description: 'Direct REST API access',
      endpoint: baseUrl,
      ...(safeUri(meta.api?.info?.['x-docs-url'])
        ? { docs_url: safeUri(meta.api.info['x-docs-url']) }
        : {}),
    });
  }

  await fs.ensureDir(path.join(outputDir, '.well-known'));
  await fs.writeJson(
    path.join(outputDir, '.well-known', 'agent.json'),
    manifest,
    { spaces: 2 }
  );

  return manifest;
}

function buildAuth(authType, api) {
  switch (authType) {
    case 'api_key': {
      const scheme = findScheme(api, 'apiKey');
      if (scheme?.in === 'query') {
        return {
          type: 'api_key',
          key_query_param: scheme.name || 'api_key',
        };
      }
      // Keep in sync with the generated client (openapi.js), which sends
      // cookie keys in the Cookie header — a manifest that calls this a
      // plain header would direct consumers to authenticate incorrectly.
      if (scheme?.in === 'cookie') {
        return {
          type: 'api_key',
          key_cookie: scheme.name || 'api_key',
        };
      }
      return {
        type: 'api_key',
        key_header: scheme?.name || 'X-API-Key',
      };
    }
    case 'bearer':
      return {
        type: 'api_key',
        key_header: 'Authorization',
        key_prefix: 'Bearer',
      };
    case 'oauth2': {
      const scheme = findScheme(api, 'oauth2');
      const flow = oauthFlow(scheme);
      const authorizationUrl = safeUri(flow.authorizationUrl || scheme?.authorizationUrl);
      const tokenUrl = safeUri(flow.tokenUrl || scheme?.tokenUrl);
      return {
        type: 'oauth2',
        oauth2: {
          ...(authorizationUrl ? { authorization_url: authorizationUrl } : {}),
          ...(tokenUrl ? { token_url: tokenUrl } : {}),
          scopes: normalizeScopes(flow.scopes || scheme?.scopes),
        },
      };
    }
    default:
      return { type: 'none' };
  }
}

function oauthFlow(scheme) {
  if (!scheme || typeof scheme !== 'object') return {};
  const flows = scheme.flows;
  if (flows && typeof flows === 'object') {
    return flows.authorizationCode
      || flows.clientCredentials
      || flows.password
      || flows.implicit
      || {};
  }
  // Swagger 2 stores flow URLs and scopes directly on the scheme.
  return scheme;
}

function normalizeScopes(scopes) {
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) return {};
  return Object.fromEntries(Object.entries(scopes)
    .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
    .map(([key, value]) => [key.slice(0, 256), value.slice(0, 500)]));
}

function normalizeName(value, fallback) {
  return (normalizeText(value, 64) || normalizeText(fallback, 64) || 'generated-mcp').slice(0, 64);
}

function normalizePackageName(value) {
  const name = normalizeText(value, 214);
  return /^[a-z0-9][a-z0-9-]{0,213}$/.test(name) ? name : 'generated-mcp';
}

function normalizeDescription(value, fallback) {
  return (normalizeText(value, 500) || normalizeText(fallback, 500) || 'Generated MCP server').slice(0, 500);
}

function normalizeVersion(value) {
  const version = normalizeText(value, 64);
  return /^\d+\.\d+\.\d+$/.test(version) ? version : '0.1.0';
}

function normalizeText(value, maxLength) {
  if (value == null) return '';
  return String(value).replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, maxLength);
}

function safeUri(value) {
  const text = normalizeText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function findScheme(api, type) {
  const schemes = api?.components?.securitySchemes || api?.securityDefinitions || {};
  return Object.values(schemes).find(s => s.type === type);
}
