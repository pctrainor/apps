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

const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  phase: (s) => console.log(`\n${c.dim(stamp())} ${c.bold(c.blue('> ' + s))}`),
  step: (s) => console.log(`  ${c.dim('-')} ${s}`),
  ok: (s) => console.log(`  ${c.green('OK')} ${s}`),
  warn: (s) => console.log(`  ${c.yellow('!')} ${s}`),
  fail: (s) => console.log(`  ${c.red('x')} ${s}`),
  note: (s) => console.log(`     ${c.dim(s)}`),
};

export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function oneLine(s, max = 90) {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}
