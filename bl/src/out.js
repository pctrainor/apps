import fs from 'node:fs';
import path from 'node:path';
import { outputDir } from './config.js';

const ESC = String.fromCharCode(27);
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : String(s));

export const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('36'),
  magenta: paint('35'),
};

export const log = {
  title: (s) => console.log(`\n${c.bold(c.blue('> ' + s))}`),
  step: (s) => console.log(`  ${c.dim('-')} ${s}`),
  ok: (s) => console.log(`  ${c.green('OK')} ${s}`),
  warn: (s) => console.log(`  ${c.yellow('!')} ${s}`),
  fail: (s) => console.log(`  ${c.red('x')} ${s}`),
  note: (s) => console.log(`     ${c.dim(s)}`),
};

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function save(filename, data) {
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, filename);
  fs.writeFileSync(file, data);
  return { file, name: filename, bytes: Buffer.byteLength(data) };
}

export function saveJson(filename, value) {
  return save(filename, JSON.stringify(value, null, 2));
}

export function reportArtifact({ file, name, bytes }) {
  log.ok(`saved ${c.bold(name)} ${c.dim(`(${humanSize(bytes)})`)}`);
  log.note(file);
}

/** Collapse whitespace so scraped text prints on one tidy line. */
export function oneLine(s, max = 80) {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}
