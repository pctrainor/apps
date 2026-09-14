import { blPost } from '../client.js';
import { log, save, reportArtifact, c, humanSize } from '../out.js';

export const meta = {
  // Defaults to a deliberately JS-rendered page so the comparison below is stark.
  defaultUrl: 'https://quotes.toscrape.com/js/',
  summary: 'Fully rendered HTML, side by side with a plain fetch()',
  useCase: 'Feeding SPA/JS-rendered pages to parsers, LLMs, or a search index.',
};

export default async function run({ url }) {
  log.step(`plain fetch() of ${c.bold(url)} (no browser)`);
  let rawHtml = '';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'bl-demo/0.1' } });
    rawHtml = await res.text();
    log.note(`${humanSize(Buffer.byteLength(rawHtml))} of HTML as the server sends it`);
  } catch (err) {
    log.warn(`plain fetch failed (${err.message}) - continuing with the browser render`);
  }

  log.step('same URL through Browserless (real Chrome, JS executed)');
  const rendered = await blPost(
    '/content',
    {
      url,
      gotoOptions: { waitUntil: 'networkidle2' },
      // Skip images/fonts/media: we only want the DOM, and it renders much faster.
      rejectResourceTypes: ['image', 'font', 'media'],
    },
    { accept: 'text/html' },
  );
  const html = rendered.text ?? rendered.buffer.toString('utf8');

  const file = save('content-rendered.html', html);
  reportArtifact(file);
  log.note(`${rendered.ms}ms round trip`);

  // A concrete, countable difference rather than just "it's bigger".
  const count = (source, re) => (source.match(re) || []).length;
  const quoteRe = /class="[^"]*\bquote\b/g;
  const rawQuotes = count(rawHtml, quoteRe);
  const renderedQuotes = count(html, quoteRe);

  log.ok(`server HTML: ${humanSize(Buffer.byteLength(rawHtml))}  ->  rendered: ${humanSize(Buffer.byteLength(html))}`);
  if (rawQuotes !== renderedQuotes) {
    log.ok(`elements matching .quote: ${c.bold(rawQuotes)} raw vs ${c.bold(renderedQuotes)} rendered`);
    log.note('that gap is exactly the content a plain HTTP client cannot see');
  }

  return {
    artifacts: [{ ...file, kind: 'html', label: 'Rendered DOM' }],
    facts: {
      'raw html': humanSize(Buffer.byteLength(rawHtml)),
      'rendered html': humanSize(Buffer.byteLength(html)),
      '.quote nodes': `${rawQuotes} raw / ${renderedQuotes} rendered`,
      latency: `${rendered.ms}ms`,
    },
  };
}
