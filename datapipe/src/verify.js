import { toNumber, toDate, isNull } from './profile.js';
import { pearson, correlationPValue, welchTTest, cohensD, linearSlope, mean, skewness } from './stats.js';

// Screening thresholds. Deliberately strict on p because a wide table produces
// a lot of comparisons, and deliberately non-zero on effect size because a
// significant-but-tiny relationship is not a finding.
export const ALPHA = 0.01;
const MIN_ABS_R = 0.2;
const MIN_ABS_D = 0.3;
const MIN_N = 10;

const colIndex = (table, name) => table.headers.indexOf(name);

/** Numeric values for one column, index-aligned with the row order. */
function numericValues(table, name) {
  const i = colIndex(table, name);
  if (i < 0) return null;
  return table.rows.map((r) => (isNull(r[i]) ? NaN : toNumber(r[i])));
}

function dateValues(table, name) {
  const i = colIndex(table, name);
  if (i < 0) return null;
  return table.rows.map((r) => {
    const d = isNull(r[i]) ? null : toDate(r[i]);
    return d ? d.getTime() / 86_400_000 : NaN; // days since epoch
  });
}

function rawValues(table, name) {
  const i = colIndex(table, name);
  if (i < 0) return null;
  return table.rows.map((r) => (isNull(r[i]) ? null : String(r[i]).trim()));
}

/** Drop index positions where either series is missing. */
function pairwise(xs, ys) {
  const a = [];
  const b = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      a.push(xs[i]);
      b.push(ys[i]);
    }
  }
  return [a, b];
}

const inconclusive = (reason) => ({ verdict: 'inconclusive', reason });

function checkCorrelation(table, spec) {
  const xs = numericValues(table, spec.x);
  const ys = numericValues(table, spec.y);
  if (!xs || !ys) return inconclusive(`column not found (${spec.x} / ${spec.y})`);
  const [a, b] = pairwise(xs, ys);
  if (a.length < MIN_N) return inconclusive(`only ${a.length} complete pairs`);

  const r = pearson(a, b);
  const p = correlationPValue(r, a.length);
  const directionMatches = spec.expect === 'negative' ? r < 0 : r > 0;
  const strong = Math.abs(r) >= MIN_ABS_R && p < ALPHA;

  return {
    verdict: strong ? (directionMatches ? 'supported' : 'refuted') : 'inconclusive',
    stat: { r: Number(r.toFixed(4)), p: Number(p.toExponential(2)), n: a.length },
    summary: `r = ${r.toFixed(3)} over ${a.length} pairs (p ${p < 1e-4 ? '< 0.0001' : '= ' + p.toFixed(4)})`,
  };
}

function checkGroupDifference(table, spec) {
  const groups = rawValues(table, spec.group);
  const values = numericValues(table, spec.value);
  if (!groups || !values) return inconclusive(`column not found (${spec.group} / ${spec.value})`);

  const buckets = new Map();
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === null || !Number.isFinite(values[i])) continue;
    if (!buckets.has(groups[i])) buckets.set(groups[i], []);
    buckets.get(groups[i]).push(values[i]);
  }
  const usable = [...buckets.entries()].filter(([, vs]) => vs.length >= MIN_N).sort((a, b) => b[1].length - a[1].length);
  if (usable.length < 2) return inconclusive('fewer than two groups with enough rows');

  // Compare the two groups with the most support.
  const [nameA, valsA] = usable[0];
  const [nameB, valsB] = usable[1];
  const { p } = welchTTest(valsA, valsB);
  const d = cohensD(valsA, valsB);
  const significant = p < ALPHA && Math.abs(d) >= MIN_ABS_D;

  return {
    verdict: significant ? 'supported' : 'inconclusive',
    stat: {
      groupA: nameA, meanA: Number(mean(valsA).toFixed(3)), nA: valsA.length,
      groupB: nameB, meanB: Number(mean(valsB).toFixed(3)), nB: valsB.length,
      cohensD: Number(d.toFixed(3)), p: Number(p.toExponential(2)),
    },
    summary: `${nameA} mean ${mean(valsA).toFixed(1)} (n=${valsA.length}) vs ${nameB} mean ${mean(valsB).toFixed(1)} `
      + `(n=${valsB.length}); d = ${d.toFixed(2)}, p ${p < 1e-4 ? '< 0.0001' : '= ' + p.toFixed(4)}`,
  };
}

function checkTrend(table, spec) {
  const times = dateValues(table, spec.time) ?? numericValues(table, spec.time);
  const values = numericValues(table, spec.value);
  if (!times || !values) return inconclusive(`column not found (${spec.time} / ${spec.value})`);
  const [t, v] = pairwise(times, values);
  if (t.length < MIN_N) return inconclusive(`only ${t.length} complete pairs`);

  const { slope, r } = linearSlope(t, v);
  const p = correlationPValue(r, t.length);
  const directionMatches = spec.expect === 'decreasing' ? slope < 0 : slope > 0;
  const strong = p < ALPHA && Math.abs(r) >= MIN_ABS_R;

  return {
    verdict: strong ? (directionMatches ? 'supported' : 'refuted') : 'inconclusive',
    stat: { slopePerDay: Number(slope.toFixed(5)), r: Number(r.toFixed(4)), p: Number(p.toExponential(2)), n: t.length },
    summary: `slope ${slope > 0 ? '+' : ''}${slope.toFixed(3)} per day, r = ${r.toFixed(3)} `
      + `(p ${p < 1e-4 ? '< 0.0001' : '= ' + p.toFixed(4)})`,
  };
}

function checkDistribution(table, spec) {
  const values = numericValues(table, spec.column)?.filter(Number.isFinite);
  if (!values) return inconclusive(`column not found (${spec.column})`);
  if (values.length < MIN_N) return inconclusive(`only ${values.length} values`);

  const s = skewness(values);
  const isSkewed = Math.abs(s) > 1;
  const matches = spec.expect === 'symmetric' ? Math.abs(s) < 0.5 : isSkewed;
  const decisive = Math.abs(s) > 1 || Math.abs(s) < 0.5;

  return {
    verdict: decisive ? (matches ? 'supported' : 'refuted') : 'inconclusive',
    stat: { skewness: Number(s.toFixed(3)), n: values.length },
    summary: `skewness ${s.toFixed(2)} over ${values.length} values`,
  };
}

const CHECKS = {
  correlation: checkCorrelation,
  group_difference: checkGroupDifference,
  trend: checkTrend,
  distribution: checkDistribution,
};

/** Run every hypothesis's test spec against the real data. */
export function verifyHypotheses(table, hypotheses) {
  return hypotheses.map((h) => {
    const check = CHECKS[h.test?.type];
    if (!check) return { ...h, result: inconclusive(`unknown test type "${h.test?.type}"`) };
    try {
      return { ...h, result: check(table, h.test) };
    } catch (err) {
      return { ...h, result: inconclusive(`test errored: ${err.message}`) };
    }
  });
}
