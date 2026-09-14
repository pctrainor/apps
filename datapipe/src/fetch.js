import fs from 'node:fs';
import path from 'node:path';
import { cfg, downloadsDir, ensureDirs } from './config.js';
import { log, humanSize } from './log.js';

/**
 * Download a resource with a hard size ceiling.
 * Open-data portals happily serve multi-gigabyte files, so the cap is enforced
 * while streaming rather than trusting Content-Length.
 */
export async function downloadResource(resource, { maxBytes = cfg.maxDownloadBytes, timeoutMs = 120_000 } = {}) {
  ensureDirs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(resource.url, {
      headers: { 'User-Agent': 'datapipe/0.1 (open data pipeline)', Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${resource.url}`);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`resource is ${humanSize(declared)}, over the ${humanSize(maxBytes)} cap`);
    }

    const chunks = [];
    let bytes = 0;
    let capped = false;

    for await (const chunk of res.body) {
      chunks.push(Buffer.from(chunk));
      bytes += chunk.length;
      if (bytes > maxBytes) {
        capped = true;
        await res.body.cancel?.().catch(() => {});
        break;
      }
    }

    let buffer = Buffer.concat(chunks);
    if (capped) {
      // A partial CSV is still analysable if we cut cleanly at a row boundary.
      // Partial JSON is not, and will fail at parse time with a clear message.
      const lastNewline = buffer.lastIndexOf(0x0a);
      if (resource.format === 'CSV' && lastNewline > 0) buffer = buffer.subarray(0, lastNewline + 1);
      log.warn(`hit the ${humanSize(maxBytes)} cap - analysing the first ${humanSize(buffer.length)}`);
    }

    const safeName = `${Date.now()}-${(resource.name || 'resource').replace(/[^a-z0-9._-]/gi, '_')}`.slice(0, 120);
    const ext = resource.format === 'JSON' ? '.json' : '.csv';
    const file = path.join(downloadsDir, safeName.endsWith(ext) ? safeName : safeName + ext);
    fs.writeFileSync(file, buffer);

    log.ok(`downloaded ${humanSize(buffer.length)}`);
    log.note(file);

    return {
      path: file,
      bytes: buffer.length,
      capped,
      contentType: res.headers.get('content-type') || null,
      text: buffer.toString('utf8'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the downloads directory from growing without bound. */
export function pruneDownloads(keep = 20) {
  if (!fs.existsSync(downloadsDir)) return;
  const files = fs
    .readdirSync(downloadsDir)
    .map((f) => ({ f, t: fs.statSync(path.join(downloadsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(downloadsDir, f));
    } catch {
      // best effort
    }
  }
}
