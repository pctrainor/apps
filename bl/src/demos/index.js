// Demos are loaded lazily so one missing optional dependency (puppeteer-core)
// never stops the rest from running.
export const registry = {
  screenshot: () => import('./screenshot.js'),
  pdf: () => import('./pdf.js'),
  content: () => import('./content.js'),
  scrape: () => import('./scrape.js'),
  function: () => import('./function.js'),
  bql: () => import('./bql.js'),
  unblock: () => import('./unblock.js'),
  performance: () => import('./performance.js'),
  puppeteer: () => import('./puppeteer.js'),
  replay: () => import('./replay.js'),
  profile: () => import('./profile.js'),
};

// Order used by `node index.js all` - cheap and reliable first, slow last.
export const runAllOrder = [
  'screenshot',
  'pdf',
  'content',
  'scrape',
  'function',
  'bql',
  'unblock',
  'puppeteer',
  'replay',
  'profile',
  'performance',
];

export const demoNames = Object.keys(registry);

export async function loadDemo(name) {
  const loader = registry[name];
  if (!loader) throw new Error(`Unknown demo "${name}". Try one of: ${demoNames.join(', ')}`);
  return loader();
}
