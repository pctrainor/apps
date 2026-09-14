import { wsEndpoint, cfg } from '../config.js';
import { log, save, saveJson, reportArtifact, c, oneLine } from '../out.js';

export const meta = {
  defaultUrl: 'https://quotes.toscrape.com',
  summary: 'Connect Puppeteer over WebSocket and drive a multi-step session',
  useCase: 'Logins, form fills, pagination - full control, zero browser infrastructure.',
  needs: 'puppeteer-core (npm i puppeteer-core)',
};

async function loadPuppeteer() {
  try {
    return (await import('puppeteer-core')).default;
  } catch {
    // Hint rather than a multi-line message: `all` prints only the first line
    // of an error, but always prints the hint.
    const err = new Error('puppeteer-core is not installed');
    err.hint = 'Run: npm i puppeteer-core   (it ships no browser - Browserless is the browser)';
    throw err;
  }
}

// Pull every quote off the current page, in the browser.
const readQuotes = () =>
  [...document.querySelectorAll('.quote')].map((el) => ({
    text: el.querySelector('.text')?.textContent?.trim(),
    author: el.querySelector('.author')?.textContent?.trim(),
    tags: [...el.querySelectorAll('.tag')].map((t) => t.textContent.trim()),
  }));

export default async function run({ url }) {
  const puppeteer = await loadPuppeteer();
  const endpoint = wsEndpoint();

  log.step(`connecting to ${c.dim(cfg.baseUrl.replace(/^https?:/, 'wss:'))}`);
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    log.step(`page 1: ${c.bold(url)}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    log.ok(`title: ${c.bold(oneLine(await page.title(), 60))}`);

    const paginated = url.includes('toscrape.com');
    let collected = [];
    let pagesVisited = 1;

    if (paginated) {
      collected = await page.evaluate(readQuotes);
      log.ok(`collected ${c.bold(collected.length)} quotes from page 1`);

      // Walk the pager the way a person would: click, wait, read.
      for (let i = 0; i < 2; i += 1) {
        const next = await page.$('li.next > a');
        if (!next) break;
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), next.click()]);
        pagesVisited += 1;
        const more = await page.evaluate(readQuotes);
        collected = collected.concat(more);
        log.ok(`clicked Next -> page ${pagesVisited}, ${c.bold(more.length)} more quotes`);
      }

      const authors = [...new Set(collected.map((q) => q.author))];
      log.note(`${collected.length} quotes total from ${authors.length} authors`);
      log.note(`sample: ${oneLine(collected[0]?.text, 70)}`);
    } else {
      // Generic site: scroll to trigger lazy loading, then report what is there.
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1000));
      collected = await page.evaluate(() =>
        [...document.querySelectorAll('h1, h2')].slice(0, 20).map((h) => ({ text: h.textContent.trim() })),
      );
      log.ok(`found ${c.bold(collected.length)} headings after scrolling`);
    }

    const shot = save('puppeteer-final.png', await page.screenshot({ fullPage: false }));
    reportArtifact(shot);

    const dataFile = saveJson('puppeteer-data.json', { url, pagesVisited, items: collected });
    reportArtifact(dataFile);

    return {
      artifacts: [
        { ...shot, kind: 'image', label: 'Final frame' },
        { ...dataFile, kind: 'json', label: 'Session data' },
      ],
      facts: {
        'pages visited': pagesVisited,
        'items collected': collected.length,
        transport: 'WebSocket (CDP)',
      },
      preview: collected.slice(0, 5),
    };
  } finally {
    // Disconnect, not close: the session is torn down by Browserless.
    await browser.disconnect();
    log.note('disconnected');
  }
}
