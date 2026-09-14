import { blPost } from '../client.js';
import { log, saveJson, reportArtifact, c, oneLine } from '../out.js';

export const meta = {
  summary: 'Structured JSON out of a page using CSS selectors',
  useCase: 'Price/stock monitoring, lead lists, competitor tracking - no parser to maintain.',
  flags: { '--selector <css>': 'scrape one specific selector instead of the defaults' },
};

// Sensible selectors per target so the demo prints something meaningful
// whichever URL you point it at.
function selectorsFor(url, override) {
  if (override) return [{ selector: override }];
  if (url.includes('news.ycombinator.com')) {
    return [{ selector: '.titleline > a' }, { selector: '.score' }];
  }
  if (url.includes('toscrape.com')) {
    return [{ selector: '.quote .text' }, { selector: '.quote .author' }, { selector: '.tag' }];
  }
  return [{ selector: 'h1' }, { selector: 'h2' }, { selector: 'a[href]' }];
}

export default async function run({ url, flags }) {
  const elements = selectorsFor(url, flags.selector);
  log.step(`scraping ${c.bold(url)} for ${elements.map((e) => c.magenta(e.selector)).join(', ')}`);

  const res = await blPost('/scrape', {
    url,
    elements,
    gotoOptions: { waitUntil: 'networkidle2' },
    waitForSelector: { selector: elements[0].selector, timeout: 15000 },
  });

  const payload = res.json ?? JSON.parse(res.buffer.toString('utf8'));
  const groups = payload.data ?? [];

  // Shape the raw response into something an app would actually store.
  const tidy = groups.map((group) => ({
    selector: group.selector,
    count: group.results?.length ?? 0,
    items: (group.results ?? []).slice(0, 25).map((r) => ({
      text: oneLine(r.text, 160),
      href: r.attributes?.find((a) => a.name === 'href')?.value,
    })),
  }));

  for (const group of tidy) {
    log.ok(`${c.magenta(group.selector)} matched ${c.bold(group.count)} element(s)`);
    for (const item of group.items.slice(0, 5)) {
      log.note(`- ${item.text}${item.href ? c.dim(`  ${oneLine(item.href, 48)}`) : ''}`);
    }
    if (group.count > 5) log.note(`...and ${group.count - 5} more`);
  }

  const file = saveJson('scrape.json', tidy);
  reportArtifact(file);
  log.note(`${res.ms}ms round trip`);

  return {
    artifacts: [{ ...file, kind: 'json', label: 'Scraped data' }],
    facts: Object.fromEntries(tidy.map((g) => [g.selector, `${g.count} matches`])),
    preview: tidy,
  };
}
