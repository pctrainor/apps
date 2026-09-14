import { cfg, requireToken } from './config.js';

export class BrowserlessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrowserlessError';
    Object.assign(this, details);
  }
}

// Turn the common failure modes into something you can act on immediately.
function hintFor(status) {
  switch (status) {
    case 400:
      return 'Bad request — check the JSON body against the endpoint schema.';
    case 401:
    case 403:
      return `Token rejected or endpoint not on your plan. Verify BROWSERLESS_TOKEN in ${cfg.envPath}.`;
    case 404:
      return 'Endpoint not found — confirm the path and your region base URL.';
    case 408:
    case 524:
      return 'The page took too long. Raise BROWSERLESS_TIMEOUT_MS or relax gotoOptions.waitUntil.';
    case 429:
      return 'Rate limited / all concurrent sessions busy. Retry, or run demos one at a time.';
    default:
      return status >= 500 ? 'Browserless-side error. Retry; if it persists check status.browserless.io.' : '';
  }
}

/**
 * POST to a Browserless endpoint.
 * Returns { status, ms, contentType, buffer, text, json } — decoded lazily by type.
 */
export async function blPost(endpoint, body, opts = {}) {
  const {
    contentType = 'application/json',
    accept = 'application/json',
    timeoutMs = cfg.timeoutMs,
    query = {},
  } = opts;

  const url = new URL(cfg.baseUrl + endpoint);
  url.searchParams.set('token', requireToken());
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Accept: accept },
      body: payload,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new BrowserlessError(`Timed out after ${timeoutMs}ms calling ${endpoint}`, {
        endpoint,
        hint: 'Raise BROWSERLESS_TIMEOUT_MS in .env, or use a lighter gotoOptions.waitUntil.',
      });
    }
    throw new BrowserlessError(`Could not reach ${cfg.baseUrl}${endpoint}: ${err.message}`, {
      endpoint,
      hint: 'Check your network/DNS and that BROWSERLESS_BASE_URL points at a real region.',
    });
  }
  clearTimeout(timer);

  const ms = Date.now() - started;
  const buffer = Buffer.from(await res.arrayBuffer());
  const resType = res.headers.get('content-type') || '';

  if (!res.ok) {
    const bodyText = buffer.toString('utf8').slice(0, 600);
    throw new BrowserlessError(`HTTP ${res.status} from ${endpoint}: ${bodyText || res.statusText}`, {
      status: res.status,
      endpoint,
      body: bodyText,
      hint: hintFor(res.status),
    });
  }

  const result = { status: res.status, ms, contentType: resType, buffer };
  if (resType.includes('json')) {
    try {
      result.json = JSON.parse(buffer.toString('utf8'));
    } catch {
      result.text = buffer.toString('utf8');
    }
  } else if (resType.startsWith('text/') || resType.includes('html')) {
    result.text = buffer.toString('utf8');
  }
  return result;
}

/** POST a BrowserQL (GraphQL) document to the /bql endpoint. */
export async function bql(query, variables = {}, opts = {}) {
  const res = await blPost(cfg.bqlPath, { query, variables }, opts);
  const payload = res.json ?? JSON.parse(res.buffer.toString('utf8'));
  if (payload.errors?.length) {
    throw new BrowserlessError(`BrowserQL error: ${payload.errors.map((e) => e.message).join('; ')}`, {
      endpoint: cfg.bqlPath,
      hint: 'BrowserQL is a paid add-on on some plans; also try BROWSERLESS_BQL_PATH=/chrome/bql',
    });
  }
  return { data: payload.data, ms: res.ms };
}
