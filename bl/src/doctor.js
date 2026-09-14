import fs from 'node:fs';
import { cfg } from './config.js';
import { blPost } from './client.js';
import { log, c } from './out.js';

const mask = (token) =>
  token.length <= 8 ? '*'.repeat(token.length) : `${token.slice(0, 4)}${'*'.repeat(token.length - 8)}${token.slice(-4)}`;

/** Verify the token, the region and basic rendering before running real demos. */
export default async function doctor() {
  log.title('Browserless doctor');

  log.step(`env file: ${cfg.envPath}`);
  if (!fs.existsSync(cfg.envPath)) {
    log.fail('.env is missing - copy .env.example to .env');
    return 1;
  }
  log.ok('.env found');

  if (!cfg.token) {
    log.fail('BROWSERLESS_TOKEN is empty');
    log.note(`open ${cfg.envPath} and paste the token from https://account.browserless.io`);
    return 1;
  }
  log.ok(`token loaded: ${c.dim(mask(cfg.token))}`);
  log.ok(`region: ${c.bold(cfg.baseUrl)}`);

  // Render inline HTML: exercises auth + a real browser without depending on
  // any third-party site being up.
  log.step('rendering a tiny page to check auth and browser availability');
  try {
    const res = await blPost(
      '/content',
      { html: '<html><body><h1>browserless ok</h1></body></html>' },
      { accept: 'text/html', timeoutMs: 30_000 },
    );
    const html = res.text ?? res.buffer.toString('utf8');
    if (html.includes('browserless ok')) {
      log.ok(`round trip in ${c.bold(res.ms + 'ms')} - you are ready to go`);
    } else {
      log.warn('got a response but the expected markup was missing');
      log.note(html.slice(0, 200));
    }
  } catch (err) {
    log.fail(err.message);
    if (err.hint) log.note(err.hint);
    return 1;
  }

  log.step('optional: BrowserQL endpoint check');
  try {
    const res = await blPost(cfg.bqlPath, { query: '{ __typename }' }, { timeoutMs: 20_000 });
    const payload = res.json ?? JSON.parse(res.buffer.toString('utf8'));
    if (payload.errors?.length) {
      log.warn(`BrowserQL replied with an error: ${payload.errors[0].message}`);
    } else {
      log.ok(`BrowserQL reachable at ${cfg.bqlPath}`);
    }
  } catch (err) {
    log.warn(`BrowserQL not available (${err.status ?? 'error'}) - the bql demo may not work on this plan`);
    log.note(`tried ${cfg.baseUrl}${cfg.bqlPath}; some accounts use /chrome/bql instead`);
  }

  console.log(`\n${c.green('All set.')} Try: ${c.bold('npm run screenshot')} or ${c.bold('npm run all')}\n`);
  return 0;
}
