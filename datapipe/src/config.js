import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = path.join(rootDir, 'data');
export const runsDir = path.join(dataDir, 'runs');
export const downloadsDir = path.join(dataDir, 'downloads');

const envPath = path.join(rootDir, '.env');
const examplePath = path.join(rootDir, '.env.example');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

export const envWasCreated = (() => {
  if (fs.existsSync(envPath) || !fs.existsSync(examplePath)) return false;
  fs.copyFileSync(examplePath, envPath);
  return true;
})();

loadEnvFile(envPath);

const num = (key, fallback) => Number(process.env[key]) || fallback;

export const cfg = {
  ckanBaseUrl: (process.env.CKAN_BASE_URL || 'https://catalog.data.gov').replace(/\/+$/, ''),
  allowedFormats: (process.env.ALLOWED_FORMATS || 'CSV,JSON').split(',').map((f) => f.trim().toUpperCase()),
  maxDownloadBytes: num('MAX_DOWNLOAD_BYTES', 40 * 1024 * 1024),
  maxRows: num('MAX_ROWS', 50_000),

  awsRegion: process.env.AWS_REGION || 'us-east-1',
  bedrockModel: process.env.BEDROCK_MODEL || 'anthropic.claude-haiku-4-5',

  browserlessToken: (process.env.BROWSERLESS_TOKEN || '').trim(),
  browserlessBaseUrl: (process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io').replace(/\/+$/, ''),

  envPath,
};

export function ensureDirs() {
  for (const dir of [dataDir, runsDir, downloadsDir]) fs.mkdirSync(dir, { recursive: true });
}
