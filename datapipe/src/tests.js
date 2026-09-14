// Data-quality checks. Each returns { id, level, title, detail }.
// level: 'pass' | 'warn' | 'fail'

import { toNumber, isNull } from './profile.js';
import { pearson } from './stats.js';

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function runQualityTests(profile, table = null) {
  const results = [];
  const add = (id, level, title, detail = '') => results.push({ id, level, title, detail });

  // --- structure ----------------------------------------------------------
  if (profile.rowCount === 0) add('rows_present', 'fail', 'No data rows', 'The file parsed to zero rows.');
  else add('rows_present', 'pass', `${profile.rowCount.toLocaleString()} rows parsed`);

  if (profile.columnCount === 0) add('columns_present', 'fail', 'No columns detected');
  else add('columns_present', 'pass', `${profile.columnCount} columns detected`);

  const generated = profile.columns.filter((c) => /^column_\d+$/.test(c.name));
  const names = profile.columns.map((c) => c.name.toLowerCase());
  const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
  if (generated.length || dupeNames.length) {
    add(
      'header_quality',
      'warn',
      'Header row is not clean',
      [
        generated.length ? `${generated.length} blank header(s) were auto-named` : '',
        dupeNames.length ? `duplicate header(s): ${[...new Set(dupeNames)].join(', ')}` : '',
      ].filter(Boolean).join('; '),
    );
  } else add('header_quality', 'pass', 'Headers are unique and named');

  // --- completeness -------------------------------------------------------
  const empty = profile.columns.filter((c) => c.nonNull === 0);
  if (empty.length) add('empty_columns', 'fail', `${empty.length} column(s) are entirely empty`, empty.map((c) => c.name).join(', '));
  else add('empty_columns', 'pass', 'No entirely empty columns');

  const sparse = profile.columns.filter((c) => c.nonNull > 0 && c.nullRate > 0.3);
  if (sparse.length) {
    add(
      'null_rates',
      'warn',
      `${sparse.length} column(s) are more than 30% missing`,
      sparse.map((c) => `${c.name} (${pct(c.nullRate)})`).join(', '),
    );
  } else add('null_rates', 'pass', 'No column exceeds 30% missing values');

  // --- redundancy ---------------------------------------------------------
  if (profile.duplicateRows > 0) {
    const rate = profile.duplicateRows / Math.max(profile.rowCount, 1);
    add(
      'duplicate_rows',
      rate > 0.05 ? 'fail' : 'warn',
      `${profile.duplicateRows.toLocaleString()} duplicate row(s)`,
      `${pct(rate)} of the file is an exact repeat of another row`,
    );
  } else add('duplicate_rows', 'pass', 'No duplicate rows');

  const constant = profile.columns.filter((c) => c.nonNull > 0 && c.distinct === 1);
  if (constant.length) {
    add('constant_columns', 'warn', `${constant.length} column(s) never vary`, constant.map((c) => `${c.name}="${c.samples[0]}"`).join(', '));
  } else add('constant_columns', 'pass', 'Every column varies');

  // --- typing -------------------------------------------------------------
  const mixed = profile.columns.filter((c) => c.mixedTypes);
  if (mixed.length) {
    add('mixed_types', 'warn', `${mixed.length} column(s) mix types`, mixed.map((c) => `${c.name} (mostly ${c.type})`).join(', '));
  } else add('mixed_types', 'pass', 'Column types are consistent');

  // --- distributions ------------------------------------------------------
  const outlierNotes = [];
  for (const col of profile.columns) {
    if (!col.numeric || col.looksLikeId) continue;
    const { q1, q3, min, max } = col.numeric;
    const iqr = q3 - q1;
    if (!Number.isFinite(iqr) || iqr === 0) continue;
    const lo = q1 - 3 * iqr;
    const hi = q3 + 3 * iqr;
    if (min < lo || max > hi) {
      outlierNotes.push(`${col.name} (range ${min} to ${max}, IQR fence ${lo.toFixed(2)} to ${hi.toFixed(2)})`);
    }
  }
  if (outlierNotes.length) add('outliers', 'warn', `${outlierNotes.length} column(s) have extreme values`, outlierNotes.join('; '));
  else add('outliers', 'pass', 'No extreme outliers beyond 3x IQR');

  // --- temporal sanity ----------------------------------------------------
  const future = profile.columns.filter((c) => c.temporal?.futureCount > 0);
  if (future.length) {
    add('future_dates', 'warn', 'Dates in the future', future.map((c) => `${c.name} (${c.temporal.futureCount} row(s))`).join(', '));
  } else if (profile.dateColumns.length) {
    add('future_dates', 'pass', 'No future-dated rows');
  }

  // --- redundancy between columns ----------------------------------------
  if (table) {
    const names = profile.numericColumns;
    const series = new Map(
      names.map((n) => {
        const i = table.headers.indexOf(n);
        return [n, table.rows.map((r) => (isNull(r[i]) ? NaN : toNumber(r[i])))];
      }),
    );
    const redundant = [];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = series.get(names[i]);
        const b = series.get(names[j]);
        const xs = [];
        const ys = [];
        for (let k = 0; k < a.length; k += 1) {
          if (Number.isFinite(a[k]) && Number.isFinite(b[k])) {
            xs.push(a[k]);
            ys.push(b[k]);
          }
        }
        if (xs.length < 10) continue;
        const r = pearson(xs, ys);
        if (Number.isFinite(r) && Math.abs(r) >= 0.995) {
          redundant.push(`${names[i]} ~ ${names[j]} (r=${r.toFixed(4)})`);
        }
      }
    }
    if (redundant.length) {
      add(
        'redundant_columns',
        'warn',
        `${redundant.length} pair(s) of columns carry the same information`,
        `${redundant.join('; ')} - almost certainly one derived from the other`,
      );
    } else add('redundant_columns', 'pass', 'No duplicated measures between columns');
  }

  // --- coverage note ------------------------------------------------------
  if (profile.truncated) {
    add('truncation', 'warn', 'Only part of the file was read', 'Row cap reached - statistics describe the first N rows, not the whole file.');
  }

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) summary[r.level] += 1;
  return { results, summary };
}
