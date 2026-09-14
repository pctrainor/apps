import { bql } from '../client.js';
import { cfg } from '../config.js';
import { log, save, saveJson, reportArtifact, c, oneLine } from '../out.js';

export const meta = {
  summary: 'BrowserQL - describe the whole session as one GraphQL mutation',
  useCase: 'One round trip instead of ten; the stealth layer is built in.',
};

// Each field is a step, executed top to bottom in a single browser session.
const MUTATION = `
  mutation Demo($url: String!) {
    goto(url: $url, waitUntil: networkIdle) {
      status
      time
    }
    heading: text(selector: "h1") {
      text
    }
    shot: screenshot(type: png) {
      base64
    }
  }
`;

export default async function run({ url }) {
  log.step(`one GraphQL mutation against ${c.bold(url)}`);
  log.note(`endpoint: ${cfg.baseUrl}${cfg.bqlPath}`);

  const { data, ms } = await bql(MUTATION, { url });
  const artifacts = [];

  if (data.goto) log.ok(`navigated: HTTP ${data.goto.status} in ${Math.round(data.goto.time ?? 0)}ms`);
  if (data.heading?.text) log.ok(`h1: ${c.bold(oneLine(data.heading.text, 70))}`);

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
      h1: oneLine(data.heading?.text ?? 'none found', 50),
      'total latency': `${ms}ms`,
    },
  };
}
