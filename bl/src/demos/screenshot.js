import { blPost } from '../client.js';
import { log, save, reportArtifact, c } from '../out.js';

export const meta = {
  summary: 'Full-page PNG at 2x retina, plus a cropped hero shot',
  useCase: 'Social preview images, visual regression snapshots, "print the page" buttons.',
};

export default async function run({ url }) {
  const artifacts = [];

  log.step(`full-page capture of ${c.bold(url)}`);
  const full = await blPost(
    '/screenshot',
    {
      url,
      options: { fullPage: true, type: 'png' },
      viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
      gotoOptions: { waitUntil: 'networkidle2' },
      // Kill cookie banners and other fixed overlays before the shot.
      addStyleTag: [{ content: '[class*="cookie"],[id*="cookie"],[class*="consent"]{display:none !important}' }],
    },
    { accept: 'image/png' },
  );
  const fullFile = save('screenshot-full.png', full.buffer);
  artifacts.push({ ...fullFile, kind: 'image', label: 'Full page (2x)' });
  reportArtifact(fullFile);
  log.note(`${full.ms}ms round trip`);

  log.step('above-the-fold JPEG (smaller, good for thumbnails)');
  const hero = await blPost(
    '/screenshot',
    {
      url,
      options: { fullPage: false, type: 'jpeg', quality: 80 },
      viewport: { width: 1200, height: 630 },
      gotoOptions: { waitUntil: 'domcontentloaded' },
    },
    { accept: 'image/jpeg' },
  );
  const heroFile = save('screenshot-hero.jpg', hero.buffer);
  artifacts.push({ ...heroFile, kind: 'image', label: 'Hero 1200x630 (JPEG)' });
  reportArtifact(heroFile);
  log.note(`${hero.ms}ms round trip`);

  return {
    artifacts,
    facts: {
      'full page': `${(fullFile.bytes / 1024).toFixed(0)} KB in ${full.ms}ms`,
      'hero jpeg': `${(heroFile.bytes / 1024).toFixed(0)} KB in ${hero.ms}ms`,
    },
  };
}
