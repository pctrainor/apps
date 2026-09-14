import { wsEndpoint, redact } from '../config.js';
import { log, saveJson, reportArtifact, c } from '../out.js';

export const meta = {
  defaultUrl: 'https://quotes.toscrape.com',
  summary: 'Authenticated Profiles: write state in one session, read it in the next',
  useCase: 'Log in once, then every later run starts already authenticated.',
  needs: 'puppeteer-core (npm i puppeteer-core)',
  flags: { '--name <profile>': 'profile name to use (default: bl-demo)' },
};

const COOKIE = 'bl_demo_token';
const STORAGE_KEY = 'bl_demo_state';

async function loadPuppeteer() {
  try {
    return (await import('puppeteer-core')).default;
  } catch {
    const err = new Error('puppeteer-core is not installed');
    err.hint = 'Run: npm i puppeteer-core';
    throw err;
  }
}

/** One short session; `work` gets the page and returns whatever we care about. */
async function session(puppeteer, params, url, work) {
  const endpoint = wsEndpoint('', params);
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await work(page);
  } finally {
    await browser.disconnect();
  }
}

export default async function run({ url, flags }) {
  const puppeteer = await loadPuppeteer();
  const name = flags.name ?? 'bl-demo';
  const value = `issued-${Date.now()}`;

  log.note(`profile name: ${c.magenta(name)}`);
  log.note(redact(wsEndpoint('', { profile: name })));

  // 1. Write - stand in for "log in and get a session cookie".
  log.step('session 1: writing a cookie + localStorage entry into the profile');
  await session(puppeteer, { profile: name }, url, async (page) => {
    await page.setCookie({ name: COOKIE, value, url });
    await page.evaluate(
      (key, v) => localStorage.setItem(key, v),
      STORAGE_KEY,
      value,
    );
  });
  log.ok(`wrote ${c.bold(value)}`);

  // 2. Read back with the same profile - this is the behaviour under test.
  log.step('session 2: brand new browser, same profile');
  const withProfile = await session(puppeteer, { profile: name }, url, async (page) => ({
    cookie: (await page.cookies(url)).find((ck) => ck.name === COOKIE)?.value ?? null,
    storage: await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  }));

  // 3. Control - no profile at all. Proves any hit above came from the profile
  //    and not from some other kind of reuse.
  log.step('session 3 (control): brand new browser, no profile');
  const withoutProfile = await session(puppeteer, {}, url, async (page) => ({
    cookie: (await page.cookies(url)).find((ck) => ck.name === COOKIE)?.value ?? null,
    storage: await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  }));

  const persisted = withProfile.cookie === value || withProfile.storage === value;
  const leaked = withoutProfile.cookie === value || withoutProfile.storage === value;

  log.ok(`with profile    cookie=${withProfile.cookie ?? 'absent'}  localStorage=${withProfile.storage ?? 'absent'}`);
  log.ok(`control         cookie=${withoutProfile.cookie ?? 'absent'}  localStorage=${withoutProfile.storage ?? 'absent'}`);

  if (persisted && !leaked) {
    log.ok(c.bold('state survived across sessions, and only with the profile attached'));
    log.note('this is the mechanism: log in once, reuse the profile everywhere after');
  } else if (persisted && leaked) {
    log.warn('the control session saw it too - something other than the profile is persisting state');
  } else {
    log.warn('nothing came back: the profile did not capture this state');
    log.note('Authenticated Profiles are plan-gated, and may need the profile saved in the');
    log.note('dashboard first. Check account.browserless.io > Profiles for an entry named ' + name);
  }

  const file = saveJson('profile-result.json', { profile: name, wrote: value, withProfile, withoutProfile, persisted, leaked });
  reportArtifact(file);

  return {
    artifacts: [{ ...file, kind: 'json', label: 'Profile experiment' }],
    facts: {
      profile: name,
      'with profile': withProfile.cookie ?? withProfile.storage ?? 'absent',
      'without profile': withoutProfile.cookie ?? withoutProfile.storage ?? 'absent',
      verdict: persisted && !leaked ? 'state persisted' : persisted ? 'persisted, but control saw it too' : 'not persisted',
    },
  };
}
