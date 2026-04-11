/**
 * Tests for create-mcp-server generators.
 * Uses Node.js built-in test runner (node --test).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUTPUT_DIR = path.join(__dirname, 'output');

// ── Fixture: Minimal OpenAPI spec ──────────────────────────────────────────

const MINIMAL_OPENAPI = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0', description: 'A test API' },
  servers: [{ url: 'https://api.test.com' }],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List all users',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Max results' },
        ],
        responses: { '200': { description: 'Success' } },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create a user',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'User name' },
                  email: { type: 'string', description: 'User email' },
                },
                required: ['name', 'email'],
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/users/{userId}': {
      get: {
        operationId: 'getUser',
        summary: 'Get a user by ID',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Success' } },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },
};

// ── Setup / Teardown ──────────────────────────────────────────────────────

before(async () => {
  await fs.ensureDir(FIXTURES_DIR);
  await fs.ensureDir(OUTPUT_DIR);
  await fs.writeJson(path.join(FIXTURES_DIR, 'openapi.json'), MINIMAL_OPENAPI, { spaces: 2 });
});

after(async () => {
  await fs.remove(OUTPUT_DIR);
  await fs.remove(FIXTURES_DIR);
});

// ── OpenAPI Generator Tests ────────────────────────────────────────────────

describe('OpenAPI Generator', () => {
  it('should generate all expected files from an OpenAPI spec', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-test');

    const result = await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-api-mcp',
      outputDir: outDir,
      lang: 'typescript',
    });

    assert.ok(result.files.includes('package.json'), 'Should generate package.json');
    assert.ok(result.files.includes('tsconfig.json'), 'Should generate tsconfig.json');
    assert.ok(result.files.includes('src/index.ts'), 'Should generate src/index.ts');
    assert.ok(result.files.includes('src/tools.ts'), 'Should generate src/tools.ts');
    assert.ok(result.files.includes('src/client.ts'), 'Should generate src/client.ts');
    assert.ok(result.files.includes('.env.example'), 'Should generate .env.example');
    assert.ok(result.files.includes('README.md'), 'Should generate README.md');
  });

  it('should extract tools from OpenAPI paths', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-tools-test');

    const result = await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-tools-mcp',
      outputDir: outDir,
      lang: 'javascript',
    });

    assert.equal(result.tools.length, 3, 'Should extract 3 tools (listUsers, createUser, getUser)');

    const toolNames = result.tools.map(t => t.name);
    assert.ok(toolNames.includes('listusers'), 'Should have listusers tool');
    assert.ok(toolNames.includes('createuser'), 'Should have createuser tool');
    assert.ok(toolNames.includes('getuser'), 'Should have getuser tool');
  });

  it('should extract parameters correctly', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-params-test');

    const result = await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-params-mcp',
      outputDir: outDir,
      lang: 'javascript',
    });

    const getUser = result.tools.find(t => t.name === 'getuser');
    assert.ok(getUser, 'Should have getuser tool');
    const pathParam = getUser.params.find(p => p.name === 'userId');
    assert.ok(pathParam, 'Should have userId path parameter');
    assert.equal(pathParam.in, 'path');
    assert.equal(pathParam.required, true);

    const createUser = result.tools.find(t => t.name === 'createuser');
    const bodyParams = createUser.params.filter(p => p.in === 'body');
    assert.equal(bodyParams.length, 2, 'Should have 2 body parameters (name, email)');
  });

  it('should detect auth type from security schemes', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-auth-test');

    const result = await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-auth-mcp',
      outputDir: outDir,
      lang: 'javascript',
    });

    assert.equal(result.authType, 'api_key', 'Should detect api_key auth');
  });

  it('should infer capabilities from API content', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-caps-test');

    const result = await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-caps-mcp',
      outputDir: outDir,
      lang: 'javascript',
    });

    assert.ok(Array.isArray(result.capabilities), 'Should return capabilities array');
  });

  it('should generate valid JSON in package.json', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-pkg-test');

    await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-pkg-mcp',
      outputDir: outDir,
      lang: 'typescript',
    });

    const pkg = await fs.readJson(path.join(outDir, 'package.json'));
    assert.equal(pkg.name, 'test-pkg-mcp');
    assert.equal(pkg.type, 'module');
    assert.ok(pkg.dependencies['@modelcontextprotocol/sdk'], 'Should include MCP SDK');
  });
});

// ── Blank Generator Tests ──────────────────────────────────────────────────

describe('Blank Generator', () => {
  it('should generate a minimal TypeScript MCP server', async () => {
    const { generateFromBlank } = await import('../src/generators/blank.js');
    const outDir = path.join(OUTPUT_DIR, 'blank-ts-test');

    const result = await generateFromBlank({
      name: 'my-test-mcp',
      outputDir: outDir,
      lang: 'typescript',
    });

    assert.ok(result.files.includes('package.json'));
    assert.ok(result.files.includes('src/index.ts'));
    assert.ok(result.files.includes('src/tools.ts'));
    assert.ok(result.files.includes('.env.example'));

    const indexContent = await fs.readFile(path.join(outDir, 'src/index.ts'), 'utf-8');
    assert.ok(indexContent.includes('my-test-mcp'), 'Server name should appear in index');
    assert.ok(indexContent.includes("@modelcontextprotocol/sdk"), 'Should import MCP SDK');
  });

  it('should generate a minimal JavaScript MCP server', async () => {
    const { generateFromBlank } = await import('../src/generators/blank.js');
    const outDir = path.join(OUTPUT_DIR, 'blank-js-test');

    const result = await generateFromBlank({
      name: 'my-js-mcp',
      outputDir: outDir,
      lang: 'javascript',
    });

    assert.ok(result.files.includes('src/index.js'));
    assert.ok(result.files.includes('src/tools.js'));
    assert.ok(!result.files.includes('tsconfig.json'), 'JS mode should not generate tsconfig');
  });
});

// ── Agent JSON Generator Tests ─────────────────────────────────────────────

describe('Agent JSON Generator', () => {
  it('should generate a valid agent.json manifest', async () => {
    const { generateAgentJson } = await import('../src/generators/agent-json.js');
    const outDir = path.join(OUTPUT_DIR, 'agent-json-test');
    await fs.ensureDir(outDir);

    const manifest = await generateAgentJson({
      meta: {
        name: 'test-mcp',
        description: 'A test MCP server',
        capabilities: ['email', 'messaging'],
        tools: [{ name: 'send_email' }, { name: 'send_message' }],
        authType: 'api_key',
        baseUrl: 'https://api.test.com',
        api: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            securitySchemes: {
              apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
            },
          },
        },
      },
      outputDir: outDir,
    });

    assert.equal(manifest.spec_version, '0.1.0');
    assert.equal(manifest.name, 'Test API');
    assert.ok(manifest.tools.length >= 1, 'Should have at least one tool entry');
    assert.equal(manifest.auth.type, 'api_key');

    // Verify file was written
    const filePath = path.join(outDir, '.well-known', 'agent.json');
    assert.ok(await fs.pathExists(filePath), 'agent.json file should exist');
  });

  it('should handle bearer auth correctly', async () => {
    const { generateAgentJson } = await import('../src/generators/agent-json.js');
    const outDir = path.join(OUTPUT_DIR, 'agent-json-bearer-test');
    await fs.ensureDir(outDir);

    const manifest = await generateAgentJson({
      meta: {
        name: 'bearer-mcp',
        authType: 'bearer',
        api: {
          info: { title: 'Bearer API' },
          components: {
            securitySchemes: {
              bearer: { type: 'http', scheme: 'bearer' },
            },
          },
        },
      },
      outputDir: outDir,
    });

    assert.equal(manifest.auth.type, 'api_key');
    assert.equal(manifest.auth.key_header, 'Authorization');
    assert.equal(manifest.auth.key_prefix, 'Bearer');
  });

  it('should handle no auth correctly', async () => {
    const { generateAgentJson } = await import('../src/generators/agent-json.js');
    const outDir = path.join(OUTPUT_DIR, 'agent-json-noauth-test');
    await fs.ensureDir(outDir);

    const manifest = await generateAgentJson({
      meta: { name: 'noauth-mcp', authType: 'none' },
      outputDir: outDir,
    });

    assert.equal(manifest.auth.type, 'none');
  });
});
