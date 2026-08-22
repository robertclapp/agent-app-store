# create-mcp-server

Scaffold an MCP server from an OpenAPI or Swagger document, or start from a small blank TypeScript/JavaScript template.

## Usage

```bash
npx create-mcp-server --name my-api-mcp --from-openapi ./openapi.json
cd my-api-mcp
npm install
npm run build
```

The destination must be empty unless `--force` is supplied. `--force` overwrites generated files but preserves unrelated files already in the directory.

Run `npx create-mcp-server --help` for all options.

## License

MIT
