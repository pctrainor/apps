import fs from 'node:fs';
import path from 'node:path';
import { cfg, dataDir } from './config.js';
import { log } from './log.js';

/**
 * Optional: capture the dataset's landing page for the dashboard.
 *
 * Note the division of labour here - data.gov has a real API, so discovery and
 * download go through CKAN, not a browser. Browserless earns its place only
 * for the one thing an API cannot give you: a picture of the page.
 */
export async function screenshotLandingPage(url, slug) {
  if (!cfg.browserlessToken) return null;

  try {
    const endpoint = `${cfg.browserlessBaseUrl}/screenshot?token=${encodeURIComponent(cfg.browserlessToken)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: { fullPage: false, type: 'jpeg', quality: 70 },
        viewport: { width: 1200, height: 750 },
        gotoOptions: { waitUntil: 'domcontentloaded' },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      log.warn(`landing page screenshot failed (HTTP ${res.status})`);
      return null;
    }

    const shotsDir = path.join(dataDir, 'shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const file = path.join(shotsDir, `${slug}.jpg`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    log.ok('captured the dataset landing page');
    return path.relative(dataDir, file);
  } catch (err) {
    log.warn(`landing page screenshot skipped: ${err.message}`);
    return null;
  }
}
