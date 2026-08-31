/**
 * OpenAPI / Swagger to MCP server generator.
 *
 * Treat the entire source document as untrusted. Every value that enters
 * generated JavaScript is serialized as data, never interpolated as code.
 */

import fs from 'fs-extra';
import path from 'path';
import SwaggerParser from '@apidevtools/swagger-parser';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

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
  const ext = lang === 'typescript' ? 'ts' : 'js';

  await fs.writeJson(path.join(outputDir, 'package.json'), generatePackageJson(name, api, lang), { spaces: 2 });
  files.push('package.json');

  if (lang === 'typescript') {
    await fs.writeJson(path.join(outputDir, 'tsconfig.json'), generateTsConfig(), { spaces: 2 });
    files.push('tsconfig.json');
  }

  await fs.writeFile(path.join(outputDir, `src/index.${ext}`), generateServerCode({ name, api, lang }));
  files.push(`src/index.${ext}`);
  await fs.writeFile(path.join(outputDir, `src/tools.${ext}`), generateToolsCode({ tools, lang }));
  files.push(`src/tools.${ext}`);
  await fs.writeFile(path.join(outputDir, `src/client.${ext}`), generateApiClient({ api, lang }));
  files.push(`src/client.${ext}`);
  await fs.writeFile(path.join(outputDir, '.env.example'), generateEnvExample(api, name));
  files.push('.env.example');
  await fs.writeFile(path.join(outputDir, '.gitignore'), 'node_modules/\ndist/\n.env\n');
  files.push('.gitignore');
  await fs.writeFile(path.join(outputDir, 'README.md'), generateReadme({ name, api, tools, lang }));
  files.push('README.md');

  return {
    name,
    api,
    tools,
    files,
    description: String(api.info?.description || `MCP server for ${api.info?.title || name}`),
    capabilities: inferCapabilities(api),
    baseUrl: getBaseUrl(api),
    authType: inferAuthType(api),
  };
}

function extractTools(api) {
  const tools = [];
  for (const [pathValue, pathItem] of Object.entries(api.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      const { params, bodyType } = extractParams(operation, pathValue, pathItem.parameters || [], api);
      assignArgumentNames(params);
      tools.push({
        name: generateToolName(method, pathValue, operation.operationId),
        method: method.toUpperCase(),
        path: pathValue,
        description: String(operation.summary || operation.description || `${method.toUpperCase()} ${pathValue}`),
        params,
        bodyType,
        operationId: operation.operationId,
        tags: operation.tags || [],
        deprecated: operation.deprecated || false,
      });
    }
  }

  const seen = new Set();
  for (const tool of tools) {
    if (!tool.name || seen.has(tool.name)) {
      throw new Error(`OpenAPI operations produce a duplicate or empty tool name: ${tool.name || '(empty)'}`);
    }
    seen.add(tool.name);
  }
  return tools;
}

function generateToolName(method, pathValue, operationId) {
  if (operationId) {
    return String(operationId).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 128).toLowerCase();
  }
  const cleaned = pathValue
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${method}_${cleaned}`.slice(0, 128).toLowerCase();
}

function extractParams(operation, pathValue, pathLevelParams, api) {
  const params = [];
  const declared = new Map();
  for (const parameter of [...pathLevelParams, ...(operation.parameters || [])]) {
    if (parameter && typeof parameter === 'object') {
      declared.set(`${parameter.in}:${parameter.name}`, parameter);
    }
  }

  const pathNames = (pathValue.match(/\{([^}]+)\}/g) || []).map(value => value.slice(1, -1));
  for (const name of pathNames) {
    params.push(makeParameter(declared.get(`path:${name}`) || {}, name, 'path', true));
  }
  for (const parameter of declared.values()) {
    if (['query', 'header', 'cookie'].includes(parameter.in)) {
      params.push(makeParameter(parameter, parameter.name, parameter.in, Boolean(parameter.required)));
    }
  }

  let bodyType = 'json';
  if (operation.requestBody) {
    const selected = selectRequestContent(operation.requestBody.content || {});
    if (selected) {
      bodyType = selected.bodyType;
      addBodyParams(params, selected.schema, selected.location, Boolean(operation.requestBody.required));
    }
  } else {
    const bodyParam = [...declared.values()].find(parameter => parameter.in === 'body');
    if (bodyParam) addBodyParams(params, bodyParam.schema || {}, 'body', Boolean(bodyParam.required));

    const formParams = [...declared.values()].filter(parameter => parameter.in === 'formData');
    if (formParams.length) {
      const consumes = operation.consumes || api.consumes || [];
      bodyType = consumes.includes('multipart/form-data') ? 'multipart' : 'form';
      for (const parameter of formParams) {
        params.push(makeParameter(parameter, parameter.name, 'form', Boolean(parameter.required)));
      }
    }
  }
  return { params, bodyType };
}

function makeParameter(parameter, name, location, required) {
  const rawSchema = parameter.schema || {
    type: parameter.type || 'string',
    format: parameter.format,
    items: parameter.items,
    enum: parameter.enum,
    default: parameter.default,
  };
  return {
    name,
    wireName: name,
    in: location,
    required,
    schema: toInputSchema(rawSchema),
    description: String(parameter.description || name),
  };
}

function selectRequestContent(content) {
  const priorities = [
    ['application/json', 'json', 'body'],
    ['multipart/form-data', 'multipart', 'form'],
    ['application/x-www-form-urlencoded', 'form', 'form'],
  ];
  for (const [mediaType, bodyType, location] of priorities) {
    if (content[mediaType]?.schema) return { schema: content[mediaType].schema, bodyType, location };
  }
  return null;
}

function addBodyParams(params, rawSchema, location, bodyRequired) {
  const schema = rawSchema || {};
  // Match toInputSchema's inference: a schema with properties and no explicit
  // type is an object, so flatten it to per-field params rather than one
  // opaque `body` argument.
  if (schema.properties && (schema.type === 'object' || schema.type === undefined)) {
    const required = new Set(schema.required || []);
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      params.push({
        name,
        wireName: name,
        in: location,
        required: required.has(name),
        schema: toInputSchema(propertySchema),
        description: String(propertySchema.description || name),
      });
    }
    return;
  }
  params.push({
    name: 'body',
    wireName: 'body',
    in: location === 'form' ? 'form_root' : 'body_root',
    required: bodyRequired,
    schema: toInputSchema(schema),
    description: String(schema.description || 'Request body'),
  });
}

function assignArgumentNames(params) {
  const counts = new Map();
  for (const parameter of params) counts.set(parameter.name, (counts.get(parameter.name) || 0) + 1);
  for (const parameter of params) {
    parameter.argName = counts.get(parameter.name) > 1 ? `${parameter.in}_${parameter.name}` : parameter.name;
  }
}

function toInputSchema(schema, seen = new WeakSet(), depth = 0) {
  if (!schema || typeof schema !== 'object') return { type: 'string' };
  if (seen.has(schema) || depth > 12) return { type: 'object' };
  seen.add(schema);
  const result = {};
  const scalarKeys = [
    'type', 'format', 'description', 'title', 'default', 'enum', 'const',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength',
    'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
    'minProperties', 'maxProperties', 'readOnly', 'writeOnly',
  ];
  for (const key of scalarKeys) if (schema[key] !== undefined) result[key] = schema[key];
  if (result.type === 'file') {
    result.type = 'string';
    result.format = 'binary';
  }
  if (!result.type && !schema.oneOf && !schema.anyOf && !schema.allOf) {
    result.type = schema.properties ? 'object' : 'string';
  }
  if (schema.nullable) {
    const baseType = result.type || 'string';
    result.type = Array.isArray(baseType) ? [...new Set([...baseType, 'null'])] : [baseType, 'null'];
  }
  if (schema.required) result.required = [...schema.required];
  if (schema.items) result.items = toInputSchema(schema.items, seen, depth + 1);
  if (schema.properties) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(
      ([key, value]) => [key, toInputSchema(value, seen, depth + 1)],
    ));
  }
  for (const composition of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[composition])) {
      result[composition] = schema[composition].map(value => toInputSchema(value, seen, depth + 1));
    }
  }
  if (typeof schema.additionalProperties === 'boolean') result.additionalProperties = schema.additionalProperties;
  else if (schema.additionalProperties) {
    result.additionalProperties = toInputSchema(schema.additionalProperties, seen, depth + 1);
  }
  seen.delete(schema);
  return result;
}

function generateServerCode({ name, api, lang }) {
  const ts = lang === 'typescript';
  const safeName = JSON.stringify(String(name));
  return `${ts ? '// @ts-check\n' : ''}/**
 * ${safeComment(name)} MCP Server
 * Generated by create-mcp-server — https://agentappstore.dev
 * Based on: ${safeComment(api.info?.title || name)} v${safeComment(api.info?.version || '1.0.0')}
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tools, callTool } from './tools.js';

const server = new Server({ name: ${safeName}, version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: args } = request.params;
  return callTool(toolName, args || {});
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(${JSON.stringify(`${name} MCP server running on stdio`)});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
`;
}

function generateToolsCode({ tools, lang }) {
  const ts = lang === 'typescript';
  const toolDefinitions = tools.map(tool => {
    const inputSchema = {
      type: 'object',
      properties: Object.create(null),
      required: [],
    };
    for (const parameter of tool.params) {
      inputSchema.properties[parameter.argName] = { ...parameter.schema, description: parameter.description };
      if (parameter.required) inputSchema.required.push(parameter.argName);
    }
    return `  {
    name: ${JSON.stringify(tool.name)},
    description: ${JSON.stringify(tool.description)},
    inputSchema: ${JSON.stringify(inputSchema, null, 4).replace(/^/gm, '    ').trim()},
  }`;
  });
  const cases = tools.map(tool => generateCallCase(tool, ts));
  return `import { apiCall } from './client.js';

function appendParam(params${ts ? ': URLSearchParams' : ''}, name${ts ? ': string' : ''}, value${ts ? ': unknown' : ''}) {
  if (value == null) return;
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) params.append(name, typeof item === 'object' ? JSON.stringify(item) : String(item));
}

function headerValue(value${ts ? ': unknown' : ''})${ts ? ': string' : ''} {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function compactObject(entries${ts ? ': [string, unknown][]' : ''})${ts ? ': Record<string, unknown>' : ''} {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export const tools = [
${toolDefinitions.join(',\n')}
];

export async function callTool(name${ts ? ': string' : ''}, args${ts ? ': Record<string, unknown>' : ''}) {
  switch (name) {
${cases.join('\n')}
    default:
      throw new Error(\`Unknown tool: \${name}\`);
  }
}
`;
}

function generateCallCase(tool, ts) {
  const pathMap = Object.fromEntries(tool.params.filter(param => param.in === 'path').map(param => [param.wireName, param.argName]));
  const queryParams = tool.params.filter(param => param.in === 'query');
  const headerParams = tool.params.filter(param => param.in === 'header');
  const cookieParams = tool.params.filter(param => param.in === 'cookie');
  const bodyParams = tool.params.filter(param => param.in === 'body');
  const rootBody = tool.params.find(param => param.in === 'body_root');
  const formParams = tool.params.filter(param => param.in === 'form');
  const rootForm = tool.params.find(param => param.in === 'form_root');

  const queryLines = queryParams.map(param => `      appendParam(query, ${JSON.stringify(param.wireName)}, args[${JSON.stringify(param.argName)}]);`).join('\n');
  const headerLines = headerParams.map(param => `      if (args[${JSON.stringify(param.argName)}] != null) requestHeaders[${JSON.stringify(param.wireName)}] = headerValue(args[${JSON.stringify(param.argName)}]);`).join('\n');
  const cookieLines = cookieParams.map(param => `      if (args[${JSON.stringify(param.argName)}] != null) cookies.push(encodeURIComponent(${JSON.stringify(param.wireName)}) + '=' + encodeURIComponent(headerValue(args[${JSON.stringify(param.argName)}])));`).join('\n');

  let bodyExpression = 'undefined';
  if (rootBody) bodyExpression = `args[${JSON.stringify(rootBody.argName)}]`;
  else if (bodyParams.length) {
    bodyExpression = objectFromParams(bodyParams);
  } else if (rootForm) bodyExpression = `args[${JSON.stringify(rootForm.argName)}]`;
  else if (formParams.length) {
    bodyExpression = objectFromParams(formParams);
  }

  return `    case ${JSON.stringify(tool.name)}: {
      const pathArgs${ts ? ': Record<string, string>' : ''} = ${JSON.stringify(pathMap)};
      const requestPath = ${JSON.stringify(tool.path)}.replace(
        /\\{([^}]+)\\}/g,
        (${ts ? '_: string, key: string' : '_, key'}) => encodeURIComponent(String(args[pathArgs[key] || key])),
      );
      const query = new URLSearchParams();
${queryLines}
      const requestHeaders${ts ? ': Record<string, string>' : ''} = Object.create(null);
${headerLines}
      const cookies${ts ? ': string[]' : ''} = [];
${cookieLines}
      if (cookies.length) requestHeaders.Cookie = cookies.join('; ');
      const body = ${bodyExpression};
      const res = await apiCall(
        ${JSON.stringify(tool.method)},
        requestPath + (query.toString() ? '?' + query : ''),
        { body, headers: requestHeaders, bodyType: ${JSON.stringify(tool.bodyType)} },
      );
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }`;
}

function objectFromParams(params) {
  const entries = params.map(param => `[${JSON.stringify(param.wireName)}, args[${JSON.stringify(param.argName)}]]`);
  return `compactObject([${entries.join(', ')}])`;
}

function generateApiClient({ api, lang }) {
  const ts = lang === 'typescript';
  const baseUrl = getBaseUrl(api);
  const auth = getAuthConfig(api);
  const authDeclarations = {
    api_key: "const API_KEY = process.env.API_KEY || '';",
    bearer: "const API_TOKEN = process.env.API_TOKEN || '';",
    oauth2: "const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';",
    none: '',
  }[auth.type];

  let authCode = '';
  if (auth.type === 'api_key' && auth.in === 'query') {
    authCode = `  const parsedUrl = new URL(url);\n  parsedUrl.searchParams.set(${JSON.stringify(auth.name)}, API_KEY);\n  url = parsedUrl.toString();`;
  } else if (auth.type === 'api_key' && auth.in === 'cookie') {
    // Merge rather than assign: per-operation cookie parameters arrive in
    // extraHeaders.Cookie, and this line runs after that spread.
    authCode = `  headers.Cookie = [headers.Cookie, ${JSON.stringify(`${auth.name}=`)} + encodeURIComponent(API_KEY)].filter(Boolean).join('; ');`;
  } else if (auth.type === 'api_key') authCode = `  headers[${JSON.stringify(auth.name)}] = API_KEY;`;
  else if (auth.type === 'bearer') authCode = "  headers.Authorization = `Bearer ${API_TOKEN}`;";
  else if (auth.type === 'oauth2') authCode = "  headers.Authorization = `Bearer ${ACCESS_TOKEN}`;";

  return `/**
 * API client for ${safeComment(api.info?.title || 'API')}
 * Base URL: ${safeComment(baseUrl)}
 */

const BASE_URL = process.env.API_BASE_URL || ${JSON.stringify(baseUrl)};
${authDeclarations}

export async function apiCall(
  method${ts ? ': string' : ''},
  path${ts ? ': string' : ''},
  options${ts ? ': { body?: unknown; headers?: Record<string, string>; bodyType?: string }' : ''} = {},
)${ts ? ': Promise<unknown>' : ''} {
  let url = BASE_URL.replace(/\\/$/, '') + path;
  const { body, headers: extraHeaders = {}, bodyType = 'json' } = options;
  const headers${ts ? ': Record<string, string>' : ''} = Object.assign(Object.create(null), {
    Accept: 'application/json',
    'User-Agent': 'mcp-server/0.1.0',
    ...extraHeaders,
  });
${authCode}

  let encodedBody${ts ? ': BodyInit | undefined' : ''};
  if (body != null && bodyType === 'multipart') {
    const form = new FormData();
    for (const [key, value] of bodyEntries(body)) {
      if (Array.isArray(value)) for (const item of value) form.append(key, String(item));
      else form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    encodedBody = form;
  } else if (body != null && bodyType === 'form') {
    const form = new URLSearchParams();
    for (const [key, value] of bodyEntries(body)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) form.append(key, String(item));
    }
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    encodedBody = form;
  } else if (body != null) {
    headers['Content-Type'] = 'application/json';
    encodedBody = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: encodedBody });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(\`API error \${res.status}: \${text}\`);
  }
  // HEAD and 204 responses carry no body, and some servers send an empty
  // body with a JSON content-type — res.json() would throw on all of these.
  if (method === 'HEAD' || res.status === 204) return { status: res.status };
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!text) return { status: res.status };
  return contentType.includes('application/json') ? JSON.parse(text) : text;
}

function bodyEntries(value${ts ? ': unknown' : ''})${ts ? ': [string, unknown][]' : ''} {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Form request bodies must be objects');
  }
  return Object.entries(value);
}
`;
}

function generatePackageJson(name, api, lang) {
  const scripts = lang === 'typescript'
    ? { build: 'tsc', start: 'node dist/index.js', dev: 'tsx src/index.ts' }
    : { start: 'node src/index.js', dev: 'node --watch src/index.js' };
  return {
    name,
    version: '0.1.0',
    description: String(api.info?.description || `MCP server for ${api.info?.title || name}`),
    type: 'module',
    scripts,
    dependencies: { '@modelcontextprotocol/sdk': '^1.0.0', dotenv: '^16.0.0' },
    devDependencies: lang === 'typescript' ? { typescript: '^5.0.0', tsx: '^4.0.0', '@types/node': '^20.0.0' } : {},
  };
}

function generateTsConfig() {
  return {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      outDir: './dist', rootDir: './src', strict: true, esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src/**/*'],
  };
}

function generateEnvExample(api, name) {
  const auth = getAuthConfig(api);
  const authLine = {
    api_key: 'API_KEY=your-api-key-here',
    bearer: 'API_TOKEN=your-bearer-token-here',
    oauth2: 'ACCESS_TOKEN=your-oauth-access-token-here',
    none: '',
  }[auth.type];
  return [
    `# ${singleLine(name)} MCP Server — Environment Variables`,
    '# Copy this to .env and fill in your values',
    '',
    `API_BASE_URL=${JSON.stringify(getBaseUrl(api))}`,
    authLine,
  ].filter(Boolean).join('\n') + '\n';
}

function generateReadme({ name, api, tools, lang }) {
  const entryPoint = lang === 'typescript' ? 'dist/index.js' : 'src/index.js';
  const auth = getAuthConfig(api);
  const envName = { api_key: 'API_KEY', bearer: 'API_TOKEN', oauth2: 'ACCESS_TOKEN', none: null }[auth.type];
  const configEnv = envName ? `,\n      "env": { ${JSON.stringify(envName)}: "your-credential-here" }` : '';
  const homepage = markdownUrl(safeHttpUrl(api.info?.['x-homepage']) || '#');
  const absoluteEntryPoint = `/absolute/path/to/${singleLine(name)}/${entryPoint}`;
  return `# ${markdownText(name)}

MCP server for [${markdownText(api.info?.title || name)}](${homepage}).
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
${tools.slice(0, 20).map(tool => `| \`${markdownText(tool.name)}\` | ${tool.method} | \`${markdownText(tool.path)}\` | ${markdownText(singleLine(tool.description).slice(0, 60))} |`).join('\n')}
${tools.length > 20 ? `\n_...and ${tools.length - 20} more_\n` : ''}

## Claude Desktop Config

\`\`\`json
{
  "mcpServers": {
    ${JSON.stringify(name)}: {
      "command": "node",
      "args": [${JSON.stringify(absoluteEntryPoint)}]${configEnv}
    }
  }
}
\`\`\`
`;
}

function getBaseUrl(api) {
  if (api.servers?.[0]?.url) {
    const serverUrl = safeHttpUrl(api.servers[0].url);
    if (serverUrl) return serverUrl.replace(/\/$/, '');
  }
  if (api.host) {
    const swaggerUrl = safeHttpUrl(`${api.schemes?.[0] || 'https'}://${api.host}${api.basePath || ''}`);
    if (swaggerUrl) return swaggerUrl.replace(/\/$/, '');
  }
  return 'https://api.example.com';
}

function getAuthConfig(api) {
  const schemes = api.components?.securitySchemes || api.securityDefinitions || {};
  // The source document is untrusted: security may be non-array or hold
  // null/non-object entries, which must not abort generation with a TypeError.
  const referencedNames = (Array.isArray(api.security) ? api.security : [])
    .flatMap(requirement => (requirement && typeof requirement === 'object' ? Object.keys(requirement) : []));
  const orderedNames = [...new Set([...referencedNames, ...Object.keys(schemes)])];
  for (const name of orderedNames) {
    const scheme = schemes[name];
    if (!scheme) continue;
    if (scheme.type === 'apiKey') return { type: 'api_key', in: scheme.in || 'header', name: scheme.name || 'X-API-Key' };
    if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') return { type: 'bearer', in: 'header', name: 'Authorization' };
    if (scheme.type === 'oauth2') return { type: 'oauth2', in: 'header', name: 'Authorization' };
  }
  return { type: 'none', in: null, name: null };
}

function inferAuthType(api) {
  return getAuthConfig(api).type;
}

function inferCapabilities(api) {
  const seen = new WeakSet();
  const allText = JSON.stringify(api, (_key, value) => {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  }).toLowerCase();
  const capMap = {
    email: ['email', 'mail', 'smtp'], messaging: ['message', 'chat', 'slack', 'discord'],
    'payment-processing': ['payment', 'charge', 'invoice', 'stripe', 'billing'],
    'order-management': ['order', 'cart', 'checkout'],
    'database-read': ['query', 'search', 'list', 'get'],
    'database-write': ['create', 'update', 'delete', 'post', 'put'],
    'file-read': ['file', 'download', 'document'],
    'file-write': ['upload', 'file', 'attachment'],
    monitoring: ['metric', 'alert', 'monitor', 'health'],
    analytics: ['analytic', 'report', 'stat', 'insight'],
  };
  return Object.entries(capMap)
    .filter(([, keywords]) => keywords.some(keyword => allText.includes(keyword)))
    .map(([capability]) => capability);
}

function safeComment(value) {
  return singleLine(value).replace(/\*\//g, '* /');
}

function singleLine(value) {
  return String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}

function markdownText(value) {
  return singleLine(value)
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\[\]|`])/g, '\\$1');
}

function markdownUrl(value) {
  return String(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
