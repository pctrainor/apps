import { mean, median, stddev, quantile, skewness } from './stats.js';

// Values that mean "missing" in real-world open data.
const NULL_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nil', 'none', 'nan', '-', '--', '?', 'unknown', 'not available']);
const TRUE_TOKENS = new Set(['true', 'yes', 'y', 't', '1']);
const FALSE_TOKENS = new Set(['false', 'no', 'n', 'f', '0']);

const DATE_SHAPES = [
  /^\d{4}-\d{1,2}-\d{1,2}([T ]|$)/, // 2024-01-31
  /^\d{1,2}\/\d{1,2}\/\d{4}/, //       01/31/2024
  /^\d{4}\/\d{1,2}\/\d{1,2}/, //       2024/01/31
  /^\d{1,2}-[A-Za-z]{3}-\d{2,4}/, //   31-Jan-2024
];

export const isNull = (v) => NULL_TOKENS.has(String(v ?? '').trim().toLowerCase());

/** Numbers in open data arrive wearing currency symbols, commas and percent signs. */
export function toNumber(value) {
  const cleaned = String(value).trim().replace(/[$£€,\s]/g, '').replace(/%$/, '').replace(/^\((.*)\)$/, '-$1');
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

export function toDate(value) {
  const str = String(value).trim();
  if (!DATE_SHAPES.some((re) => re.test(str))) return null;
  const ms = Date.parse(str);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function classify(values) {
  let numbers = 0;
  let dates = 0;
  let booleans = 0;
  let integers = 0;
  for (const v of values) {
    if (toDate(v)) {
      dates += 1;
      continue;
    }
    const n = toNumber(v);
    if (!Number.isNaN(n)) {
      numbers += 1;
      if (Number.isInteger(n)) integers += 1;
      continue;
    }
    const lower = String(v).trim().toLowerCase();
    if (TRUE_TOKENS.has(lower) || FALSE_TOKENS.has(lower)) booleans += 1;
  }
  const total = values.length || 1;
  // 80% agreement is enough - real columns always have a few stragglers.
  if (dates / total >= 0.8) return { type: 'date', mixed: dates < total };
  if (numbers / total >= 0.8) {
    return { type: integers === numbers ? 'integer' : 'number', mixed: numbers < total };
  }
  if (booleans / total >= 0.8) return { type: 'boolean', mixed: booleans < total };
  return { type: 'string', mixed: false };
}

export function profileColumn(name, index, rawValues) {
  const present = rawValues.filter((v) => !isNull(v));
  const nullCount = rawValues.length - present.length;
  const { type, mixed } = classify(present.slice(0, 2000));

  const distinctSet = new Set();
  const counts = new Map();
  for (const v of present) {
    const key = String(v).trim();
    if (distinctSet.size < 100_000) distinctSet.add(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.size > 50_000) counts.delete(counts.keys().next().value);
  }

  const column = {
    name,
    index,
    type,
    mixedTypes: mixed,
    count: rawValues.length,
    nonNull: present.length,
    nullCount,
    nullRate: rawValues.length ? nullCount / rawValues.length : 0,
    distinct: distinctSet.size,
    distinctRatio: present.length ? distinctSet.size / present.length : 0,
    samples: present.slice(0, 5).map((v) => String(v).slice(0, 60)),
  };

  if (type === 'number' || type === 'integer') {
    const nums = present.map(toNumber).filter((n) => !Number.isNaN(n));
    if (nums.length) {
      const sorted = [...nums].sort((a, b) => a - b);
      column.numeric = {
        n: nums.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: mean(nums),
        median: median(nums),
        stddev: stddev(nums),
        q1: quantile(sorted, 0.25),
        q3: quantile(sorted, 0.75),
        skewness: skewness(nums),
        zeros: nums.filter((n) => n === 0).length,
        negatives: nums.filter((n) => n < 0).length,
      };
    }
  }

  if (type === 'date') {
    const dates = present.map(toDate).filter(Boolean).map((d) => d.getTime());
    if (dates.length) {
      column.temporal = {
        n: dates.length,
        min: new Date(Math.min(...dates)).toISOString(),
        max: new Date(Math.max(...dates)).toISOString(),
        futureCount: dates.filter((t) => t > Date.now()).length,
      };
    }
  }

  if (type === 'string' || type === 'boolean') {
    column.top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([value, count]) => ({ value: value.slice(0, 60), count }));
  }

  // High-cardinality numeric/string columns are usually identifiers, not
  // measurements - worth knowing before correlating anything against them.
  column.looksLikeId =
    column.distinctRatio > 0.95 && present.length > 20 && (type !== 'date');

  return column;
}

export function profileTable({ headers, rows, truncated }) {
  const columns = headers.map((name, i) => profileColumn(name, i, rows.map((r) => r[i] ?? '')));

  // Duplicate detection on a hash of the joined row.
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = row.join('');
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    truncated: Boolean(truncated),
    duplicateRows: duplicates,
    columns,
    numericColumns: columns.filter((c) => c.numeric && !c.looksLikeId).map((c) => c.name),
    dateColumns: columns.filter((c) => c.temporal).map((c) => c.name),
    categoricalColumns: columns
      .filter((c) => (c.type === 'string' || c.type === 'boolean') && c.distinct >= 2 && c.distinct <= 25)
      .map((c) => c.name),
  };
}

/** Compact form sent to the LLM - schema and statistics only, never raw rows. */
export function summariseForModel(profile, dataset) {
  return {
    dataset: {
      title: dataset?.title,
      organization: dataset?.organization,
      description: String(dataset?.notes ?? '').slice(0, 600),
    },
    shape: { rows: profile.rowCount, columns: profile.columnCount, truncated: profile.truncated },
    columns: profile.columns.map((col) => {
      const out = {
        name: col.name,
        type: col.type,
        nullRate: Number(col.nullRate.toFixed(3)),
        distinct: col.distinct,
        looksLikeId: col.looksLikeId,
      };
      if (col.numeric) {
        out.stats = {
          min: col.numeric.min,
          max: col.numeric.max,
          mean: Number(col.numeric.mean.toFixed(4)),
          median: col.numeric.median,
          stddev: Number(col.numeric.stddev.toFixed(4)),
          skewness: Number((col.numeric.skewness || 0).toFixed(3)),
        };
      }
      if (col.temporal) out.range = { from: col.temporal.min, to: col.temporal.max };
      if (col.top) out.topValues = col.top.slice(0, 5);
      return out;
    }),
  };
}
