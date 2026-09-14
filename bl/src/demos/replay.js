import { wsEndpoint, redact } from '../config.js';
import { log, save, saveJson, reportArtifact, c } from '../out.js';

export const meta = {
  defaultUrl: 'https://quotes.toscrape.com',
  summary: 'Record a session with replay=true and watch it back in the dashboard',
  useCase: 'Debugging a flow that fails in production but works locally.',
  needs: 'puppeteer-core (npm i puppeteer-core)',
  flags: {
    '--headless': 'connect headless (default is headless=false, as the docs show)',
  },
};

async function loadPuppeteer() {
  try {
    return (await import('puppeteer-core')).default;
  } catch {
    const err = new Error('puppeteer-core is not installed');
    err.hint = 'Run: npm i puppeteer-core';
    throw err;
  }
}

export default async function run({ url, flags }) {
  const puppeteer = await loadPuppeteer();

  // replay=true turns on the rrweb recorder. The recording uploads to your
  // dashboard once the session ends, so the disconnect below matters.
  const endpoint = wsEndpoint('', {
    replay: 'true',
    timeout: 120000,
    ...(flags.headless ? {} : { headless: 'false' }),
  });

  log.step('connecting with recording enabled');
  log.note(redact(endpoint));

  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  const steps = [];
  const track = (what) => {
    steps.push({ at: new Date().toISOString(), what });
    log.ok(what);
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Deliberately varied: navigation, a click, a scroll and some typing, so
    // the replay timeline has something worth scrubbing through.
    await page.goto(url, { waitUntil: 'networkidle2' });
    track(`loaded ${url}`);

    const tag = await page.$('.tag');
    if (tag) {
      const tagName = await page.evaluate((el) => el.textContent.trim(), tag);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), tag.click()]);
      track(`clicked the "${tagName}" tag`);
    }

    await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
    await new Promise((r) => setTimeout(r, 800));
    track('scrolled down the results');

    // Typing shows up keystroke by keystroke in the replay.
    const loginUrl = new URL('/login', url).toString();
    await page.goto(loginUrl, { waitUntil: 'networkidle2' }).catch(() => {});
    const username = await page.$('#username');
    if (username) {
      await page.type('#username', 'demo-user', { delay: 90 });
      await page.type('#password', 'hunter2', { delay: 90 });
      track('typed into the login form (not submitted)');
    }

    const shot = save('replay-final.png', await page.screenshot());
    reportArtifact(shot);

    const logFile = saveJson('replay-steps.json', { endpoint: redact(endpoint), steps });
    reportArtifact(logFile);

    return {
      artifacts: [
        { ...shot, kind: 'image', label: 'Last frame of the recorded session' },
        { ...logFile, kind: 'json', label: 'Step timeline' },
      ],
      facts: {
        recording: 'replay=true',
        steps: steps.length,
        'watch it': 'dashboard > Session Replay',
      },
    };
  } finally {
    // The upload happens on session end - without this the replay may not appear.
    await browser.disconnect();
    log.note('disconnected - the recording uploads now');
    log.note(`open ${c.bold('https://account.browserless.io')} > Session Replay (newest first)`);
  }
}
