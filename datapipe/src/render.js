import { ALPHA } from './verify.js';

export const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const STYLE = `
:root { color-scheme: light dark;
  --bg:#fbfbfa; --fg:#1b1b19; --dim:#6b6b66; --line:#e4e4e0; --card:#fff;
  --accent:#2563eb; --ok:#15803d; --warn:#b45309; --bad:#b91c1c; --muted:#f4f4f2; }
@media (prefers-color-scheme: dark) { :root {
  --bg:#131313; --fg:#ececea; --dim:#9a9a94; --line:#2b2b29; --card:#1b1b1a;
  --accent:#7aa2ff; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171; --muted:#212120; } }
* { box-sizing:border-box; }
body { margin:0; padding:0 16px 72px; background:var(--bg); color:var(--fg);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
.wrap { max-width:900px; margin:0 auto; }
header { padding-block:44px 20px; border-bottom:1px solid var(--line); }
h1 { margin:0 0 6px; font-size:26px; letter-spacing:-0.4px; }
h2 { font-size:18px; margin:32px 0 12px; }
h3 { font-size:15px; margin:0 0 4px; }
.dim { color:var(--dim); }
.small { font-size:13px; }
a { color:var(--accent); }
section { padding-block:8px 24px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:14px; }
.row { display:flex; gap:12px; flex-wrap:wrap; align-items:baseline; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
.stat { background:var(--muted); border-radius:10px; padding:12px 14px; }
.stat .k { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--dim); }
.stat .v { font-size:20px; font-weight:600; margin-top:2px; overflow-wrap:anywhere; }
.chip { display:inline-block; font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:.5px; padding:2px 8px; border-radius:999px; border:1px solid currentColor; }
.ok { color:var(--ok); } .warn { color:var(--warn); } .bad { color:var(--bad); } .neutral { color:var(--dim); }
ul.checks { list-style:none; padding:0; margin:0; }
ul.checks li { padding:9px 0; border-bottom:1px solid var(--line); display:flex; gap:10px; align-items:flex-start; }
ul.checks li:last-child { border-bottom:0; }
.hyp { border-left:3px solid var(--line); padding:2px 0 2px 14px; margin-bottom:18px; }
.hyp.supported { border-left-color:var(--ok); }
.hyp.refuted { border-left-color:var(--bad); }
.hyp.inconclusive { border-left-color:var(--dim); }
code { background:var(--muted); border-radius:4px; padding:1px 5px; font-size:13px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px;
  color:var(--dim); border-bottom:1px solid var(--line); padding:8px 6px; }
td { padding:9px 6px; border-bottom:1px solid var(--line); }
.scroll { overflow-x:auto; }
img.shot { width:100%; border-radius:10px; border:1px solid var(--line); margin-top:12px; }
.note { background:var(--muted); border-left:3px solid var(--accent); border-radius:0 8px 8px 0;
  padding:12px 16px; font-size:13px; color:var(--dim); }
`;

export function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

const levelClass = { pass: 'ok', warn: 'warn', fail: 'bad' };
const verdictClass = { supported: 'ok', refuted: 'bad', inconclusive: 'neutral' };

function qualityList(tests) {
  return `<ul class="checks">${tests.results
    .map(
      (r) => `<li><span class="chip ${levelClass[r.level]}">${r.level}</span>
        <span><strong>${escape(r.title)}</strong>${r.detail ? `<br><span class="dim small">${escape(r.detail)}</span>` : ''}</span></li>`,
    )
    .join('')}</ul>`;
}

function hypothesisBlock(h) {
  const verdict = h.result?.verdict ?? 'inconclusive';
  const detail = h.result?.summary ?? h.result?.reason ?? '';
  return `<div class="hyp ${verdict}">
    <div class="row"><span class="chip ${verdictClass[verdict]}">${verdict}</span>
      <span class="chip neutral">${escape(h.origin ?? 'predicted')}</span></div>
    <h3 style="margin-top:6px">${escape(h.statement)}</h3>
    ${h.rationale ? `<div class="dim small">${escape(h.rationale)}</div>` : ''}
    <div class="small" style="margin-top:4px"><code>${escape(detail)}</code></div>
  </div>`;
}

const METHOD_NOTE = `<div class="note">
  <strong>How to read this.</strong> Results are exploratory screens, not confirmed findings.
  Hypotheses marked <em>predicted</em> were proposed from summary statistics alone and then tested,
  so a "supported" verdict is a real result. Hypotheses marked <em>discovered</em> were found by
  searching the data for the strongest relationship, so verification confirms the search rather than
  testing an independent idea. Many comparisons are run per dataset, so some significant results at
  p &lt; ${ALPHA} will be chance. Correlation here is never evidence of causation.
</div>`;

function runCard(run) {
  const { dataset, resource, profile, tests, hypotheses = [], generation } = run;
  if (run.status !== 'ok') {
    return `<div class="card">
      <div class="row"><span class="chip bad">failed</span><span class="dim small">${escape(run.startedAt)}</span></div>
      <h3 style="margin-top:8px">${escape(run.error ?? 'Unknown error')}</h3>
      ${run.stage ? `<div class="dim small">failed during: ${escape(run.stage)}</div>` : ''}
    </div>`;
  }

  const supported = hypotheses.filter((h) => h.result?.verdict === 'supported').length;
  return `<div class="card">
    <div class="row">
      <span class="chip ok">ok</span>
      <span class="dim small">${escape(run.startedAt)} &middot; ${(run.durationMs / 1000).toFixed(1)}s</span>
    </div>
    <h2 style="margin:10px 0 2px"><a href="${escape(dataset.landingPage)}">${escape(dataset.title)}</a></h2>
    <div class="dim small">${escape(dataset.organization)} &middot; selected as ${escape(run.strategy)} (rank ${run.rank})
      &middot; ${escape(resource.format)}</div>

    <div class="grid" style="margin-top:16px">
      <div class="stat"><div class="k">Rows</div><div class="v">${profile.rowCount.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Columns</div><div class="v">${profile.columnCount}</div></div>
      <div class="stat"><div class="k">Quality</div><div class="v">${tests.summary.pass}/${tests.summary.pass + tests.summary.warn + tests.summary.fail} pass</div></div>
      <div class="stat"><div class="k">Supported</div><div class="v">${supported}/${hypotheses.length}</div></div>
    </div>
    ${run.screenshot ? `<img class="shot" src="${escape(run.screenshot)}" alt="Landing page for ${escape(dataset.title)}">` : ''}

    <h2>Data quality</h2>
    ${qualityList(tests)}

    <h2>Hypotheses <span class="dim small">(${escape(generation?.source === 'bedrock' ? generation.model : 'generated by search')})</span></h2>
    ${hypotheses.length ? hypotheses.map(hypothesisBlock).join('') : '<div class="dim">No testable hypotheses could be formed.</div>'}
  </div>`;
}

function historyTable(runs) {
  if (!runs.length) return '';
  return `<h2>Recent runs</h2><div class="scroll"><table>
    <thead><tr><th>When</th><th>Dataset</th><th>Rows</th><th>Quality</th><th>Supported</th><th>Status</th></tr></thead>
    <tbody>${runs
      .map((r) => {
        const ok = r.status === 'ok';
        const supported = (r.hypotheses || []).filter((h) => h.result?.verdict === 'supported').length;
        return `<tr>
          <td class="dim">${escape(r.startedAt.slice(5, 16).replace('T', ' '))}</td>
          <td>${ok ? escape(r.dataset.title.slice(0, 52)) : `<span class="dim">${escape((r.error || '').slice(0, 52))}</span>`}</td>
          <td>${ok ? r.profile.rowCount.toLocaleString() : '-'}</td>
          <td>${ok ? `${r.tests.summary.fail} fail / ${r.tests.summary.warn} warn` : '-'}</td>
          <td>${ok ? `${supported}/${(r.hypotheses || []).length}` : '-'}</td>
          <td><span class="chip ${ok ? 'ok' : 'bad'}">${ok ? 'ok' : 'failed'}</span></td>
        </tr>`;
      })
      .join('')}</tbody></table></div>`;
}

export function renderDashboard(runs, { nextRunHint } = {}) {
  const latest = runs[0];
  const okRuns = runs.filter((r) => r.status === 'ok');
  const body = `
    <header>
      <h1>Open data pipeline</h1>
      <p class="dim small">Updated ${escape(new Date().toString())}${nextRunHint ? ` &middot; ${escape(nextRunHint)}` : ''}<br>
      ${runs.length} run(s) recorded &middot; ${okRuns.length} succeeded</p>
    </header>
    <section>
      ${latest ? runCard(latest) : '<div class="card dim">No runs yet. Try <code>node run.js run</code>.</div>'}
      ${METHOD_NOTE}
      ${historyTable(runs.slice(0, 20))}
    </section>`;
  return page('Open data pipeline', body);
}

export function renderDigest(runs, { hours = 24 } = {}) {
  const ok = runs.filter((r) => r.status === 'ok');
  const failed = runs.filter((r) => r.status !== 'ok');
  const findings = [];
  for (const run of ok) {
    for (const h of run.hypotheses || []) {
      if (h.result?.verdict === 'supported') findings.push({ run, h });
    }
  }
  // Predicted-then-tested findings are the stronger evidence, so lead with them.
  findings.sort((a, b) => (a.h.origin === 'predicted' ? -1 : 1) - (b.h.origin === 'predicted' ? -1 : 1));

  const qualityFlags = [];
  for (const run of ok) {
    for (const t of run.tests.results) {
      if (t.level === 'fail') qualityFlags.push({ dataset: run.dataset.title, test: t });
    }
  }

  const body = `
    <header>
      <h1>Daily digest</h1>
      <p class="dim small">${escape(new Date().toDateString())} &middot; last ${hours} hours<br>
      ${ok.length} dataset(s) analysed, ${failed.length} run(s) failed, ${findings.length} supported finding(s)</p>
    </header>
    <section>
      <div class="grid">
        <div class="stat"><div class="k">Datasets</div><div class="v">${ok.length}</div></div>
        <div class="stat"><div class="k">Findings</div><div class="v">${findings.length}</div></div>
        <div class="stat"><div class="k">Quality failures</div><div class="v">${qualityFlags.length}</div></div>
        <div class="stat"><div class="k">Failed runs</div><div class="v">${failed.length}</div></div>
      </div>

      <h2>Findings</h2>
      ${findings.length
        ? findings
            .map(
              ({ run, h }) => `<div class="card">
                <div class="dim small"><a href="${escape(run.dataset.landingPage)}">${escape(run.dataset.title)}</a>
                  &middot; ${escape(run.dataset.organization)}</div>
                ${hypothesisBlock(h)}
              </div>`,
            )
            .join('')
        : '<div class="card dim">Nothing reached the significance and effect-size thresholds today.</div>'}
      ${METHOD_NOTE}

      ${qualityFlags.length
        ? `<h2>Datasets with quality failures</h2><div class="card"><ul class="checks">${qualityFlags
            .map(
              (q) => `<li><span class="chip bad">fail</span><span><strong>${escape(q.dataset)}</strong><br>
                <span class="dim small">${escape(q.test.title)}${q.test.detail ? ` - ${escape(q.test.detail)}` : ''}</span></span></li>`,
            )
            .join('')}</ul></div>`
        : ''}

      ${failed.length
        ? `<h2>Failed runs</h2><div class="card"><ul class="checks">${failed
            .map(
              (r) => `<li><span class="chip bad">${escape(r.stage ?? 'error')}</span>
                <span class="small">${escape(r.error)}<br><span class="dim">${escape(r.startedAt)}</span></span></li>`,
            )
            .join('')}</ul></div>`
        : ''}

      ${historyTable(runs)}
    </section>`;
  return page(`Daily digest - ${new Date().toDateString()}`, body);
}
