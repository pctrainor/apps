import { blPost } from '../client.js';
import { log, saveJson, reportArtifact, c, oneLine } from '../out.js';

export const meta = {
  summary: 'Ship a Puppeteer script to Browserless and get JSON back',
  useCase: 'Custom logic (login, pagination, metrics) with no browser to install or keep alive.',
};

// This string runs *on Browserless*, not here. It is an ES module whose default
// export receives a live page plus whatever `context` you send alongside it.
const code = `
export default async function ({ page, context }) {
  const { url } = context;

  const response = await page.goto(url, { waitUntil: 'networkidle2' });

  const summary = await page.evaluate(() => {
    const meta = (name) =>
      document.querySelector(\`meta[name="\${name}"], meta[property="og:\${name}"]\`)?.content || null;

    const links = [...document.querySelectorAll('a[href]')];
    const images = [...document.querySelectorAll('img')];

    return {
      title: document.title,
      description: meta('description'),
      headings: [...document.querySelectorAll('h1, h2')].slice(0, 8).map((h) => h.textContent.trim()),
      linkCount: links.length,
      externalLinks: links.filter((a) => a.hostname && a.hostname !== location.hostname).length,
      imageCount: images.length,
      imagesMissingAlt: images.filter((img) => !img.alt).length,
      lang: document.documentElement.lang || null,
      // Real navigation timing straight from the browser.
      domContentLoadedMs: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart),
    };
  });

  return {
    data: { status: response.status(), finalUrl: page.url(), ...summary },
    type: 'application/json',
  };
}
`;

export default async function run({ url }) {
  log.step(`running a server-side audit script against ${c.bold(url)}`);

  const res = await blPost('/function', { code, context: { url } });
  const payload = res.json ?? JSON.parse(res.buffer.toString('utf8'));
  // Depending on plan/version the body is either the data itself or wrapped.
  const data = payload.data ?? payload;

  log.ok(`${c.bold(oneLine(data.title, 60))} ${c.dim(`(HTTP ${data.status})`)}`);
  log.note(`${data.linkCount} links (${data.externalLinks} external), ${data.imageCount} images`);
  log.note(`${data.imagesMissingAlt} image(s) missing alt text, lang=${data.lang ?? 'unset'}`);
  log.note(`DOMContentLoaded in ${data.domContentLoadedMs}ms`);
  for (const heading of (data.headings ?? []).slice(0, 4)) log.note(`- ${oneLine(heading, 70)}`);

  const file = saveJson('function-audit.json', data);
  reportArtifact(file);
  log.note(`${res.ms}ms round trip`);

  return {
    artifacts: [{ ...file, kind: 'json', label: 'Page audit' }],
    facts: {
      title: oneLine(data.title, 50),
      links: `${data.linkCount} (${data.externalLinks} external)`,
      'images without alt': data.imagesMissingAlt,
      DOMContentLoaded: `${data.domContentLoadedMs}ms`,
    },
    preview: data,
  };
}
