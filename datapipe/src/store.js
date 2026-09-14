import fs from 'node:fs';
import path from 'node:path';
import { dataDir, runsDir, ensureDirs } from './config.js';

const statePath = path.join(dataDir, 'state.json');

const EMPTY = { seenDatasets: {}, lastRunAt: null, lastDigestAt: null };

export function loadState() {
  ensureDirs();
  if (!fs.existsSync(statePath)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

export function saveState(state) {
  ensureDirs();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function markSeen(state, datasetId) {
  state.seenDatasets[datasetId] = new Date().toISOString();
  return state;
}

/** Datasets touched within the cooldown window are skipped when picking. */
export function recentlySeen(state, cooldownHours = 168) {
  const cutoff = Date.now() - cooldownHours * 3600_000;
  return new Set(
    Object.entries(state.seenDatasets)
      .filter(([, iso]) => Date.parse(iso) > cutoff)
      .map(([id]) => id),
  );
}

export function saveRun(run) {
  ensureDirs();
  const name = `${run.startedAt.replace(/[:.]/g, '-')}.json`;
  const file = path.join(runsDir, name);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

export function listRuns({ sinceMs = null, limit = 200 } = {}) {
  ensureDirs();
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
  const runs = [];
  for (const file of files) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
      if (sinceMs && Date.parse(run.startedAt) < sinceMs) continue;
      runs.push(run);
    } catch {
      // A half-written run file should never break the dashboard.
    }
  }
  return runs;
}
