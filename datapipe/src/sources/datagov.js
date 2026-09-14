import { cfg } from '../config.js';
import { log, c, humanSize } from '../log.js';

// data.gov runs CKAN, which has a real API - so this uses it rather than
// scraping the site. Popularity sorting depends on CKAN's tracking plugin
// being enabled, which not every portal does, so we try the strategies in
// order of how well they answer "what is hot right now" and keep the first
// one the server actually accepts.
const SORT_STRATEGIES = [
  { sort: 'views_recent desc', label: 'most viewed this week' },
  { sort: 'views_total desc', label: 'most viewed overall' },
  { sort: 'metadata_modified desc', label: 'most recently updated' },
  { sort: 'score desc, metadata_modified desc', label: 'catalogue default ranking' },
];

async function ckan(action, params, timeoutMs = 30_000) {
  const url = new URL(`${cfg.ckanBaseUrl}/api/3/action/${action}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'datapipe/0.1 (open data pipeline)' },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const detail = body?.error?.message ?? body?.error?.__type ?? `HTTP ${res.status}`;
      const err = new Error(`CKAN ${action} failed: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function normaliseDataset(pkg) {
  return {
    id: pkg.id,
    name: pkg.name,
    title: pkg.title || pkg.name,
    notes: pkg.notes || '',
    organization: pkg.organization?.title || pkg.organization?.name || 'unknown',
    landingPage: `${cfg.ckanBaseUrl}/dataset/${pkg.name}`,
    modified: pkg.metadata_modified,
    license: pkg.license_title || null,
    tags: (pkg.tags || []).map((t) => t.display_name || t.name).slice(0, 12),
    resourceCount: pkg.num_resources ?? (pkg.resources || []).length,
  };
}

/** First resource in an allowed format that has a URL and is not obviously huge. */
function pickResource(pkg) {
  for (const res of pkg.resources || []) {
    const format = String(res.format || '').toUpperCase();
    if (!cfg.allowedFormats.includes(format)) continue;
    if (!res.url || !/^https?:\/\//i.test(res.url)) continue;
    const size = Number(res.size);
    if (Number.isFinite(size) && size > cfg.maxDownloadBytes) continue;
    return {
      url: res.url,
      format,
      name: res.name || res.id,
      size: Number.isFinite(size) ? size : null,
      description: res.description || '',
    };
  }
  return null;
}

/**
 * Find a dataset worth analysing this hour.
 * `skip` is the set of dataset ids handled recently, so the pipeline moves on
 * instead of re-analysing the same file every run.
 */
export async function findDataset({ skip = new Set(), rows = 50 } = {}) {
  const formatFilter = `res_format:(${cfg.allowedFormats.join(' OR ')})`;
  let lastError = null;

  for (const strategy of SORT_STRATEGIES) {
    try {
      log.step(`searching by ${c.magenta(strategy.label)}`);
      const result = await ckan('package_search', {
        q: '',
        fq: formatFilter,
        rows: String(rows),
        sort: strategy.sort,
      });

      const packages = result.results || [];
      log.note(`${result.count?.toLocaleString?.() ?? '?'} datasets match; examining top ${packages.length}`);

      for (const pkg of packages) {
        if (skip.has(pkg.id)) continue;
        const resource = pickResource(pkg);
        if (!resource) continue;
        const dataset = normaliseDataset(pkg);
        log.ok(`picked ${c.bold(dataset.title)}`);
        log.note(`${dataset.organization} - ${resource.format}${resource.size ? `, ${humanSize(resource.size)}` : ''}`);
        return { dataset, resource, strategy: strategy.label, rank: packages.indexOf(pkg) + 1 };
      }
      log.warn('no unseen dataset with a usable resource in this page of results');
    } catch (err) {
      lastError = err;
      // An unsupported sort field is a 4xx - move to the next strategy rather
      // than giving up on the whole run.
      log.warn(`${strategy.label} unavailable (${err.message.slice(0, 90)})`);
    }
  }

  const err = new Error('No suitable dataset found across any sort strategy');
  err.cause = lastError;
  throw err;
}
