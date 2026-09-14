#!/usr/bin/env node
import { cfg, envWasCreated, outputDir } from './src/config.js';
import { loadDemo, demoNames, runAllOrder } from './src/demos/index.js';
import { writeReport } from './src/report.js';
import doctor from './src/doctor.js';
import { log, c } from './src/out.js';

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[(i += 1)];
    else flags[key] = true;
  }
  return { command: positional[0], positional: positional.slice(1), flags };
}

async function metaFor(name) {
  try {
    return (await loadDemo(name)).meta ?? {};
  } catch {
    return {};
  }
}

async function help() {
  console.log(`
${c.bold('bl')} - Browserless API demos ${c.dim('(vanilla Node, no build step)')}

  ${c.bold('node index.js <demo> [url] [--flags]')}

${c.bold('Demos')}`);
  for (const name of runAllOrder) {
    const meta = await metaFor(name);
    console.log(`  ${c.blue(name.padEnd(12))} ${meta.summary ?? ''}`);
    if (meta.needs) console.log(`  ${''.padEnd(12)} ${c.dim(`requires ${meta.needs}`)}`);
  }
  console.log(`
${c.bold('Also')}
  ${c.blue('doctor'.padEnd(12))} check token, region and rendering before you start
  ${c.blue('all'.padEnd(12))} run every demo, then write output/report.html

${c.bold('Examples')}
  node index.js doctor
  node index.js screenshot https://stripe.com
  node index.js scrape https://news.ycombinator.com --selector ".titleline > a"
  node index.js all

${c.bold('Config')}  ${c.dim(cfg.envPath)}
  region ${cfg.baseUrl}   default target ${cfg.demoUrl}
`);
}

async function runOne(name, { url, flags }) {
  const mod = await loadDemo(name);
  const meta = mod.meta ?? {};
  const target = url ?? meta.defaultUrl ?? cfg.demoUrl;

  log.title(`${name}  ${c.dim('- ' + (meta.summary ?? ''))}`);
  const started = Date.now();
  const result = await mod.default({ url: target, flags });
  return { name, url: target, ms: Date.now() - started, ...meta, ...result, status: 'ok' };
}

async function runAll({ url, flags }) {
  const results = [];
  for (const name of runAllOrder) {
    try {
      const result = await runOne(name, { url, flags });
      results.push(result);
    } catch (err) {
      const meta = await metaFor(name);
      log.fail(err.message.split('\n')[0]);
      if (err.hint) log.note(err.hint);
      results.push({
        name,
        ...meta,
        status: 'failed',
        error: err.message,
        hint: err.hint,
        artifacts: [],
      });
    }
  }

  const passed = results.filter((r) => r.status === 'ok').length;
  console.log(`\n${c.bold('Summary')}`);
  for (const r of results) {
    const mark = r.status === 'ok' ? c.green('pass') : c.red('fail');
    const timing = r.ms ? c.dim(`${(r.ms / 1000).toFixed(1)}s`) : '';
    console.log(`  ${mark}  ${r.name.padEnd(12)} ${timing}`);
  }

  const report = writeReport({ results, url: url ?? cfg.demoUrl, baseUrl: cfg.baseUrl });
  console.log(`\n${passed}/${results.length} passed. Open the gallery:\n  ${c.bold(`open ${report.file}`)}\n`);
  return passed === results.length ? 0 : 1;
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (envWasCreated) {
    log.warn(`created ${cfg.envPath} from .env.example - paste your token there`);
  }

  if (!command || command === 'help' || flags.help) {
    await help();
    return 0;
  }
  if (command === 'doctor') return doctor();

  const url = flags.url ?? positional.find((p) => /^https?:\/\//.test(p));
  if (command === 'all') return runAll({ url, flags });

  if (!demoNames.includes(command)) {
    log.fail(`unknown command "${command}"`);
    await help();
    return 1;
  }

  const result = await runOne(command, { url, flags });
  console.log(`\n${c.green('done')} in ${(result.ms / 1000).toFixed(1)}s ${c.dim(`- artifacts in ${outputDir}`)}\n`);
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    log.fail(err.message);
    if (err.hint) log.note(err.hint);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
