#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { cfg, dataDir, envWasCreated, ensureDirs, rootDir } from './src/config.js';
import { log, c, oneLine } from './src/log.js';
import { findDataset } from './src/sources/datagov.js';
import { downloadResource, pruneDownloads } from './src/fetch.js';
import { loadTable } from './src/table.js';
import { profileTable } from './src/profile.js';
import { runQualityTests } from './src/tests.js';
import { generateHypotheses } from './src/hypothesis.js';
import { verifyHypotheses } from './src/verify.js';
import { screenshotLandingPage } from './src/browserless.js';
import { loadState, saveState, saveRun, listRuns, markSeen, recentlySeen } from './src/store.js';
import { renderDashboard, renderDigest } from './src/render.js';

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
  return { command: positional[0] ?? 'help', flags };
}

const dashboardPath = () => path.join(dataDir, 'dashboard.html');

function writeDashboard() {
  const runs = listRuns({ limit: 100 });
  const html = renderDashboard(runs, { nextRunHint: 'refreshed every run' });
  ensureDirs();
  fs.writeFileSync(dashboardPath(), html);
  return { file: dashboardPath(), runs: runs.length };
}

/** The fixture stands in for a real download so the pipeline can be exercised offline. */
function fixtureSource() {
  const file = path.join(rootDir, 'fixtures', 'sample.csv');
  if (!fs.existsSync(file)) throw new Error('fixtures/sample.csv missing - run: node fixtures/generate.js');
  return {
    dataset: {
      id: 'fixture-park-visits',
      name: 'fixture-park-visits',
      title: 'Daily park visits (synthetic fixture)',
      notes: 'Synthetic data with known relationships, used to exercise the pipeline without network access.',
      organization: 'datapipe fixtures',
      landingPage: 'https://example.com/fixture',
      modified: new Date().toISOString(),
      license: 'n/a',
      tags: ['fixture'],
      resourceCount: 1,
    },
    resource: { url: `file://${file}`, format: 'CSV', name: 'sample.csv', size: fs.statSync(file).size },
    strategy: 'local fixture',
    rank: 0,
    download: { path: file, bytes: fs.statSync(file).size, capped: false, text: fs.readFileSync(file, 'utf8') },
  };
}

async function runOnce(flags) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const state = loadState();
  let stage = 'select';
  let picked = null;

  try {
    // 1. Choose something to analyse -------------------------------------
    log.phase('selecting a dataset');
    if (flags.fixture) {
      picked = fixtureSource();
      log.ok(`using ${c.bold(picked.dataset.title)}`);
    } else {
      const skip = recentlySeen(state, Number(flags.cooldown) || 168);
      log.note(`${skip.size} dataset(s) analysed recently will be skipped`);
      picked = await findDataset({ skip });
    }

    // 2. Download ---------------------------------------------------------
    stage = 'download';
    if (!picked.download) {
      log.phase('downloading the resource');
      picked.download = await downloadResource(picked.resource);
    }

    // 3. Parse ------------------------------------------------------------
    stage = 'parse';
    log.phase('parsing');
    const table = loadTable(picked.download.text, picked.resource.format, { maxRows: cfg.maxRows });
    log.ok(`${table.rows.length.toLocaleString()} rows x ${table.headers.length} columns`);
    if (table.truncated) log.warn(`row cap of ${cfg.maxRows.toLocaleString()} reached`);

    // 4. Profile ----------------------------------------------------------
    stage = 'profile';
    log.phase('profiling columns');
    const profile = profileTable(table);
    log.ok(`${profile.numericColumns.length} numeric, ${profile.dateColumns.length} date, ${profile.categoricalColumns.length} categorical`);

    // 5. Quality tests ----------------------------------------------------
    stage = 'tests';
    log.phase('running data quality tests');
    const tests = runQualityTests(profile, table);
    for (const r of tests.results) {
      const fn = r.level === 'fail' ? log.fail : r.level === 'warn' ? log.warn : log.ok;
      fn(r.title);
      if (r.detail && r.level !== 'pass') log.note(oneLine(r.detail, 110));
    }

    // 6. Hypotheses -------------------------------------------------------
    stage = 'hypotheses';
    log.phase('generating hypotheses');
    const generation = await generateHypotheses({
      table,
      profile,
      dataset: picked.dataset,
      allowBedrock: !flags['no-bedrock'],
    });

    // 7. Verify -----------------------------------------------------------
    stage = 'verify';
    log.phase('testing each hypothesis against the data');
    const hypotheses = verifyHypotheses(table, generation.hypotheses);
    for (const h of hypotheses) {
      const verdict = h.result.verdict;
      const fn = verdict === 'supported' ? log.ok : verdict === 'refuted' ? log.fail : log.warn;
      fn(`[${verdict}] ${oneLine(h.statement, 90)}`);
      log.note(h.result.summary ?? h.result.reason ?? '');
    }

    // 8. Optional landing page shot --------------------------------------
    stage = 'screenshot';
    const screenshot = flags.fixture ? null : await screenshotLandingPage(picked.dataset.landingPage, picked.dataset.name);

    // 9. Record -----------------------------------------------------------
    stage = 'record';
    const run = {
      startedAt,
      durationMs: Date.now() - startMs,
      status: 'ok',
      strategy: picked.strategy,
      rank: picked.rank,
      dataset: picked.dataset,
      resource: { ...picked.resource, downloadedBytes: picked.download.bytes, capped: picked.download.capped },
      profile,
      tests,
      generation: { source: generation.source, model: generation.model, rejected: generation.rejected },
      hypotheses,
      screenshot,
    };
    saveRun(run);
    if (!flags.fixture) {
      markSeen(state, picked.dataset.id);
      state.lastRunAt = startedAt;
      saveState(state);
    }
    if (!flags.keep) pruneDownloads();

    const dash = writeDashboard();
    const supported = hypotheses.filter((h) => h.result.verdict === 'supported').length;
    console.log(`\n${c.green(c.bold('Run complete'))} in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
    console.log(`  ${supported}/${hypotheses.length} hypotheses supported, `
      + `${tests.summary.fail} quality failure(s), ${tests.summary.warn} warning(s)`);
    console.log(`  dashboard: ${c.bold(dash.file)}\n`);
    return 0;
  } catch (err) {
    log.fail(`${stage}: ${err.message}`);
    saveRun({
      startedAt,
      durationMs: Date.now() - startMs,
      status: 'error',
      stage,
      error: err.message,
      dataset: picked?.dataset ?? null,
    });
    writeDashboard();
    return 1;
  }
}

async function digest(flags) {
  const hours = Number(flags.hours) || 24;
  const runs = listRuns({ sinceMs: Date.now() - hours * 3600_000 });
  const html = renderDigest(runs, { hours });
  const file = path.join(dataDir, `digest-${new Date().toISOString().slice(0, 10)}.html`);
  ensureDirs();
  fs.writeFileSync(file, html);

  const state = loadState();
  state.lastDigestAt = new Date().toISOString();
  saveState(state);

  const ok = runs.filter((r) => r.status === 'ok');
  const findings = ok.flatMap((r) => (r.hypotheses || []).filter((h) => h.result?.verdict === 'supported'));
  console.log(`\n${c.bold('Digest')} for the last ${hours}h`);
  console.log(`  ${ok.length} dataset(s), ${findings.length} supported finding(s), ${runs.length - ok.length} failed run(s)`);
  console.log(`  ${c.bold(file)}\n`);
  return 0;
}

async function doctor() {
  log.phase('datapipe doctor');
  log.ok(`config: ${cfg.envPath}`);
  log.note(`catalogue ${cfg.ckanBaseUrl}, formats ${cfg.allowedFormats.join('/')}, row cap ${cfg.maxRows.toLocaleString()}`);

  ensureDirs();
  log.ok(`data directory writable: ${dataDir}`);

  log.step('CKAN reachability');
  try {
    const res = await fetch(`${cfg.ckanBaseUrl}/api/3/action/status_show`, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      log.ok(`catalogue responded HTTP ${res.status}`);
    } else {
      log.fail(`catalogue responded HTTP ${res.status} - the pipeline cannot select a dataset`);
      if (res.status === 403) log.note('a 403 usually means an outbound proxy or firewall is blocking the host');
    }
  } catch (err) {
    log.fail(`cannot reach ${cfg.ckanBaseUrl}: ${err.message}`);
  }

  log.step('Bedrock');
  try {
    await import('@anthropic-ai/bedrock-sdk');
    log.ok(`sdk installed, model ${cfg.bedrockModel} in ${cfg.awsRegion}`);
    // Report exactly what was detected. None of this proves the credentials
    // are valid - only a real call does that, and doctor should not spend money.
    const sources = [];
    if (process.env.AWS_ACCESS_KEY_ID) sources.push('AWS_ACCESS_KEY_ID');
    if (process.env.AWS_PROFILE) sources.push(`AWS_PROFILE=${process.env.AWS_PROFILE}`);
    if (fs.existsSync(path.join(process.env.HOME || '', '.aws', 'credentials'))) sources.push('~/.aws/credentials');
    if (sources.length) {
      log.ok(`credential source present: ${sources.join(', ')}`);
      log.note('not validated here - the first run will show whether Bedrock accepts them');
    } else {
      log.warn('no AWS credential source detected - hypotheses will be generated by search instead');
    }
  } catch {
    log.warn('sdk not installed (npm i @anthropic-ai/bedrock-sdk) - hypotheses will be generated by search');
  }

  log.step('Browserless (optional, landing page screenshots only)');
  if (cfg.browserlessToken) log.ok('token present');
  else log.note('no token - screenshots will be skipped');

  console.log(`\n${c.green('Ready.')} Try: ${c.bold('node run.js run --fixture')} for an offline dry run.\n`);
  return 0;
}

function help() {
  console.log(`
${c.bold('datapipe')} - hourly open-data pipeline ${c.dim('(discover, test, hypothesise, report)')}

  ${c.bold('node run.js <command> [flags]')}

${c.bold('Commands')}
  ${c.blue('run'.padEnd(11))} one full cycle: pick a dataset, download, profile, test, hypothesise, verify
  ${c.blue('digest'.padEnd(11))} write the daily rollup of everything in the last 24h
  ${c.blue('dashboard'.padEnd(11))} regenerate the dashboard from stored runs
  ${c.blue('doctor'.padEnd(11))} check config, catalogue reachability and credentials

${c.bold('Flags')}
  --fixture      use the bundled synthetic dataset instead of the network
  --no-bedrock   skip the LLM and generate hypotheses by searching the data
  --hours N      digest window (default 24)
  --cooldown N   hours before a dataset may be analysed again (default 168)
  --keep         do not prune old downloads

${c.bold('Scheduling')}  add to ${c.dim('crontab -e')}
  0 * * * * cd ${rootDir} && /usr/bin/env node run.js run >> data/pipeline.log 2>&1
  30 7 * * * cd ${rootDir} && /usr/bin/env node run.js digest >> data/pipeline.log 2>&1

${c.bold('Output')}
  data/dashboard.html      rewritten after every run
  data/digest-<date>.html  written by the digest command
  data/runs/*.json         one record per run
`);
  return 0;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (envWasCreated) log.warn(`created ${cfg.envPath} from .env.example`);

  switch (command) {
    case 'run':
      return runOnce(flags);
    case 'digest':
      return digest(flags);
    case 'dashboard': {
      const dash = writeDashboard();
      console.log(`wrote ${dash.file} (${dash.runs} run(s))`);
      return 0;
    }
    case 'doctor':
      return doctor();
    default:
      return help();
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    log.fail(err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  });
