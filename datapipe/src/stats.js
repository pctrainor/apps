// Small statistics toolkit. Everything takes plain number arrays.

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export const median = (xs) => quantile([...xs].sort((a, b) => a - b), 0.5);

export function stddev(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

export function skewness(xs) {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  const s = stddev(xs);
  if (!s) return 0;
  return (n / ((n - 1) * (n - 2))) * xs.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0);
}

/** Pearson correlation over paired arrays (same length, no NaNs). */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

/**
 * Two-sided p-value for a t statistic with df degrees of freedom.
 * Uses the incomplete beta function; accurate enough for screening.
 */
export function tDistPValue(t, df) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return Math.min(1, Math.max(0, incompleteBeta(x, df / 2, 0.5)));
}

function logGamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i += 1) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularised incomplete beta I_x(a,b) via the continued fraction expansion. */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // The continued fraction only converges quickly on one side; use the
  // symmetry I_x(a,b) = 1 - I_(1-x)(b,a) for the other.
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  let f = 1;
  let cPrev = 1;
  let dPrev = 0;
  for (let i = 0; i <= 200; i += 1) {
    const m = Math.floor(i / 2);
    let numerator;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -(((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));

    dPrev = 1 + numerator * dPrev;
    if (Math.abs(dPrev) < 1e-30) dPrev = 1e-30;
    dPrev = 1 / dPrev;

    cPrev = 1 + numerator / cPrev;
    if (Math.abs(cPrev) < 1e-30) cPrev = 1e-30;

    const delta = cPrev * dPrev;
    f *= delta;
    if (Math.abs(1 - delta) < 1e-10) break;
  }
  return front * (f - 1);
}

/** p-value for a Pearson r over n pairs. */
export function correlationPValue(r, n) {
  if (!Number.isFinite(r) || n < 3) return NaN;
  const clamped = Math.min(0.999999, Math.max(-0.999999, r));
  const t = clamped * Math.sqrt((n - 2) / (1 - clamped * clamped));
  return tDistPValue(t, n - 2);
}

/** Welch's t-test for two independent samples. */
export function welchTTest(a, b) {
  if (a.length < 2 || b.length < 2) return { t: NaN, df: NaN, p: NaN };
  const va = stddev(a) ** 2 / a.length;
  const vb = stddev(b) ** 2 / b.length;
  const denom = Math.sqrt(va + vb);
  if (!denom) return { t: NaN, df: NaN, p: NaN };
  const t = (mean(a) - mean(b)) / denom;
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t, df, p: tDistPValue(t, df) };
}

/** Cohen's d, the effect size that says whether a difference actually matters. */
export function cohensD(a, b) {
  if (a.length < 2 || b.length < 2) return NaN;
  const sa = stddev(a);
  const sb = stddev(b);
  const pooled = Math.sqrt(((a.length - 1) * sa ** 2 + (b.length - 1) * sb ** 2) / (a.length + b.length - 2));
  return pooled ? (mean(a) - mean(b)) / pooled : NaN;
}

/** Ordinary least squares slope of y on x. */
export function linearSlope(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return { slope: NaN, r: NaN };
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return { slope: den ? num / den : NaN, r: pearson(xs, ys) };
}
