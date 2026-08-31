import { Command } from 'commander';
import chalk from 'chalk';
import enquirer from 'enquirer';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFromOpenAPI } from './generators/openapi.js';
import { generateFromBlank } from './generators/blank.js';
import { generateAgentJson } from './generators/agent-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { prompt } = enquirer;

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('create-mcp-server')}  ${chalk.gray('by Agent App Store')}  ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════╝')}
`;

export async function run() {
  console.log(BANNER);

  const program = new Command();

  program
    .name('create-mcp-server')
    .description('Scaffold a production-ready MCP server for any API or service')
    .version('0.1.0')
    .option('-n, --name <name>', 'Server name')
    .option('-o, --output <dir>', 'Output directory', '.')
    .option('--from-openapi <url-or-path>', 'Generate from OpenAPI/Swagger spec URL or file path')
    .option('--from-url <url>', 'Auto-detect API from a URL (fetches spec or introspects)')
    .option('--blank', 'Scaffold an empty MCP server with example tools')
    .option('--skip-agent-json', 'Skip generating /.well-known/agent.json')
    .option('--typescript', 'Generate TypeScript (default: TypeScript)')
    .option('--javascript', 'Generate JavaScript instead of TypeScript')
    .option('--force', 'Allow generated files to overwrite files in a non-empty destination')
    .parse(process.argv);

  const opts = program.opts();

  const selectedModes = [opts.fromOpenapi, opts.fromUrl, opts.blank].filter(Boolean);
  if (selectedModes.length > 1) {
    program.error('Choose exactly one of --from-openapi, --from-url, or --blank.');
  }
  if (opts.typescript && opts.javascript) {
    program.error('Choose either --typescript or --javascript, not both.');
  }

  // --- Interactive mode if no flags given ---
  if (!opts.fromOpenapi && !opts.fromUrl && !opts.blank) {
    const { mode } = await prompt({
      type: 'select',
      name: 'mode',
      message: 'How do you want to create your MCP server?',
      choices: [
        { name: 'openapi', message: '📄  From an OpenAPI / Swagger spec  ' + chalk.gray('(recommended)') },
        { name: 'url',     message: '🔍  Auto-detect from a service URL' },
        { name: 'blank',   message: '⬜  Blank starter with example tools' },
      ]
    });
    opts.mode = mode;

    if (mode === 'openapi') {
      const { specSource } = await prompt({
        type: 'input',
        name: 'specSource',
        message: 'OpenAPI spec URL or local file path:',
        hint: 'e.g. https://api.example.com/openapi.json or ./swagger.yaml'
      });
      opts.fromOpenapi = specSource;
    }

    if (mode === 'url') {
      const { serviceUrl } = await prompt({
        type: 'input',
        name: 'serviceUrl',
        message: 'Service URL to introspect:',
        hint: 'e.g. https://api.stripe.com'
      });
      opts.fromUrl = serviceUrl;
    }
  }

  // --- Get project name ---
  if (!opts.name) {
    const { name } = await prompt({
      type: 'input',
      name: 'name',
      message: 'MCP server name:',
      hint: 'e.g. my-api-mcp or acme-mcp-server',
      validate: v => /^[a-z0-9-]+$/.test(v) || 'Use lowercase letters, numbers, and hyphens only'
    });
    opts.name = name;
  }

  if (!/^[a-z0-9][a-z0-9-]{0,213}$/.test(opts.name)) {
    program.error('Server name must be 1-214 lowercase letters, numbers, or hyphens, and start with a letter or number.');
  }

  // --- Language choice ---
  if (!opts.javascript) {
    opts.typescript = true;
  }

  const outputBase = path.resolve(opts.output);
  const outputDir = path.resolve(outputBase, opts.name);
  if (path.dirname(outputDir) !== outputBase) {
    program.error('Server name must resolve directly inside the output directory.');
  }
  if (await isSymbolicLink(outputDir)) {
    program.error(`Destination must not be a symbolic link: ${outputDir}`);
  }
  if (!opts.force && await directoryHasEntries(outputDir)) {
    program.error(`Destination is not empty: ${outputDir}\nRe-run with --force to overwrite generated files while preserving unrelated files.`);
  }
  // With --force, a pre-existing symlink inside the destination (e.g. src or
  // .well-known pointing elsewhere) would let the generators write through it
  // to paths outside outputDir. Generated projects never contain symlinks, so
  // any symlink in the destination is foreign — refuse rather than follow.
  if (opts.force) {
    const symlink = await findSymlinkWithin(outputDir);
    if (symlink) {
      program.error(`Destination contains a symbolic link: ${symlink}\nRemove it before re-running with --force — generation will not write through symlinks.`);
    }
  }
  const lang = opts.typescript ? 'typescript' : 'javascript';

  console.log('');
  console.log(chalk.gray(`  Creating MCP server in ${chalk.white(outputDir)}`));
  console.log('');

  const spinner = ora('Scaffolding your MCP server...').start();

  try {
    let serverMeta;

    if (opts.fromOpenapi) {
      spinner.text = 'Parsing OpenAPI spec...';
      serverMeta = await generateFromOpenAPI({
        specSource: opts.fromOpenapi,
        name: opts.name,
        outputDir,
        lang,
      });
    } else if (opts.fromUrl) {
      spinner.text = `Introspecting ${opts.fromUrl}...`;
      // Try well-known paths to find an OpenAPI spec
      const discovered = await discoverSpec(opts.fromUrl);
      if (discovered) {
        opts.fromOpenapi = discovered;
        serverMeta = await generateFromOpenAPI({
          specSource: discovered,
          name: opts.name,
          outputDir,
          lang,
        });
      } else {
        serverMeta = await generateFromBlank({ name: opts.name, outputDir, lang });
      }
    } else {
      serverMeta = await generateFromBlank({ name: opts.name, outputDir, lang });
    }

    // --- Generate agent.json ---
    if (!opts.skipAgentJson) {
      spinner.text = 'Generating /.well-known/agent.json...';
      await generateAgentJson({ meta: serverMeta, outputDir });
      serverMeta.files.push('.well-known/agent.json');
    }

    spinner.succeed(chalk.green('MCP server scaffolded successfully!'));

    // --- Success output ---
    console.log('');
    console.log(chalk.bold('  Next steps:'));
    console.log('');
    console.log(`  ${chalk.gray('1.')} ${chalk.cyan(`cd ${shellQuote(outputDir)}`)}`);
    console.log(`  ${chalk.gray('2.')} ${chalk.cyan('npm install')}`);
    console.log(`  ${chalk.gray('3.')} ${chalk.cyan('npm run dev')}         ${chalk.gray('# starts MCP server in dev mode')}`);
    console.log('');
    console.log(`  ${chalk.bold('Files generated:')}`);
    serverMeta.files.forEach(f => {
      console.log(`  ${chalk.gray('·')} ${f}`);
    });
    console.log('');
    console.log(`  ${chalk.gray('Docs:')} ${chalk.underline('https://agentappstore.dev/docs/create-mcp-server')}`);
    console.log('');

  } catch (err) {
    spinner.fail(chalk.red('Scaffold failed: ' + err.message));
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}

async function directoryHasEntries(directory) {
  try {
    return (await fs.readdir(directory)).length > 0;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isSymbolicLink(destination) {
  try {
    return (await fs.lstat(destination)).isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Returns the path of the first symbolic link found anywhere under
 * `directory` (lstat-based, never follows links), or null if none exist.
 * Bounded so a pathological destination cannot stall the CLI.
 */
async function findSymlinkWithin(directory, budget = { entries: 10000 }) {
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  for (const name of names) {
    if (budget.entries-- <= 0) {
      throw new Error(`Refusing to scan ${directory}: too many entries to verify safely.`);
    }
    const entryPath = path.join(directory, name);
    let stats;
    try {
      stats = await fs.lstat(entryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stats.isSymbolicLink()) return entryPath;
    if (stats.isDirectory()) {
      const nested = await findSymlinkWithin(entryPath, budget);
      if (nested) return nested;
    }
  }
  return null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

async function discoverSpec(baseUrl) {
  const candidates = [
    '/openapi.json',
    '/openapi.yaml',
    '/swagger.json',
    '/swagger.yaml',
    '/api-docs',
    '/api/openapi.json',
    '/v1/openapi.json',
  ];

  for (const path of candidates) {
    try {
      const res = await fetch(baseUrl.replace(/\/$/, '') + path, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json') || ct.includes('yaml') || path.endsWith('.json') || path.endsWith('.yaml')) {
          return baseUrl.replace(/\/$/, '') + path;
        }
      }
    } catch {}
  }
  return null;
}
