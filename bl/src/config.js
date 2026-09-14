import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outputDir = path.join(rootDir, 'output');

const envPath = path.join(rootDir, '.env');
const examplePath = path.join(rootDir, '.env.example');

// Tiny .env reader so the project stays dependency-free. Existing process.env
// values win, which lets you do: BROWSERLESS_TOKEN=xyz npm run screenshot
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// "make env": first run creates .env from the template so there is always a
// single, obvious place to paste the token.
export function ensureEnvFile() {
  if (fs.existsSync(envPath) || !fs.existsSync(examplePath)) return false;
  fs.copyFileSync(examplePath, envPath);
  return true;
}

export const envWasCreated = ensureEnvFile();
loadEnvFile(envPath);

export const cfg = {
  token: process.env.BROWSERLESS_TOKEN?.trim() || '',
  baseUrl: (process.env.BROWSERLESS_BASE_URL?.trim() || 'https://production-sfo.browserless.io').replace(/\/+$/, ''),
  bqlPath: process.env.BROWSERLESS_BQL_PATH?.trim() || '/chromium/bql',
  demoUrl: process.env.DEMO_URL?.trim() || 'https://news.ycombinator.com',
  timeoutMs: Number(process.env.BROWSERLESS_TIMEOUT_MS) || 60_000,
  envPath,
};

export function requireToken() {
  if (cfg.token) return cfg.token;
  throw new Error(
    `No BROWSERLESS_TOKEN set.\n  Paste your token into ${cfg.envPath}\n  (get it from https://account.browserless.io)`,
  );
}

// wss:// endpoint used by puppeteer.connect(). Extra params are how Browserless
// features get switched on: replay=true, profile=<name>, headless=false, ...
export function wsEndpoint(pathname = '', params = {}) {
  const url = new URL(cfg.baseUrl.replace(/^http/, 'ws') + pathname);
  url.searchParams.set('token', requireToken());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Same URL with the token blanked out, for printing. */
export function redact(url) {
  return String(url).replace(/(token=)[^&]+/, '$1<token>');
}
