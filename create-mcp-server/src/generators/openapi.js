/**
 * OpenAPI → MCP Server Generator
 *
 * Takes an OpenAPI 3.x or Swagger 2.x spec and generates:
 * - A complete MCP server with one tool per API endpoint
 * - TypeScript or JavaScript source with JSON Schema tool inputs
 * - An API client with environment-based authentication
 * - README with usage instructions
 */

import fs from 'fs-extra';
import path from 'path';
import SwaggerParser from '@apidevtools/swagger-parser';

export async function generateFromOpenAPI({ specSource, name, outputDir, lang }) {
  let api;
  try {
    api = await SwaggerParser.dereference(specSource);
  } catch (err) {
    throw new Error(`Failed to parse OpenAPI spec: ${err.message}`);
  }

  await fs.ensureDir(outputDir);
  await fs.ensureDir(path.join(outputDir, 'src'));
  await fs.ensureDir(path.join(outputDir, '.well-known'));

  const tools = extractTools(api);
  const files = [];

  // --- package.json ---
  const pkgJson = generatePackageJson(name, api, lang);
  await fs.writeJson(path.join(outputDir, 'package.json'), pkgJson, { spaces: 2 });
  files.push('package.json');

  // --- tsconfig.json (if TypeScript) ---
  if (lang === 'typescript') {
    await fs.writeJson(path.join(outputDir, 'tsconfig.json'), generateTsConfig(), { spaces: 2 });
    files.push('tsconfig.json');
  }

  // --- Main server file ---
  const serverCode = generateServerCode({ name, api, tools, lang });
  const ext = lang === 'typescript' ? 'ts' : 'js';
  await fs.writeFile(path.join(outputDir, `src/index.${ext}`), serverCode);
  files.push(`src/index.${ext}`);

  // --- Tools file ---
  const toolsCode = generateToolsCode({ tools, lang });
  await fs.writeFile(path.join(outputDir, `src/tools.${ext}`), toolsCode);
  files.push(`src/tools.${ext}`);

  // --- API client ---
  const clientCode = generateApiClient({ api, lang });
  await fs.writeFile(path.join(outputDir, `src/client.${ext}`), clientCode);
  files.push(`src/client.${ext}`);

  // --- .env.example ---
  const envContent = generateEnvExample(api, name);
  await fs.writeFile(path.join(outputDir, '.env.example'), envContent);
  files.push('.env.example');

  // --- .gitignore ---
  await fs.writeFile(path.join(outputDir, '.gitignore'), 'node_modules/\ndist/\n.env\n');
  files.push('.gitignore');

  // --- README ---
  const readme = generateReadme({ name, api, tools, lang });
  await fs.writeFile(path.join(outputDir, 'README.md'), readme);
  files.push('README.md');

  return {
    name,
    api,
    tools,
    files,
    description: api.info?.description || `MCP server for ${api.info?.title || name}`,
    capabilities: inferCapabilities(api),
    baseUrl: getBaseUrl(api),
    authType: inferAuthType(api),
  };
}

// --- Extract tools from OpenAPI paths ---
function extractTools(api) {
  const tools = [];
  const paths = api.paths || {};

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    const methods = ['get', 'post', 'put', 'patch', 'delete'];
    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;

      const toolName = generateToolName(method, pathStr, op.operationId);
      const description = op.summary || op.description || `${method.toUpperCase()} ${pathStr}`;
      const params = extractParams(op, pathStr, pathItem.parameters || []);

      tools.push({
        name: toolName,
        method: method.toUpperCase(),
        path: pathStr,
        description,
        params,
        operationId: op.operationId,
        tags: op.tags || [],
        deprecated: op.deprecated || false,
      });
    }
  }

  return tools;
}

function generateToolName(method, pathStr, operationId) {
  if (operationId) {
    return operationId.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').toLowerCase();
  }
  const cleaned = pathStr
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${method}_${cleaned}`.toLowerCase();
}

function extractParams(op, pathStr, pathLevelParams = []) {
  const params = [];
  // OpenAPI allows parameters to be declared on the path item and overridden
  // by an operation. Resolve both so generated input schemas match the URL.
  const declaredParams = new Map();
  for (const p of [...pathLevelParams, ...(op.parameters || [])]) {
    declaredParams.set(`${p.in}:${p.name}`, p);
  }

  // Path parameters
  const pathParams = (pathStr.match(/\{([^}]+)\}/g) || []).map(p => p.slice(1, -1));
  for (const pName of pathParams) {
    const declared = declaredParams.get(`path:${pName}`);
    params.push({
      name: pName,
      in: 'path',
      required: true,
      type: declared?.schema?.type || 'string',
      description: declared?.description || `Path parameter: ${pName}`,
    });
  }

  // Query parameters
  for (const p of declaredParams.values()) {
    if (p.in === 'query') {
      params.push({
        name: p.name,
        in: 'query',
        required: p.required || false,
        type: p.schema?.type || 'string',
        description: p.description || p.name,
      });
    }
  }

  // Request body
  if (op.requestBody) {
    const content = op.requestBody.content || {};
    const schema = content['application/json']?.schema;
    if (schema?.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        params.push({
          name: propName,
          in: 'body',
          required: (schema.required || []).includes(propName),
          type: propSchema.type || 'string',
          description: propSchema.description || propName,
        });
      }
    }
  }

  return params;
}

function generateServerCode({ name, api, tools, lang }) {
  const ts = lang === 'typescript';
  return `${ts ? '// @ts-check\n' : ''}/**
 * ${name} MCP Server
 * Generated by create-mcp-server — https://agentappstore.dev
 * Based on: ${api.info?.title || name} v${api.info?.version || '1.0.0'}
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tools, callTool } from './tools.js';

const server = new Server(
  {
    name: '${name}',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return callTool(name, args || {});
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('${name} MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
`;
}

function generateToolsCode({ tools, lang }) {
  const ts = lang === 'typescript';
  const MAX_TOOLS = 50;
  if (tools.length > MAX_TOOLS) {
    console.warn(`Warning: API has ${tools.length} endpoints but MCP servers are limited to ${MAX_TOOLS} tools. ${tools.length - MAX_TOOLS} endpoints were omitted.`);
  }
  const toolDefs = tools.slice(0, MAX_TOOLS).map(tool => {
    const inputSchema = {
      type: 'object',
      properties: {},
      required: [],
    };
    for (const p of tool.params) {
      inputSchema.properties[p.name] = {
        type: p.type === 'integer' ? 'number' : (p.type || 'string'),
        description: p.description,
      };
      if (p.required) inputSchema.required.push(p.name);
    }

    return `  {
    name: ${JSON.stringify(tool.name)},
    description: ${JSON.stringify(tool.description)},
    inputSchema: ${JSON.stringify(inputSchema, null, 6).replace(/^/gm, '    ').trim()},
  }`;
  });

  const callCases = tools.slice(0, MAX_TOOLS).map(tool => {
    const pathWithParams = tool.path.replace(
      /\{([^}]+)\}/g,
      (_, name) => '${encodeURIComponent(String(args[' + JSON.stringify(name) + ']))}'
    );
    const queryParams = tool.params.filter(p => p.in === 'query');
    const bodyParams = tool.params.filter(p => p.in === 'body');
    const bodyParamNames = JSON.stringify(bodyParams.map(p => p.name));

    return `    case ${JSON.stringify(tool.name)}: {
      ${queryParams.length ? `const query = new URLSearchParams(${JSON.stringify(queryParams.map(p => p.name))}.filter(k => args[k] != null).reduce((o, k) => ({ ...o, [k]: args[k] }), {}));` : ''}
      ${bodyParams.length ? `const body = Object.fromEntries(${bodyParamNames}.filter(k => args[k] !== undefined).map(k => [k, args[k]]));` : ''}
      const res = await apiCall(
        ${JSON.stringify(tool.method)},
        \`${pathWithParams}\`${queryParams.length ? ' + (query.toString() ? \'?\' + query : \'\')' : ''},
        ${bodyParams.length ? 'body' : 'undefined'}
      );
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }`;
  });

  return `import { apiCall } from './client.js';

export const tools = [
${toolDefs.join(',\n')}
];

export async function callTool(name${ts ? ': string' : ''}, args${ts ? ': Record<string, unknown>' : ''}) {
  switch (name) {
${callCases.join('\n')}
    default:
      throw new Error(\`Unknown tool: \${name}\`);
  }
}
`;
}

function generateApiClient({ api, lang }) {
  const ts = lang === 'typescript';
  const baseUrl = getBaseUrl(api);
  const authType = inferAuthType(api);

  return `/**
 * API client for ${api.info?.title || 'API'}
 * Base URL: ${baseUrl}
 */

const BASE_URL = process.env.API_BASE_URL || ${JSON.stringify(baseUrl)};
${authType === 'api_key' ? "const API_KEY = process.env.API_KEY || '';" : ''}
${authType === 'bearer' ? "const API_TOKEN = process.env.API_TOKEN || '';" : ''}

export async function apiCall(
  method${ts ? ': string' : ''},
  path${ts ? ': string' : ''},
  body${ts ? ': unknown' : ''} = undefined
)${ts ? ': Promise<unknown>' : ''} {
  const url = BASE_URL.replace(/\\/$/, '') + path;

  const headers${ts ? ': Record<string, string>' : ''} = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'mcp-server/0.1.0',
${authType === 'api_key' ? "    'X-API-Key': API_KEY," : ''}
${authType === 'bearer' ? "    'Authorization': `Bearer ${API_TOKEN}`," : ''}
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(\`API error \${res.status}: \${text}\`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return res.json();
  }
  return res.text();
}
`;
}

function generatePackageJson(name, api, lang) {
  const scripts = lang === 'typescript'
    ? {
        build: 'tsc',
        start: 'node dist/index.js',
        dev: 'tsx src/index.ts',
      }
    : {
        start: 'node src/index.js',
        dev: 'node --watch src/index.js',
      };

  return {
    name,
    version: '0.1.0',
    description: api.info?.description || `MCP server for ${api.info?.title || name}`,
    type: 'module',
    scripts,
    dependencies: {
      '@modelcontextprotocol/sdk': '^1.0.0',
      'dotenv': '^16.0.0',
    },
    devDependencies: lang === 'typescript'
      ? { typescript: '^5.0.0', tsx: '^4.0.0', '@types/node': '^20.0.0' }
      : {},
  };
}

function generateTsConfig() {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src/**/*'],
  };
}

function generateEnvExample(api, name) {
  const authType = inferAuthType(api);
  const baseUrl = getBaseUrl(api);
  return [
    `# ${name} MCP Server — Environment Variables`,
    `# Copy this to .env and fill in your values`,
    '',
    `API_BASE_URL=${baseUrl}`,
    authType === 'api_key' ? 'API_KEY=your-api-key-here' : '',
    authType === 'bearer' ? 'API_TOKEN=your-bearer-token-here' : '',
    authType === 'oauth2' ? 'CLIENT_ID=\nCLIENT_SECRET=\nACCESS_TOKEN=' : '',
  ].filter(Boolean).join('\n');
}

function generateReadme({ name, api, tools, lang }) {
  const entryPoint = lang === 'typescript' ? 'dist/index.js' : 'src/index.js';
  return `# ${name}

MCP server for [${api.info?.title || name}](${api.info?.['x-homepage'] || '#'}).
Generated by [create-mcp-server](https://agentappstore.dev) — Agent App Store.

## Quick Start

\`\`\`bash
npm install
cp .env.example .env   # fill in your API credentials
${lang === 'typescript' ? 'npm run build\n' : ''}npm run dev
\`\`\`

## Available Tools (${tools.length})

| Tool | Method | Path | Description |
|------|--------|------|-------------|
${tools.slice(0, 20).map(t =>
  `| \`${t.name}\` | ${t.method} | \`${t.path}\` | ${t.description.slice(0, 60)} |`
).join('\n')}
${tools.length > 20 ? `\n_...and ${tools.length - 20} more_\n` : ''}

## Claude Desktop Config

Add to \`~/Library/Application Support/Claude/claude_desktop_config.json\`:

\`\`\`json
{
  "mcpServers": {
    "${name}": {
      "command": "node",
      "args": ["/absolute/path/to/${name}/${entryPoint}"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}
\`\`\`

## Agent Discovery

This server publishes a \`/.well-known/agent.json\` manifest. Any agent can discover its capabilities at that path.

## Published by

[Agent App Store](https://agentappstore.dev) — the protocol-agnostic registry for agentic tools.
`;
}

function getBaseUrl(api) {
  if (api.servers?.[0]?.url) return api.servers[0].url;
  if (api.host) return `https://${api.host}${api.basePath || ''}`;
  return 'https://api.example.com';
}

function inferAuthType(api) {
  const secSchemes = api.components?.securitySchemes || api.securityDefinitions || {};
  for (const scheme of Object.values(secSchemes)) {
    if (scheme.type === 'apiKey') return 'api_key';
    if (scheme.type === 'oauth2') return 'oauth2';
    if (scheme.type === 'http' && scheme.scheme === 'bearer') return 'bearer';
  }
  return 'none';
}

function inferCapabilities(api) {
  const caps = new Set();
  const allText = JSON.stringify(api).toLowerCase();
  const capMap = {
    'email': ['email', 'mail', 'smtp'],
    'messaging': ['message', 'chat', 'slack', 'discord'],
    'payment-processing': ['payment', 'charge', 'invoice', 'stripe', 'billing'],
    'order-management': ['order', 'cart', 'checkout'],
    'database-read': ['query', 'search', 'list', 'get'],
    'database-write': ['create', 'update', 'delete', 'post', 'put'],
    'file-read': ['file', 'download', 'document'],
    'file-write': ['upload', 'file', 'attachment'],
    'monitoring': ['metric', 'alert', 'monitor', 'health'],
    'analytics': ['analytic', 'report', 'stat', 'insight'],
  };
  for (const [cap, keywords] of Object.entries(capMap)) {
    if (keywords.some(k => allText.includes(k))) caps.add(cap);
  }
  return [...caps];
}
