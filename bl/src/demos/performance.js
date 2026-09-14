import { blPost } from '../client.js';
import { cfg } from '../config.js';
import { log, saveJson, reportArtifact, c } from '../out.js';

export const meta = {
  summary: 'Lighthouse audit (performance, SEO, accessibility, best practices)',
  useCase: 'Track Core Web Vitals per deploy, or audit competitor pages on a schedule.',
};

// Lighthouse is slow by nature - give it room beyond the normal request timeout.
const TIMEOUT = Math.max(cfg.timeoutMs * 3, 120_000);

function findLighthouse(payload) {
  return payload?.categories ? payload : payload?.data ?? payload?.lhr ?? payload;
}

export default async function run({ url }) {
  log.step(`auditing ${c.bold(url)} - this one takes 30-90s`);

  const res = await blPost(
    '/performance',
    {
      url,
      config: {
        extends: 'lighthouse:default',
        settings: {
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          formFactor: 'desktop',
          screenEmulation: { disabled: true },
        },
      },
    },
    { timeoutMs: TIMEOUT },
  );

  const payload = res.json ?? JSON.parse(res.buffer.toString('utf8'));
  const lhr = findLighthouse(payload);
  const categories = lhr.categories ?? {};

  const scores = {};
  for (const [key, category] of Object.entries(categories)) {
    const score = Math.round((category.score ?? 0) * 100);
    scores[category.title ?? key] = score;
    const colour = score >= 90 ? c.green : score >= 50 ? c.yellow : c.red;
    log.ok(`${(category.title ?? key).padEnd(16)} ${colour(c.bold(String(score).padStart(3)))}/100`);
  }

  // The metrics people actually argue about in standups.
  const vitals = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'];
  const metrics = {};
  for (const id of vitals) {
    const audit = lhr.audits?.[id];
    if (audit?.displayValue) {
      metrics[audit.title ?? id] = audit.displayValue;
      log.note(`${(audit.title ?? id).padEnd(26)} ${audit.displayValue}`);
    }
  }

  const file = saveJson('lighthouse.json', lhr);
  reportArtifact(file);
  log.note(`${(res.ms / 1000).toFixed(1)}s round trip`);

  return {
    artifacts: [{ ...file, kind: 'json', label: 'Lighthouse report' }],
    facts: { ...scores, ...metrics },
  };
}
