import { bql } from '../client.js';
import { cfg } from '../config.js';
import { log, save, saveJson, reportArtifact, c, oneLine } from '../out.js';

export const meta = {
  summary: 'BrowserQL - describe the whole session as one GraphQL mutation',
  useCase: 'One round trip instead of ten; the stealth layer is built in.',
  flags: {
    '--selector <css>': 'element to read text from (default: picked per site)',
    '--replay': 'record the session for dashboard playback',
  },
};

// `text` WAITS for its selector and fails the whole mutation if it never shows
// up, so the default has to be something the page genuinely has. Hacker News,
// for instance, has no <h1> at all.
function selectorFor(url, override) {
  if (override) return override;
  if (url.includes('news.ycombinator.com')) return '.titleline > a';
  if (url.includes('toscrape.com')) return '.quote .text';
  return 'body';
}

// Each field is a step, executed top to bottom in a single browser session.
const MUTATION = `
  mutation Demo($url: String!, $selector: String!) {
    goto(url: $url, waitUntil: networkIdle) {
      status
      time
    }
    extracted: text(selector: $selector) {
      text
    }
    shot: screenshot(type: png) {
      base64
    }
  }
`;

export default async function run({ url, flags }) {
  const selector = selectorFor(url, flags.selector);

  log.step(`one GraphQL mutation against ${c.bold(url)}`);
  log.note(`endpoint: ${cfg.baseUrl}${cfg.bqlPath}`);
  log.note(`navigate + read ${c.magenta(selector)} + screenshot, in a single round trip`);

  // replay=true records the session the moment Browserless starts executing.
  const opts = flags.replay ? { query: { replay: 'true' } } : {};
  if (flags.replay) log.note('recording enabled - look under Session Replay afterwards');

  let result;
  try {
    result = await bql(MUTATION, { url, selector }, opts);
  } catch (err) {
    // The common failure is a selector the page does not have - say so plainly
    // instead of blaming the plan.
    if (/selector/i.test(err.message) && /timeout/i.test(err.message)) {
      err.hint = `"${selector}" never appeared on this page. Pass one that exists, e.g. --selector "body"`;
    }
    throw err;
  }

  const { data, ms } = result;
  const artifacts = [];

  if (data.goto) log.ok(`navigated: HTTP ${data.goto.status} in ${Math.round(data.goto.time ?? 0)}ms`);
  if (data.extracted?.text) log.ok(`${c.magenta(selector)}: ${c.bold(oneLine(data.extracted.text, 70))}`);

  if (data.shot?.base64) {
    const file = save('bql-screenshot.png', Buffer.from(data.shot.base64, 'base64'));
    artifacts.push({ ...file, kind: 'image', label: 'BrowserQL screenshot' });
    reportArtifact(file);
  }

  const jsonFile = saveJson('bql-result.json', data);
  artifacts.push({ ...jsonFile, kind: 'json', label: 'BrowserQL response' });
  reportArtifact(jsonFile);
  log.note(`${ms}ms for the whole session`);

  return {
    artifacts,
    facts: {
      status: data.goto?.status ?? 'n/a',
      selector,
      text: oneLine(data.extracted?.text ?? 'none', 50),
      'total latency': `${ms}ms`,
    },
  };
}
