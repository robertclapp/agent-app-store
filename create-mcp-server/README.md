# create-mcp-server

Scaffold an MCP server from an OpenAPI or Swagger document, or start from a small blank TypeScript/JavaScript template.

## Usage

```bash
npx create-mcp-server --name my-api-mcp --from-openapi ./openapi.json
cd my-api-mcp
npm install
npm run build
```

The destination must be empty unless `--force` is supplied. `--force` overwrites generated files but preserves unrelated files already in the directory. It refuses to run (exit code 1, `Refusing to overwrite …`) if any file it would write is a symbolic link or a hard link, because writing through either would modify a file outside the destination — remove the link and re-run.

Run `npx create-mcp-server --help` for all options.

## License

MIT
