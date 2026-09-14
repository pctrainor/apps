// Builds fixtures/sample.csv: synthetic park-visit data with relationships we
// know the answers to, so the pipeline can be tested without the network.
//
// Ground truth planted in the data:
//   temperature_f -> visitors      strong positive correlation
//   visitors      -> ticket_revenue  near-perfect positive (revenue = visitors * price)
//   day_type      -> visitors      weekends materially higher
//   date          -> visitors      mild upward trend across the year
// Deliberate defects: ~35% missing staff_on_duty, one constant column,
// an all-empty column, and 6 duplicated rows.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Deterministic RNG so the fixture never changes between runs.
function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20240101);
const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.5;

const parks = ['Riverside Park', 'Hilltop Commons', 'Cedar Grove', 'Lakeview Green', 'Old Mill Park'];
const headers = [
  'visit_id', 'date', 'park_name', 'day_type', 'temperature_f',
  'visitors', 'ticket_revenue', 'staff_on_duty', 'region', 'notes',
];

const rows = [];
const start = new Date('2024-01-01T00:00:00Z');

for (let i = 0; i < 420; i += 1) {
  const date = new Date(start.getTime() + i * 86_400_000);
  const iso = date.toISOString().slice(0, 10);
  const dow = date.getUTCDay();
  const isWeekend = dow === 0 || dow === 6;

  // Seasonal temperature: coldest in January, warmest in July.
  const seasonal = Math.sin(((i - 15) / 365) * 2 * Math.PI - Math.PI / 2);
  const temperature = 55 + seasonal * 28 + gauss() * 4;

  // Visitors driven by temperature, a weekend lift, and a slow upward trend.
  const base = 120 + (temperature - 55) * 6.5 + (isWeekend ? 260 : 0) + i * 0.45;
  const visitors = Math.max(5, Math.round(base + gauss() * 45));

  const price = 4.5;
  const revenue = (visitors * price).toFixed(2);

  // Staffing is recorded inconsistently - a realistic gap.
  const staff = rand() < 0.35 ? '' : String(Math.max(1, Math.round(visitors / 90 + gauss() * 0.8)));

  rows.push([
    `V-${String(10_000 + i)}`,
    iso,
    parks[i % parks.length],
    isWeekend ? 'Weekend' : 'Weekday',
    temperature.toFixed(1),
    String(visitors),
    revenue,
    staff,
    'Northeast',
    '',
  ]);
}

// A handful of exact duplicates, as real exports so often contain.
for (const index of [12, 44, 101, 202, 303, 404]) rows.push([...rows[index]]);

const escape = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n') + '\n';

const out = path.join(here, 'sample.csv');
fs.writeFileSync(out, csv);
console.log(`wrote ${out} (${rows.length} rows, ${headers.length} columns)`);
