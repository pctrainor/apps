import { save, humanSize } from './out.js';

const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function artifactCard(a) {
  // report.html lives in output/ alongside the artifacts, so relative paths work.
  if (a.kind === 'image') {
    return `<figure><img src="${escape(a.name)}" alt="${escape(a.label)}" loading="lazy">
      <figcaption>${escape(a.label)} &middot; <a href="${escape(a.name)}">${escape(a.name)}</a>
      <span class="dim">${humanSize(a.bytes)}</span></figcaption></figure>`;
  }
  return `<a class="file" href="${escape(a.name)}">
    <span class="kind">${escape(a.kind)}</span>
    <span>${escape(a.label)}</span>
    <span class="dim">${escape(a.name)} &middot; ${humanSize(a.bytes)}</span></a>`;
}

function factRows(facts = {}) {
  const entries = Object.entries(facts);
  if (!entries.length) return '';
  return `<dl>${entries
    .map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`)
    .join('')}</dl>`;
}

function demoSection(r) {
  const badge =
    r.status === 'ok'
      ? '<span class="badge ok">passed</span>'
      : `<span class="badge fail">${escape(r.status)}</span>`;

  const body =
    r.status === 'ok'
      ? `${factRows(r.facts)}<div class="artifacts">${(r.artifacts ?? []).map(artifactCard).join('')}</div>`
      : `<pre class="error">${escape(r.error)}${r.hint ? `\n\n${escape(r.hint)}` : ''}</pre>`;

  return `<section>
    <h2>${escape(r.name)} ${badge} <span class="dim">${r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''}</span></h2>
    <p class="summary">${escape(r.summary ?? '')}</p>
    ${r.useCase ? `<p class="usecase">${escape(r.useCase)}</p>` : ''}
    ${body}
  </section>`;
}

export function writeReport({ results, url, baseUrl }) {
  const passed = results.filter((r) => r.status === 'ok').length;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browserless demo run</title>
<style>
  :root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1a1a19; --dim:#6b6b6b; --line:#e3e3e0;
          --card:#fff; --accent:#0b5fff; --ok:#0a7d4a; --fail:#b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#ececea; --dim:#9a9a96; --line:#2c2c2a; --card:#1c1c1b;
            --accent:#7aa2ff; --ok:#4ade80; --fail:#f87171; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:0 16px 64px; background:var(--bg); color:var(--fg);
         font:15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; }
  header { padding-block: 48px 24px; border-bottom: 1px solid var(--line); }
  h1 { margin:0 0 8px; font-size: 28px; letter-spacing:-0.4px; }
  .dim { color: var(--dim); font-weight: 400; }
  code { background: var(--card); border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:13px; }
  section { padding-block: 32px; border-bottom: 1px solid var(--line); }
  h2 { margin:0 0 4px; font-size:19px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .summary { margin:0 0 4px; }
  .usecase { margin:0 0 16px; color:var(--dim); font-size:14px; }
  .badge { font-size:11px; text-transform:uppercase; letter-spacing:.6px; padding:2px 8px;
           border-radius:999px; border:1px solid currentColor; font-weight:600; }
  .badge.ok { color: var(--ok); } .badge.fail { color: var(--fail); }
  dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;
       margin:0 0 20px; padding:14px; background:var(--card); border:1px solid var(--line); border-radius:10px; }
  dl div { min-width:0; }
  dt { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--dim); }
  dd { margin:2px 0 0; font-weight:600; overflow-wrap:anywhere; }
  .artifacts { display:grid; gap:16px; }
  figure { margin:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--card); }
  figure img { display:block; width:100%; height:auto; max-height:520px; object-fit:cover; object-position:top; }
  figcaption { padding:10px 14px; font-size:13px; border-top:1px solid var(--line); }
  a { color: var(--accent); }
  .file { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 14px; text-decoration:none;
          background:var(--card); border:1px solid var(--line); border-radius:10px; color:var(--fg); }
  .file:hover { border-color: var(--accent); }
  .kind { font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:var(--accent);
          border:1px solid currentColor; border-radius:4px; padding:1px 6px; }
  pre.error { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--fail);
              border-radius:8px; padding:14px; overflow-x:auto; font-size:13px; white-space:pre-wrap; }
</style></head>
<body><div class="wrap">
<header>
  <h1>Browserless demo run</h1>
  <p class="dim">${passed}/${results.length} demos passed &middot; target <code>${escape(url)}</code>
     &middot; region <code>${escape(baseUrl)}</code><br>${escape(new Date().toString())}</p>
</header>
${results.map(demoSection).join('\n')}
</div></body></html>`;

  return save('report.html', html);
}
