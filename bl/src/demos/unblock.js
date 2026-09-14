import { blPost } from '../client.js';
import { log, save, saveJson, reportArtifact, c, humanSize } from '../out.js';

export const meta = {
  summary: 'Stealth fetch: fingerprint randomisation, CAPTCHA handling, real cookies',
  useCase: 'Pages that block plain headless Chrome. Note: /unblock is plan-gated.',
};

export default async function run({ url }) {
  log.step(`unblocking ${c.bold(url)}`);
  log.note('asking for content + cookies + screenshot in one call');

  const res = await blPost('/unblock', {
    url,
    browserWSEndpoint: false, // true would hand back a ws:// URL to keep driving the session
    cookies: true,
    content: true,
    screenshot: true,
    ttl: 0,
  });

  const payload = res.json ?? JSON.parse(res.buffer.toString('utf8'));
  const artifacts = [];

  if (payload.content) {
    const file = save('unblock-content.html', payload.content);
    artifacts.push({ ...file, kind: 'html', label: 'Unblocked HTML' });
    reportArtifact(file);
  }

  if (payload.screenshot) {
    const file = save('unblock.png', Buffer.from(payload.screenshot, 'base64'));
    artifacts.push({ ...file, kind: 'image', label: 'Unblocked screenshot' });
    reportArtifact(file);
  }

  const cookies = payload.cookies ?? [];
  if (cookies.length) {
    const file = saveJson('unblock-cookies.json', cookies);
    artifacts.push({ ...file, kind: 'json', label: 'Session cookies' });
    reportArtifact(file);
    log.note(`${cookies.length} cookie(s): ${cookies.slice(0, 5).map((ck) => ck.name).join(', ')}`);
  }

  log.ok(`solved and returned in ${res.ms}ms`);

  return {
    artifacts,
    facts: {
      html: payload.content ? humanSize(Buffer.byteLength(payload.content)) : 'not returned',
      screenshot: payload.screenshot ? 'captured' : 'not returned',
      cookies: cookies.length,
      latency: `${res.ms}ms`,
    },
  };
}
