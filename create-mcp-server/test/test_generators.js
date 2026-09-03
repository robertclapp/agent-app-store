/**
 * Tests for create-mcp-server generators.
 * Uses Node.js built-in test runner (node --test).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUTPUT_DIR = path.join(__dirname, 'output');
const REPO_ROOT = path.join(__dirname, '..', '..');

async function writeSpec(name, spec) {
  const file = path.join(FIXTURES_DIR, name);
  await fs.writeJson(file, spec, { spaces: 2 });
  return file;
}

function successfulResponse(payload = { ok: true }) {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

async function generateJavaScript(specName, spec, projectName = specName.replace(/\.json$/, '')) {
  const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
  const specPath = await writeSpec(specName, spec);
  const outDir = path.join(OUTPUT_DIR, projectName);
  const meta = await generateFromOpenAPI({
    specSource: specPath,
    name: projectName,
    outputDir: outDir,
    lang: 'javascript',
  });
  return { meta, outDir };
}

async function importGeneratedTools(outDir) {
  const toolsUrl = pathToFileURL(path.join(outDir, 'src/tools.js'));
  return import(`${toolsUrl.href}?test=${Date.now()}-${Math.random()}`);
}

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
      parameters: [
        { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: {
        operationId: 'getUser',
        summary: 'Get a user by ID',
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

  it('should execute generated tools with body args and encoded path params', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-runtime-test');

    await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-runtime-mcp',
      outputDir: outDir,
      lang: 'javascript',
    });

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return successfulResponse();
    };

    try {
      const toolsUrl = pathToFileURL(path.join(outDir, 'src/tools.js'));
      const { callTool } = await import(`${toolsUrl.href}?runtime=${Date.now()}`);

      await callTool('createuser', { name: 'Ada', email: 'ada@example.com' });
      assert.deepEqual(JSON.parse(requests[0].init.body), {
        name: 'Ada',
        email: 'ada@example.com',
      });

      await callTool('getuser', { userId: 'team/a b?#%' });
      assert.equal(
        requests[1].url,
        'https://api.test.com/users/team%2Fa%20b%3F%23%25',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('treats malicious OpenAPI metadata and paths as data, not generated code', async () => {
    delete globalThis.__openapiPwned;
    const maliciousKey = 'globalThis.__openapiPwned=true';
    const spec = {
      openapi: '3.0.0',
      info: {
        title: '*/\u2028globalThis.__openapiPwned = true;\u2029/*',
        version: '1.0.0\n*/ globalThis.__openapiPwned = true; /*',
        description: '` ${globalThis.__openapiPwned = true}',
      },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        [`/probe/\${${maliciousKey}}`]: {
          get: {
            operationId: 'probe;globalThis.__openapiPwned=true',
            summary: '`; globalThis.__openapiPwned = true; //',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const maliciousName = "malicious';globalThis.__openapiPwned=true;";
    const { meta, outDir } = await generateJavaScript('malicious-openapi.json', spec, maliciousName);

    for (const file of ['src/index.js', 'src/client.js', 'src/tools.js']) {
      const syntax = spawnSync(process.execPath, ['--check', path.join(outDir, file)], { encoding: 'utf8' });
      assert.equal(syntax.status, 0, `${file}: ${syntax.stderr}`);
    }

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return successfulResponse();
    };
    try {
      const { callTool } = await importGeneratedTools(outDir);
      assert.equal(globalThis.__openapiPwned, undefined);
      await callTool(meta.tools[0].name, { [maliciousKey]: 'safe' });
      assert.equal(globalThis.__openapiPwned, undefined);
      assert.equal(requests.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.__openapiPwned;
    }
  });

  it('places custom header/query API keys and bearer/OAuth tokens correctly at runtime', async () => {
    const authCases = [
      {
        id: 'header-key',
        scheme: { type: 'apiKey', in: 'header', name: 'X-Service-Secret' },
        env: 'API_KEY',
        assertRequest: request => {
          assert.equal(request.init.headers['X-Service-Secret'], 'test-secret');
          assert.doesNotMatch(request.url, /test-secret/);
        },
      },
      {
        id: 'query-key',
        scheme: { type: 'apiKey', in: 'query', name: 'access_key' },
        env: 'API_KEY',
        assertRequest: request => {
          assert.equal(new URL(request.url).searchParams.get('access_key'), 'test-secret');
          assert.equal(request.init.headers['X-API-Key'], undefined);
        },
      },
      {
        id: 'cookie-key',
        scheme: { type: 'apiKey', in: 'cookie', name: 'session' },
        env: 'API_KEY',
        // A per-operation cookie parameter must survive alongside the auth
        // cookie — the client merges into headers.Cookie, never overwrites.
        parameters: [{ name: 'locale', in: 'cookie', schema: { type: 'string' } }],
        args: { locale: 'en-US' },
        assertRequest: request => {
          assert.equal(request.init.headers.Cookie, 'locale=en-US; session=test-secret');
          assert.equal(request.init.headers.session, undefined, 'cookie key must not leak into a header of the same name');
          assert.doesNotMatch(request.url, /test-secret/);
        },
      },
      {
        id: 'bearer',
        scheme: { type: 'http', scheme: 'bearer' },
        env: 'API_TOKEN',
        assertRequest: request => assert.equal(request.init.headers.Authorization, 'Bearer test-secret'),
      },
      {
        id: 'oauth',
        scheme: {
          type: 'oauth2',
          flows: { clientCredentials: { tokenUrl: 'https://auth.test/token', scopes: {} } },
        },
        env: 'ACCESS_TOKEN',
        assertRequest: request => assert.equal(request.init.headers.Authorization, 'Bearer test-secret'),
      },
    ];

    for (const authCase of authCases) {
      const spec = {
        openapi: '3.0.0',
        info: { title: authCase.id, version: '1.0.0' },
        servers: [{ url: 'https://api.test.com' }],
        security: [{ auth: [] }],
        paths: {
          '/resource': {
            get: {
              operationId: `get-${authCase.id}`,
              ...(authCase.parameters ? { parameters: authCase.parameters } : {}),
              responses: { '200': { description: 'ok' } },
            },
          },
        },
        components: { securitySchemes: { auth: authCase.scheme } },
      };
      const { meta, outDir } = await generateJavaScript(`${authCase.id}.json`, spec, `${authCase.id}-mcp`);
      const oldValue = process.env[authCase.env];
      process.env[authCase.env] = 'test-secret';
      const requests = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        requests.push({ url, init });
        return successfulResponse();
      };
      try {
        const { callTool } = await importGeneratedTools(outDir);
        await callTool(meta.tools[0].name, authCase.args || {});
        assert.equal(requests.length, 1);
        authCase.assertRequest(requests[0]);
      } finally {
        globalThis.fetch = originalFetch;
        if (oldValue === undefined) delete process.env[authCase.env];
        else process.env[authCase.env] = oldValue;
      }
    }
  });

  it('flattens JSON bodies whose schema omits an explicit object type', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Implicit Object', version: '1.0.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/notes': {
          post: {
            operationId: 'createNote',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  // No `type: 'object'` — valid JSON Schema, and common in the
                  // wild. Must flatten like an explicit object, not collapse
                  // to one opaque `body` argument.
                  schema: {
                    properties: {
                      title: { type: 'string' },
                      starred: { type: 'boolean' },
                    },
                    required: ['title'],
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    };
    const { meta, outDir } = await generateJavaScript('implicit-object.json', spec, 'implicit-object-mcp');
    const tool = meta.tools[0];
    assert.ok(!tool.params.some(parameter => parameter.name === 'body'),
      'schema with properties but no type must flatten to per-field params');
    assert.equal(tool.params.find(parameter => parameter.name === 'title').required, true);
    assert.equal(tool.params.find(parameter => parameter.name === 'starred').required, false);

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return successfulResponse();
    };
    try {
      const { callTool } = await importGeneratedTools(outDir);
      await callTool(tool.name, { title: 'Test note', starred: true });
      assert.equal(requests.length, 1);
      assert.deepEqual(JSON.parse(requests[0].init.body), { title: 'Test note', starred: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles bodyless responses and malformed security entries', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Bodyless', version: '1.0.0' },
      servers: [{ url: 'https://api.test.com' }],
      // Untrusted specs can carry junk here; generation must not TypeError.
      security: [null, 'bogus'],
      paths: {
        '/ping': {
          head: { operationId: 'checkPing', responses: { '200': { description: 'ok' } } },
          delete: { operationId: 'deletePing', responses: { '204': { description: 'gone' } } },
        },
      },
    };
    const { meta, outDir } = await generateJavaScript('bodyless.json', spec, 'bodyless-mcp');
    const headTool = meta.tools.find(tool => tool.method === 'HEAD');
    const deleteTool = meta.tools.find(tool => tool.method === 'DELETE');
    assert.ok(headTool && deleteTool);

    const originalFetch = globalThis.fetch;
    // JSON content-type with an empty body — res.json() would throw here.
    globalThis.fetch = async (url, init) => ({
      ok: true,
      status: init.method === 'DELETE' ? 204 : 200,
      headers: { get: () => 'application/json' },
      text: async () => '',
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });
    try {
      const { callTool } = await importGeneratedTools(outDir);
      const headResult = await callTool(headTool.name, {});
      assert.match(headResult.content[0].text, /"status": 200/);
      const deleteResult = await callTool(deleteTool.name, {});
      assert.match(deleteResult.content[0].text, /"status": 204/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('supports Swagger 2 body schemas at runtime', async () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Swagger Body', version: '1.0.0' },
      host: 'swagger.test',
      basePath: '/v2',
      schemes: ['https'],
      consumes: ['application/json'],
      paths: {
        '/records': {
          post: {
            operationId: 'createRecord',
            parameters: [{
              name: 'payload',
              in: 'body',
              required: true,
              schema: {
                type: 'object',
                required: ['profile'],
                properties: {
                  profile: {
                    type: 'object',
                    required: ['name'],
                    properties: { name: { type: 'string' } },
                  },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const { meta, outDir } = await generateJavaScript('swagger-body.json', spec, 'swagger-body-mcp');
    const tool = meta.tools[0];
    assert.equal(tool.params.find(parameter => parameter.name === 'profile').required, true);
    assert.equal(tool.params.find(parameter => parameter.name === 'profile').schema.properties.name.type, 'string');
    assert.equal(tool.params.find(parameter => parameter.name === 'tags').schema.items.type, 'string');

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return successfulResponse();
    };
    try {
      const { callTool } = await importGeneratedTools(outDir);
      await callTool(tool.name, { profile: { name: 'Ada' }, tags: ['one', 'two'] });
      assert.equal(requests[0].url, 'https://swagger.test/v2/records');
      assert.deepEqual(JSON.parse(requests[0].init.body), {
        profile: { name: 'Ada' },
        tags: ['one', 'two'],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves nested/array schemas and sends multipart, header, and cookie inputs', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Complex Inputs', version: '1.0.0' },
      servers: [{ url: 'https://complex.test/api' }],
      paths: {
        '/upload/{id}': {
          post: {
            operationId: 'uploadRecord',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'tag', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
              { name: 'token', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'token', in: 'cookie', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    required: ['metadata'],
                    properties: Object.fromEntries([
                      ['metadata', {
                        type: 'object',
                        properties: { owner: { type: 'string' } },
                        required: ['owner'],
                      }],
                      ['labels', { type: 'array', items: { type: 'string' } }],
                      ['__proto__', { type: 'string' }],
                    ]),
                  },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
        '/bulk': {
          post: {
            operationId: 'bulkCreate',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id'],
                      properties: { id: { type: 'integer' } },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };
    const { meta, outDir } = await generateJavaScript('complex-inputs.json', spec, 'complex-inputs-mcp');
    const upload = meta.tools.find(tool => tool.name === 'uploadrecord');
    const bulk = meta.tools.find(tool => tool.name === 'bulkcreate');
    assert.equal(upload.bodyType, 'multipart');
    assert.equal(upload.params.find(parameter => parameter.name === 'metadata').schema.properties.owner.type, 'string');
    assert.ok(upload.params.some(parameter => parameter.name === '__proto__'));
    assert.ok(upload.params.some(parameter => parameter.argName === 'header_token'));
    assert.ok(upload.params.some(parameter => parameter.argName === 'cookie_token'));
    assert.equal(bulk.params[0].schema.type, 'array');
    assert.equal(bulk.params[0].schema.items.properties.id.type, 'integer');

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return successfulResponse();
    };
    try {
      const { callTool } = await importGeneratedTools(outDir);
      await callTool(upload.name, Object.fromEntries([
        ['id', 'a/b'],
        ['tag', ['x', 'y']],
        ['header_token', 'header-secret'],
        ['cookie_token', 'cookie secret'],
        ['metadata', { owner: 'Ada' }],
        ['labels', ['one', 'two']],
        ['__proto__', 'ordinary-data'],
      ]));
      const uploadUrl = new URL(requests[0].url);
      assert.equal(uploadUrl.pathname, '/api/upload/a%2Fb');
      assert.deepEqual(uploadUrl.searchParams.getAll('tag'), ['x', 'y']);
      assert.equal(requests[0].init.headers.token, 'header-secret');
      assert.equal(requests[0].init.headers.Cookie, 'token=cookie%20secret');
      assert.ok(requests[0].init.body instanceof FormData);
      assert.equal(requests[0].init.body.get('metadata'), JSON.stringify({ owner: 'Ada' }));
      assert.deepEqual(requests[0].init.body.getAll('labels'), ['one', 'two']);
      assert.equal(requests[0].init.body.get('__proto__'), 'ordinary-data');

      await callTool(bulk.name, { body: [{ id: 1 }, { id: 2 }] });
      assert.deepEqual(JSON.parse(requests[1].init.body), [{ id: 1 }, { id: 2 }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps generated tools, README, and manifest counts consistent at 50 and 51 operations', async () => {
    const { generateAgentJson } = await import('../src/generators/agent-json.js');
    for (const count of [50, 51]) {
      const paths = Object.fromEntries(Array.from({ length: count }, (_, index) => [
        `/items/${index}`,
        {
          get: {
            operationId: `getItem${index}`,
            responses: { '200': { description: 'ok' } },
          },
        },
      ]));
      const spec = {
        openapi: '3.0.0',
        info: { title: `${count} tools`, version: '1.0.0' },
        servers: [{ url: 'https://count.test' }],
        paths,
      };
      const { meta, outDir } = await generateJavaScript(`count-${count}.json`, spec, `count-${count}-mcp`);
      const generated = await importGeneratedTools(outDir);
      const manifest = await generateAgentJson({ meta, outputDir: outDir });
      const readme = await fs.readFile(path.join(outDir, 'README.md'), 'utf8');
      assert.equal(meta.tools.length, count);
      assert.equal(generated.tools.length, count);
      assert.match(readme, new RegExp(`Available Tools \\(${count}\\)`));
      assert.equal(manifest.tools[0].description, `MCP server with ${count} tools`);
    }
  });

  it('should generate only working package scripts and compile TypeScript', async () => {
    const { generateFromOpenAPI } = await import('../src/generators/openapi.js');
    const outDir = path.join(OUTPUT_DIR, 'openapi-build-test');

    await generateFromOpenAPI({
      specSource: path.join(FIXTURES_DIR, 'openapi.json'),
      name: 'test-build-mcp',
      outputDir: outDir,
      lang: 'typescript',
    });

    const pkg = await fs.readJson(path.join(outDir, 'package.json'));
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'dev', 'start']);
    assert.ok(!JSON.stringify(pkg.scripts).includes('scripts/'));

    // Reuse this project's installed dependencies to validate the generated
    // project exactly as `npm run build` will run after `npm install`.
    await fs.ensureSymlink(
      path.join(__dirname, '..', 'node_modules'),
      path.join(outDir, 'node_modules'),
      'junction',
    );
    const build = spawnSync('npm', ['run', 'build', '--', '--pretty', 'false'], {
      cwd: outDir,
      encoding: 'utf8',
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.ok(await fs.pathExists(path.join(outDir, 'dist/index.js')));

    const readme = await fs.readFile(path.join(outDir, 'README.md'), 'utf8');
    assert.match(readme, /npm run build/);
    assert.match(readme, /\/absolute\/path\/to\/test-build-mcp\/dist\/index\.js/);
  });
});

// ── CLI Integration Tests ───────────────────────────────────────────────────

describe('CLI', () => {
  it('should scaffold through the advertised command without phantom scripts', async () => {
    const outputBase = path.join(OUTPUT_DIR, 'cli-test');
    const command = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'bin/create-mcp-server.js'),
      '--name', 'cli-test-mcp',
      '--output', outputBase,
      '--from-openapi', path.join(FIXTURES_DIR, 'openapi.json'),
      '--javascript',
    ], { encoding: 'utf8' });

    assert.equal(command.status, 0, `${command.stdout}\n${command.stderr}`);
    const output = `${command.stdout}\n${command.stderr}`;
    assert.doesNotMatch(output, /npm run (validate|publish-to-agentstore)/);
    assert.match(output, /\.well-known\/agent\.json/);

    const generatedDir = path.join(outputBase, 'cli-test-mcp');
    assert.ok(output.includes(`cd '${generatedDir}'`));
    const pkg = await fs.readJson(path.join(generatedDir, 'package.json'));
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['dev', 'start']);
    assert.ok(await fs.pathExists(path.join(generatedDir, '.well-known/agent.json')));
  });

  it('should execute the package start script', () => {
    const binPath = path.join(__dirname, '..', 'bin/create-mcp-server.js');
    assert.notEqual(fs.statSync(binPath).mode & 0o111, 0, 'Package bin must be executable');

    const command = spawnSync('npm', ['start', '--', '--help'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });

    assert.equal(command.status, 0, `${command.stdout}\n${command.stderr}`);
    assert.match(command.stdout, /Scaffold a production-ready MCP server/);
  });

  it('rejects invalid flag-supplied names before resolving or writing paths', async () => {
    const outputBase = path.join(OUTPUT_DIR, 'cli-invalid');
    await fs.ensureDir(outputBase);
    for (const name of ['../escape', '.', 'Uppercase', `a${'b'.repeat(214)}`]) {
      const command = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'bin/create-mcp-server.js'),
        '--name', name,
        '--output', outputBase,
        '--blank',
        '--javascript',
      ], { encoding: 'utf8' });
      assert.notEqual(command.status, 0, `invalid name unexpectedly accepted: ${name}`);
      assert.match(`${command.stdout}\n${command.stderr}`, /Server name must be/);
    }
    assert.equal(await fs.pathExists(path.join(OUTPUT_DIR, 'escape')), false);
  });

  it('refuses a non-empty destination unless --force is explicit', async () => {
    const outputBase = path.join(OUTPUT_DIR, 'cli-force');
    const destination = path.join(outputBase, 'existing-mcp');
    const marker = path.join(destination, 'keep-me.txt');
    await fs.ensureDir(destination);
    await fs.writeFile(marker, 'preserve this');
    const args = [
      path.join(__dirname, '..', 'bin/create-mcp-server.js'),
      '--name', 'existing-mcp',
      '--output', outputBase,
      '--blank',
      '--javascript',
    ];

    const refused = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(`${refused.stdout}\n${refused.stderr}`, /Destination is not empty/);
    assert.equal(await fs.pathExists(path.join(destination, 'package.json')), false);

    const forced = spawnSync(process.execPath, [...args, '--force'], { encoding: 'utf8' });
    assert.equal(forced.status, 0, `${forced.stdout}\n${forced.stderr}`);
    assert.equal(await fs.readFile(marker, 'utf8'), 'preserve this');
    assert.ok(await fs.pathExists(path.join(destination, 'package.json')));
  });

  it('refuses --force when a generated target is a symbolic link', async () => {
    const outputBase = path.join(OUTPUT_DIR, 'cli-force-symlink');
    const destination = path.join(outputBase, 'linked-mcp');
    const victim = path.join(outputBase, 'victim');
    const sentinel = path.join(victim, 'do-not-touch.txt');
    await fs.ensureDir(destination);
    await fs.ensureDir(victim);
    await fs.writeFile(sentinel, 'untouched');
    // src -> ../victim: generation would write straight through the link and
    // out of the destination directory.
    await fs.ensureSymlink(victim, path.join(destination, 'src'), 'junction');

    const args = [
      path.join(__dirname, '..', 'bin/create-mcp-server.js'),
      '--name', 'linked-mcp',
      '--output', outputBase,
      '--blank',
      '--javascript',
      '--force',
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Refusing to overwrite .*a symbolic link/s);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'untouched');
    assert.equal(await fs.pathExists(path.join(victim, 'index.js')), false,
      'nothing may be written through the symlink');
  });

  it('refuses --force when a generated target is a hard link', async () => {
    // A hard link is not a symlink: lstat reports isFile(), so an
    // isSymbolicLink()-only check passes it and the write truncates the
    // shared inode, destroying a file outside the destination.
    const outputBase = path.join(OUTPUT_DIR, 'cli-force-hardlink');
    const destination = path.join(outputBase, 'hard-mcp');
    const outsider = path.join(outputBase, 'EXTERNAL_secret.txt');
    await fs.ensureDir(destination);
    await fs.writeFile(outsider, 'IMPORTANT ORIGINAL CONTENT');
    await fs.ensureLink(outsider, path.join(destination, 'package.json'));

    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'bin/create-mcp-server.js'),
      '--name', 'hard-mcp',
      '--output', outputBase,
      '--blank',
      '--javascript',
      '--force',
    ], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Refusing to overwrite .*a hard link/s);
    assert.equal(await fs.readFile(outsider, 'utf8'), 'IMPORTANT ORIGINAL CONTENT',
      'the hard-linked file outside the destination must be untouched');
  });

  it('allows --force over a project that has run npm install', async () => {
    // node_modules/.bin is full of legitimate symlinks; scanning the whole
    // destination would reject the ordinary regenerate-after-install workflow.
    const outputBase = path.join(OUTPUT_DIR, 'cli-force-node-modules');
    const destination = path.join(outputBase, 'installed-mcp');
    const binDir = path.join(destination, 'node_modules', '.bin');
    const pkgDist = path.join(destination, 'node_modules', 'tsx', 'dist');
    await fs.ensureDir(binDir);
    await fs.ensureDir(pkgDist);
    await fs.writeFile(path.join(pkgDist, 'cli.mjs'), 'export {};');
    await fs.ensureSymlink(path.join(pkgDist, 'cli.mjs'), path.join(binDir, 'tsx'));

    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'bin/create-mcp-server.js'),
      '--name', 'installed-mcp',
      '--output', outputBase,
      '--blank',
      '--javascript',
      '--force',
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(await fs.pathExists(path.join(destination, 'package.json')));
    assert.equal(await fs.pathExists(path.join(binDir, 'tsx')), true,
      'the install tree must be left alone');
  });

  it('rejects conflicting mode/language flags and symbolic-link destinations', async () => {
    const bin = path.join(__dirname, '..', 'bin/create-mcp-server.js');
    const outputBase = path.join(OUTPUT_DIR, 'cli-conflicts');
    const conflictCases = [
      ['--name', 'conflict-mcp', '--output', outputBase, '--blank', '--from-openapi', path.join(FIXTURES_DIR, 'openapi.json')],
      ['--name', 'conflict-mcp', '--output', outputBase, '--blank', '--typescript', '--javascript'],
    ];
    for (const args of conflictCases) {
      const command = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
      assert.notEqual(command.status, 0);
      assert.match(`${command.stdout}\n${command.stderr}`, /Choose (exactly one|either)/);
    }

    const target = path.join(OUTPUT_DIR, 'outside-target');
    const destination = path.join(outputBase, 'linked-mcp');
    await fs.ensureDir(target);
    await fs.ensureDir(outputBase);
    await fs.ensureSymlink(target, destination, 'dir');
    const linked = spawnSync(process.execPath, [
      bin,
      '--name', 'linked-mcp',
      '--output', outputBase,
      '--blank',
      '--javascript',
      '--force',
    ], { encoding: 'utf8' });
    assert.notEqual(linked.status, 0);
    assert.match(`${linked.stdout}\n${linked.stderr}`, /must not be a symbolic link/);
    assert.equal(await fs.pathExists(path.join(target, 'package.json')), false);
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
    assert.ok(indexContent.includes("import 'dotenv/config'"), 'Should load the generated .env file');

    await fs.ensureSymlink(
      path.join(__dirname, '..', 'node_modules'),
      path.join(outDir, 'node_modules'),
      'junction',
    );
    const build = spawnSync('npm', ['run', 'build', '--', '--pretty', 'false'], {
      cwd: outDir,
      encoding: 'utf8',
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.ok(await fs.pathExists(path.join(outDir, 'dist/index.js')));
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

    const pkg = await fs.readJson(path.join(outDir, 'package.json'));
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['dev', 'start']);
    assert.ok(await fs.pathExists(path.join(outDir, 'src/index.js')));
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

  it('sanitizes untrusted metadata and validates every generated field against the published schema', async () => {
    const { generateAgentJson } = await import('../src/generators/agent-json.js');
    const schema = await fs.readJson(path.join(REPO_ROOT, 'schema/agent-json/0.1.0.json'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const outDir = path.join(OUTPUT_DIR, 'agent-json-schema-test');
    const manifest = await generateAgentJson({
      meta: {
        name: '../../unsafe;package',
        description: `description ${'x'.repeat(800)}`,
        capabilities: ['database-read', 42, null],
        tools: Array.from({ length: 51 }, (_, index) => ({ name: `tool-${index}` })),
        authType: 'oauth2',
        baseUrl: 'https://api.test.com',
        api: {
          info: {
            title: `Very long API ${'x'.repeat(100)}`,
            version: 'release-next',
            'x-docs-url': 'javascript:alert(1)',
          },
          components: {
            securitySchemes: {
              oauth: { type: 'oauth2', flows: { clientCredentials: { scopes: { read: 'Read data' } } } },
            },
          },
        },
      },
      outputDir: outDir,
    });

    assert.equal(validate(manifest), true, JSON.stringify(validate.errors, null, 2));
    assert.equal(manifest.name.length, 64);
    assert.equal(manifest.description.length, 500);
    assert.equal(manifest.version, '0.1.0');
    assert.deepEqual(manifest.capabilities, ['database-read']);
    assert.deepEqual(manifest.auth.oauth2, { scopes: { read: 'Read data' } });
    assert.equal(manifest.tools[0].name, 'generated-mcp');
    assert.equal(manifest.tools[0].endpoint, 'npx generated-mcp');
    assert.equal('docs_url' in manifest.tools[1], false);
    assert.equal(manifest.tools[0].description, 'MCP server with 51 tools');
  });

  it('maps Swagger 2 OAuth metadata without emitting empty URI fields', async () => {
    const { generateAgentJson } = await import('../src/generators/agent-json.js');
    const outDir = path.join(OUTPUT_DIR, 'agent-json-swagger-oauth-test');
    const manifest = await generateAgentJson({
      meta: {
        name: 'swagger-oauth-mcp',
        authType: 'oauth2',
        api: {
          info: { title: 'Swagger OAuth', version: '2.0.0' },
          securityDefinitions: {
            oauth: {
              type: 'oauth2',
              flow: 'accessCode',
              authorizationUrl: 'https://auth.test/authorize',
              tokenUrl: 'https://auth.test/token',
              scopes: { read: 'Read records' },
            },
          },
        },
      },
      outputDir: outDir,
    });
    assert.deepEqual(manifest.auth.oauth2, {
      authorization_url: 'https://auth.test/authorize',
      token_url: 'https://auth.test/token',
      scopes: { read: 'Read records' },
    });
  });
});

describe('Package contents', () => {
  it('ships the CLI README and MIT license in npm pack output', () => {
    const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
    const report = JSON.parse(packed.stdout);
    const filenames = new Set(report[0].files.map(file => file.path));
    assert.ok(filenames.has('README.md'));
    assert.ok(filenames.has('LICENSE'));
    assert.ok(filenames.has('bin/create-mcp-server.js'));
  });
});
