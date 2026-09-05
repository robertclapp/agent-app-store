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
  // With --force we overwrite into an existing directory, so check the paths
  // the generators actually write: a symlink there would be followed out of
  // outputDir, and a hard link shares an inode so truncating it destroys the
  // other name's contents. Only those paths are inspected — scanning the whole
  // tree would reject every project that has run npm install, since
  // node_modules/.bin is full of legitimate symlinks.
  if (opts.force) {
    const unsafe = await findUnsafeTarget(outputDir);
    if (unsafe) {
      program.error(`Refusing to overwrite ${unsafe.path}\nIt is ${unsafe.reason}, and writing to it would modify a file outside ${outputDir}.\nRemove it before re-running with --force.`);
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
 * Every path the generators write, relative to outputDir. Both language
 * extensions are listed because the destination may hold output from an
 * earlier run in the other language.
 */
const GENERATED_PATHS = [
  '.env.example',
  '.gitignore',
  'README.md',
  'package.json',
  'tsconfig.json',
  'src',
  'src/client.js', 'src/client.ts',
  'src/index.js', 'src/index.ts',
  'src/tools.js', 'src/tools.ts',
  '.well-known',
  '.well-known/agent.json',
];

/**
 * Returns {path, reason} for the first generated target that cannot be safely
 * overwritten, or null when all are safe. Never follows links (lstat only).
 *
 * Rejects two cases, both of which would write outside outputDir:
 *   - a symbolic link: the write follows it to the target
 *   - a hard-linked regular file: truncating it destroys the other name's
 *     contents, since both names share one inode
 *
 * This runs before generation, so it cannot close a TOCTOU race against an
 * attacker who can write into the destination *during* generation; it stops
 * links already planted in a destination the user chose to --force.
 */
async function findUnsafeTarget(outputDir) {
  for (const relative of GENERATED_PATHS) {
    const target = path.join(outputDir, relative);
    let stats;
    try {
      stats = await fs.lstat(target);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stats.isSymbolicLink()) return { path: target, reason: 'a symbolic link' };
    // Directories always report nlink >= 2 ('.' plus the parent entry), so the
    // hard-link test applies to regular files only.
    if (stats.isFile() && stats.nlink > 1) {
      return { path: target, reason: `a hard link (${stats.nlink} names share its inode)` };
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
