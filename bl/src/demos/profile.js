import { wsEndpoint, redact, requireToken } from '../config.js';
import { blPost } from '../client.js';
import { log, saveJson, reportArtifact, c } from '../out.js';

export const meta = {
  defaultUrl: 'https://quotes.toscrape.com',
  summary: 'Authenticated Profiles: save a logged-in state, then reuse it by name',
  useCase: 'Log in once, then every later run starts already authenticated.',
  needs: 'puppeteer-core (npm i puppeteer-core)',
  flags: { '--name <profile>': 'profile name to create and reuse (default: bl-demo)' },
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

// The create-session response has moved around between versions, so accept any
// of the plausible key names rather than guessing one.
function pickWs(payload) {
  const candidate =
    payload.browserWSEndpoint ?? payload.websocketUrl ?? payload.wsEndpoint ?? payload.ws ?? payload.connectUrl ?? payload.url;
  if (!candidate) return null;
  // Make sure the token rides along even if the response omitted it.
  const url = new URL(candidate);
  if (!url.searchParams.get('token')) url.searchParams.set('token', requireToken());
  return url.toString();
}

/** Browserless.* are browser-level CDP extensions; try the page session first. */
async function sendBrowserlessCommand(browser, page, method, params) {
  try {
    const client = await page.createCDPSession();
    return await client.send(method, params);
  } catch (err) {
    const browserClient = await browser.target().createCDPSession();
    return browserClient.send(method, params);
  }
}

/** One short session against an explicit ws endpoint. */
async function session(puppeteer, endpoint, url, work) {
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    return await work(page, browser);
  } finally {
    await browser.disconnect();
  }
}

const readState = async (page, url) => ({
  cookie: (await page.cookies(url)).find((ck) => ck.name === COOKIE)?.value ?? null,
  storage: await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
});

export default async function run({ url, flags }) {
  const puppeteer = await loadPuppeteer();
  const name = flags.name ?? 'bl-demo';
  const value = `issued-${Date.now()}`;

  log.note(`profile name: ${c.magenta(name)}`);

  // 1. Open a profile-creation session. This is the step that has to happen
  //    before ?profile=<name> means anything - without it you get a 404.
  log.step(`POST /profile to start a capture session`);
  let created;
  try {
    const res = await blPost('/profile', { name }, { query: { name } });
    created = res.json ?? JSON.parse(res.buffer.toString('utf8'));
  } catch (err) {
    err.hint = err.hint ?? 'Authenticated Profiles may not be on your plan - check account.browserless.io > Profiles';
    throw err;
  }

  const createWs = pickWs(created);
  if (!createWs) {
    log.warn('no WebSocket URL in the response - printing it so we can adjust');
    console.log(JSON.stringify(created, null, 2).slice(0, 800));
    throw new Error('Could not find a connect URL in the POST /profile response');
  }
  log.ok(`capture session open: ${redact(createWs)}`);

  // 2. Do whatever makes the browser "logged in". A real script would fill a
  //    login form here; a cookie plus a localStorage entry stands in for it.
  log.step('session 1: establishing state, then saving it into the profile');
  const saved = await session(puppeteer, createWs, url, async (page, browser) => {
    await page.setCookie({ name: COOKIE, value, url });
    await page.evaluate((key, v) => localStorage.setItem(key, v), STORAGE_KEY, value);

    // Browserless.saveProfile snapshots cookies + localStorage + IndexedDB.
    return sendBrowserlessCommand(browser, page, 'Browserless.saveProfile', { name });
  });
  log.ok(`saved ${c.bold(value)} into profile ${c.magenta(name)}`);
  if (saved && typeof saved === 'object') log.note(JSON.stringify(saved).slice(0, 200));

  if (created.stopUrl ?? created.stop) {
    await fetch(created.stopUrl ?? created.stop).catch(() => {});
    log.note('capture session stopped');
  }

  // 3. Reuse it by name on a brand new browser.
  log.step('session 2: new browser, connected with ?profile=' + name);
  const withProfile = await session(puppeteer, wsEndpoint('', { profile: name }), url, (page) => readState(page, url));

  // 4. Control run with no profile - proves the profile did the work.
  log.step('session 3 (control): new browser, no profile');
  const withoutProfile = await session(puppeteer, wsEndpoint(), url, (page) => readState(page, url));

  const persisted = withProfile.cookie === value || withProfile.storage === value;
  const leaked = withoutProfile.cookie === value || withoutProfile.storage === value;

  log.ok(`with profile    cookie=${withProfile.cookie ?? 'absent'}  localStorage=${withProfile.storage ?? 'absent'}`);
  log.ok(`control         cookie=${withoutProfile.cookie ?? 'absent'}  localStorage=${withoutProfile.storage ?? 'absent'}`);

  if (persisted && !leaked) {
    log.ok(c.bold('state survived into a new browser, and only with the profile attached'));
    log.note('swap the cookie for a real login and every later run starts authenticated');
  } else if (persisted && leaked) {
    log.warn('the control session saw it too - something other than the profile is persisting state');
  } else {
    log.warn('the profile saved but did not restore - check Profiles in the dashboard');
  }

  const file = saveJson('profile-result.json', {
    profile: name,
    wrote: value,
    saveProfileResult: saved,
    withProfile,
    withoutProfile,
    persisted,
    leaked,
  });
  reportArtifact(file);

  return {
    artifacts: [{ ...file, kind: 'json', label: 'Profile experiment' }],
    facts: {
      profile: name,
      'with profile': withProfile.cookie ?? withProfile.storage ?? 'absent',
      'without profile': withoutProfile.cookie ?? withoutProfile.storage ?? 'absent',
      verdict: persisted && !leaked ? 'state persisted' : persisted ? 'persisted, but control saw it too' : 'not restored',
    },
  };
}
