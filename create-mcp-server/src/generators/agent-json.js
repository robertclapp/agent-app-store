/**
 * agent.json Generator
 * Produces a /.well-known/agent.json manifest from server metadata
 */

import fs from 'fs-extra';
import path from 'path';

export async function generateAgentJson({ meta, outputDir }) {
  const manifest = {
    $schema: 'https://agentappstore.dev/schema/agent-json/0.1.0',
    spec_version: '0.1.0',
    name: meta.api?.info?.title || meta.name,
    description: (meta.description || `MCP server for ${meta.name}`).slice(0, 500),
    contact: meta.api?.info?.contact?.email || 'maintainer@example.com',
    capabilities: meta.capabilities || [],
    tools: [
      {
        protocol: 'mcp',
        name: meta.name,
        description: `MCP server with ${(meta.tools || []).length} tools`,
        endpoint: `npx ${meta.name}`,
      },
    ],
    auth: buildAuth(meta.authType, meta.api),
    pricing: {
      model: 'free',
      free_tier: true,
    },
    status: 'beta',
    version: meta.api?.info?.version || '0.1.0',
    discovery: {
      listed_in: [],
    },
  };

  if (meta.baseUrl) {
    manifest.tools.push({
      protocol: 'openapi',
      name: `${meta.name}-rest`,
      description: 'Direct REST API access',
      endpoint: meta.baseUrl,
      docs_url: meta.api?.info?.['x-docs-url'] || undefined,
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
      return {
        type: 'api_key',
        key_header: scheme?.in === 'header' ? (scheme.name || 'X-API-Key') : 'Authorization',
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
      const flows = scheme?.flows || scheme?.flow || {};
      const flow = flows.authorizationCode || flows.clientCredentials || {};
      return {
        type: 'oauth2',
        oauth2: {
          authorization_url: flow.authorizationUrl || '',
          token_url: flow.tokenUrl || '',
          scopes: flow.scopes || {},
        },
      };
    }
    default:
      return { type: 'none' };
  }
}

function findScheme(api, type) {
  const schemes = api?.components?.securitySchemes || api?.securityDefinitions || {};
  return Object.values(schemes).find(s => s.type === type);
}
