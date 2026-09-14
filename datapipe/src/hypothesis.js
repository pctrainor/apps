import { askBedrock, extractJsonArray } from './bedrock.js';
import { summariseForModel, toNumber, toDate, isNull } from './profile.js';
import { pearson, cohensD, linearSlope } from './stats.js';
import { log, c } from './log.js';

// The only test shapes the verifier knows how to run. The model is told to
// stay inside this vocabulary so that every hypothesis is machine-checkable.
const VOCABULARY = `
{"type":"correlation","x":"<numeric column>","y":"<numeric column>","expect":"positive"|"negative"}
{"type":"group_difference","group":"<categorical column>","value":"<numeric column>","expect":"differs"}
{"type":"trend","time":"<date column>","value":"<numeric column>","expect":"increasing"|"decreasing"}
{"type":"distribution","column":"<numeric column>","expect":"skewed"|"symmetric"}
`.trim();

const SYSTEM = `You are a data analyst generating falsifiable hypotheses about a dataset you have only seen summary statistics for.
You never see the raw rows, so your hypotheses are genuine predictions that will be tested against the real data.
Prefer hypotheses that are substantively interesting about the subject matter, not restatements of the schema.
Never propose a relationship between a column and a trivially derived version of itself.
Respond with a JSON array and nothing else.`;

function buildPrompt(summary) {
  const numeric = summary.columns.filter((col) => col.stats && !col.looksLikeId).map((col) => col.name);
  const categorical = summary.columns.filter((col) => col.topValues).map((col) => col.name);
  const dates = summary.columns.filter((col) => col.range).map((col) => col.name);

  return `Here is a profile of an open-government dataset.

${JSON.stringify(summary, null, 2)}

Columns you may reference:
- numeric: ${numeric.join(', ') || '(none)'}
- categorical: ${categorical.join(', ') || '(none)'}
- date: ${dates.join(', ') || '(none)'}

Propose up to 5 hypotheses. Each must be an object:
{
  "statement": "one sentence, stated so it could be proven wrong",
  "rationale": "one sentence on why you expect this, given the subject matter",
  "test": <one of the shapes below>
}

Test shapes:
${VOCABULARY}

Rules:
- Only reference column names from the lists above, spelled exactly.
- Only use numeric columns where a numeric column is required.
- If there are no usable columns for a shape, do not use that shape.
Respond with the JSON array only.`;
}

/** Reject anything referencing columns that don't exist or are the wrong kind. */
function validate(raw, profile) {
  const byName = new Map(profile.columns.map((col) => [col.name, col]));
  const isNumeric = (n) => byName.get(n)?.numeric && !byName.get(n)?.looksLikeId;
  const isDate = (n) => Boolean(byName.get(n)?.temporal);
  const isCategorical = (n) => {
    const col = byName.get(n);
    return col && (col.type === 'string' || col.type === 'boolean') && col.distinct >= 2 && col.distinct <= 25;
  };

  const valid = [];
  const rejected = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const test = item?.test;
    const statement = typeof item?.statement === 'string' ? item.statement.trim() : '';
    if (!statement || !test?.type) {
      rejected.push({ item, why: 'missing statement or test' });
      continue;
    }

    let ok = false;
    if (test.type === 'correlation') ok = isNumeric(test.x) && isNumeric(test.y) && test.x !== test.y;
    else if (test.type === 'group_difference') ok = isCategorical(test.group) && isNumeric(test.value);
    else if (test.type === 'trend') ok = (isDate(test.time) || isNumeric(test.time)) && isNumeric(test.value);
    else if (test.type === 'distribution') ok = isNumeric(test.column);

    if (ok) {
      valid.push({
        statement,
        rationale: typeof item.rationale === 'string' ? item.rationale.trim() : '',
        test,
        origin: 'predicted',
      });
    } else {
      rejected.push({ item, why: `references unusable column for ${test.type}` });
    }
  }
  return { valid, rejected };
}

/**
 * Fallback when Bedrock is unavailable: search the data for the strongest
 * relationships. These are *discovered*, not predicted - the report labels
 * them differently because finding them by search is not the same as
 * predicting them in advance.
 */
function discoverHypotheses(table, profile) {
  const idx = (name) => table.headers.indexOf(name);
  const nums = (name) => table.rows.map((r) => (isNull(r[idx(name)]) ? NaN : toNumber(r[idx(name)])));
  const pairUp = (a, b) => {
    const xs = [];
    const ys = [];
    for (let i = 0; i < a.length; i += 1) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        xs.push(a[i]);
        ys.push(b[i]);
      }
    }
    return [xs, ys];
  };

  const out = [];
  const numericNames = profile.numericColumns;
  const cache = new Map(numericNames.map((n) => [n, nums(n)]));

  // Strongest numeric pairs.
  const pairs = [];
  for (let i = 0; i < numericNames.length; i += 1) {
    for (let j = i + 1; j < numericNames.length; j += 1) {
      const [xs, ys] = pairUp(cache.get(numericNames[i]), cache.get(numericNames[j]));
      if (xs.length < 10) continue;
      const r = pearson(xs, ys);
      if (Number.isFinite(r)) pairs.push({ x: numericNames[i], y: numericNames[j], r });
    }
  }
  pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  // A near-perfect correlation is almost always the same quantity expressed
  // twice (a total and its component, a count and its rate). Reporting it as a
  // finding buries the relationships that are actually informative.
  const informative = pairs.filter((pair) => Math.abs(pair.r) < 0.995);
  for (const { x, y, r } of informative.slice(0, 3)) {
    if (Math.abs(r) < 0.3) break;
    out.push({
      statement: `${x} and ${y} move ${r > 0 ? 'together' : 'in opposite directions'}.`,
      rationale: 'Surfaced by scanning every numeric pair for the strongest linear relationship.',
      test: { type: 'correlation', x, y, expect: r > 0 ? 'positive' : 'negative' },
      origin: 'discovered',
    });
  }

  // Largest categorical split on a numeric measure.
  const splits = [];
  for (const group of profile.categoricalColumns) {
    for (const value of numericNames) {
      const gi = idx(group);
      const buckets = new Map();
      const vals = cache.get(value);
      for (let i = 0; i < table.rows.length; i += 1) {
        const key = isNull(table.rows[i][gi]) ? null : String(table.rows[i][gi]).trim();
        if (key === null || !Number.isFinite(vals[i])) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(vals[i]);
      }
      const usable = [...buckets.entries()].filter(([, v]) => v.length >= 10).sort((a, b) => b[1].length - a[1].length);
      if (usable.length < 2) continue;
      const d = cohensD(usable[0][1], usable[1][1]);
      if (Number.isFinite(d)) splits.push({ group, value, d, a: usable[0][0], b: usable[1][0] });
    }
  }
  splits.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  for (const s of splits.slice(0, 2)) {
    if (Math.abs(s.d) < 0.3) break;
    out.push({
      statement: `${s.value} differs between ${s.group} groups (for example ${s.a} vs ${s.b}).`,
      rationale: 'Surfaced by comparing every categorical split against every numeric measure.',
      test: { type: 'group_difference', group: s.group, value: s.value, expect: 'differs' },
      origin: 'discovered',
    });
  }

  // Strongest movement over time.
  if (profile.dateColumns.length) {
    const timeCol = profile.dateColumns[0];
    const ti = idx(timeCol);
    const times = table.rows.map((r) => {
      const d = isNull(r[ti]) ? null : toDate(r[ti]);
      return d ? d.getTime() / 86_400_000 : NaN;
    });
    let best = null;
    for (const value of numericNames) {
      const [xs, ys] = pairUp(times, cache.get(value));
      if (xs.length < 10) continue;
      const { slope, r } = linearSlope(xs, ys);
      if (Number.isFinite(r) && (!best || Math.abs(r) > Math.abs(best.r))) best = { value, slope, r };
    }
    if (best && Math.abs(best.r) >= 0.2) {
      out.push({
        statement: `${best.value} is ${best.slope > 0 ? 'rising' : 'falling'} over ${timeCol}.`,
        rationale: 'Surfaced by fitting a trend line for each numeric column against the date column.',
        test: { type: 'trend', time: timeCol, value: best.value, expect: best.slope > 0 ? 'increasing' : 'decreasing' },
        origin: 'discovered',
      });
    }
  }

  // Shape of the most skewed distribution.
  const skewed = profile.columns
    .filter((col) => col.numeric && !col.looksLikeId && Number.isFinite(col.numeric.skewness))
    .sort((a, b) => Math.abs(b.numeric.skewness) - Math.abs(a.numeric.skewness))[0];
  if (skewed && Math.abs(skewed.numeric.skewness) > 1) {
    out.push({
      statement: `${skewed.name} is heavily skewed rather than evenly spread.`,
      rationale: 'Surfaced from the distribution statistics computed during profiling.',
      test: { type: 'distribution', column: skewed.name, expect: 'skewed' },
      origin: 'discovered',
    });
  }

  return out.slice(0, 6);
}

export async function generateHypotheses({ table, profile, dataset, allowBedrock = true }) {
  if (allowBedrock) {
    const summary = summariseForModel(profile, dataset);
    const { text, reason, model, usage } = await askBedrock({ system: SYSTEM, prompt: buildPrompt(summary) });

    if (text) {
      const { valid, rejected } = validate(extractJsonArray(text), profile);
      if (rejected.length) log.warn(`discarded ${rejected.length} hypothes(es) referencing unusable columns`);
      if (valid.length) {
        log.ok(`${c.bold(valid.length)} hypotheses predicted by ${model}`);
        if (usage) log.note(`${usage.input_tokens} in / ${usage.output_tokens} out tokens`);
        return { source: 'bedrock', model, hypotheses: valid, rejected: rejected.length, usage };
      }
      log.warn('model returned nothing usable - falling back to search');
    } else {
      log.warn(`Bedrock unavailable: ${reason}`);
      log.note('falling back to searching the data directly');
    }
  }

  const discovered = discoverHypotheses(table, profile);
  log.ok(`${c.bold(discovered.length)} hypotheses discovered by search`);
  return { source: 'heuristic', model: null, hypotheses: discovered, rejected: 0 };
}
