"""Render the candidate dashboard as a self-contained HTML page.

`render()` takes plain dicts (decoupled from the pipeline types) and returns a
complete page. Two modes: 'standalone' emits a full HTML document you can open
locally; 'artifact' emits title + style + body markup for publishing as an
Artifact (the host wraps it in <html>/<head>/<body>).
"""

from __future__ import annotations

import html
import json
from typing import Dict, List

_CAT_ORDER = [("agent_tech", "Agent"), ("pain", "Pain"),
              ("scale", "Scale"), ("hiring", "Hiring")]

_CSS = """
:root{
  --paper:#eef1f1; --surface:#ffffff; --surface-2:#e5eaea; --inset:#f6f8f8;
  --ink:#13201f; --muted:#586a6a; --faint:#8697971a; --line:#d5dedd;
  --accent:#0a6b70; --accent-soft:#0a6b7015; --link:#0a6b70;
  --tier-a:#0a6b70; --tier-b:#2b8a83; --tier-c:#b07d1a; --tier-watch:#79868a;
  --track:#dbe3e2;
  --shadow:0 1px 2px rgba(19,32,31,.06),0 8px 24px -14px rgba(19,32,31,.18);
}
:root:not([data-theme="light"]){ }
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#0c1413; --surface:#111c1b; --surface-2:#182624; --inset:#0e1817;
    --ink:#e8efee; --muted:#93a5a4; --line:#243532;
    --accent:#38b6ad; --accent-soft:#38b6ad1f; --link:#5fcfc5;
    --tier-a:#38b6ad; --tier-b:#4fb8a0; --tier-c:#d3a24a; --tier-watch:#8a999a;
    --track:#22322f;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -16px rgba(0,0,0,.6);
  }
}
:root[data-theme="dark"]{
  --paper:#0c1413; --surface:#111c1b; --surface-2:#182624; --inset:#0e1817;
  --ink:#e8efee; --muted:#93a5a4; --line:#243532;
  --accent:#38b6ad; --accent-soft:#38b6ad1f; --link:#5fcfc5;
  --tier-a:#38b6ad; --tier-b:#4fb8a0; --tier-c:#d3a24a; --tier-watch:#8a999a;
  --track:#22322f;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -16px rgba(0,0,0,.6);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  line-height:1.5; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:960px; margin:0 auto; padding-inline:20px; padding-block:40px 64px;}
.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums;}
a{color:var(--link); text-decoration:none;}
a:hover{text-decoration:underline;}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:3px;}

/* header */
.eyebrow{font-family:"IBM Plex Mono",monospace; font-size:12px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--accent); margin:0 0 10px;}
h1{font-size:clamp(30px,5vw,44px); line-height:1.04; letter-spacing:-.02em;
  margin:0 0 12px; text-wrap:balance; font-weight:600;}
.lede{font-size:17px; color:var(--muted); max-width:62ch; margin:0;}
.provenance{margin-top:18px; display:flex; flex-wrap:wrap; gap:8px 10px;
  font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--muted);}
.chip{border:1px solid var(--line); border-radius:999px; padding:3px 10px;
  background:var(--surface); white-space:nowrap;}

/* section heading */
.sec{margin-top:44px;}
.sec-h{display:flex; align-items:baseline; justify-content:space-between; gap:12px;
  margin-bottom:16px; border-bottom:1px solid var(--line); padding-bottom:8px;}
.sec-h h2{font-size:14px; letter-spacing:.14em; text-transform:uppercase;
  margin:0; color:var(--muted); font-weight:600; font-family:"IBM Plex Mono",monospace;}
.sec-h .note{font-size:12px; color:var(--muted); font-family:"IBM Plex Mono",monospace;}

/* funnel */
.funnel{display:grid; grid-template-columns:repeat(4,1fr); gap:12px;}
.stage{background:var(--surface); border:1px solid var(--line); border-radius:12px;
  padding:16px; box-shadow:var(--shadow); position:relative;}
.stage .k{font-family:"IBM Plex Mono",monospace; font-size:11px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--muted);}
.stage .v{font-family:"IBM Plex Mono",monospace; font-size:32px; font-weight:600;
  line-height:1.1; margin-top:4px; letter-spacing:-.02em;}
.stage .d{font-size:12px; color:var(--muted); margin-top:2px;}
.stage .bar{height:4px; border-radius:2px; background:var(--track); margin-top:12px; overflow:hidden;}
.stage .bar > i{display:block; height:100%; background:var(--accent); border-radius:2px;}

/* tier stat row */
.tiers{display:flex; flex-wrap:wrap; gap:10px; margin-top:16px;}
.tierstat{display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted);
  font-family:"IBM Plex Mono",monospace;}
.dot{width:10px; height:10px; border-radius:3px; display:inline-block;}

/* candidate cards */
.cards{display:flex; flex-direction:column; gap:10px;}
.card{background:var(--surface); border:1px solid var(--line); border-radius:12px;
  padding:16px 18px; box-shadow:var(--shadow); display:grid;
  grid-template-columns:auto 1fr auto; gap:6px 18px; align-items:center;}
.rank{font-family:"IBM Plex Mono",monospace; font-size:13px; color:var(--muted); width:2ch;}
.co{min-width:0;}
.co .name{font-size:18px; font-weight:600; letter-spacing:-.01em;}
.co .meta{font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--muted);
  margin-top:2px;}
.score-wrap{display:flex; flex-direction:column; align-items:flex-end; gap:6px; min-width:132px;}
.score-line{display:flex; align-items:baseline; gap:8px;}
.score{font-family:"IBM Plex Mono",monospace; font-size:30px; font-weight:600;
  line-height:1; letter-spacing:-.02em;}
.tier{font-family:"IBM Plex Mono",monospace; font-size:11px; font-weight:600;
  letter-spacing:.08em; text-transform:uppercase; color:#fff; padding:3px 8px;
  border-radius:6px;}
.strack{width:120px; height:6px; border-radius:3px; background:var(--track); overflow:hidden;}
.strack > i{display:block; height:100%; border-radius:3px;}

/* signals sub-grid spanning full width under name */
.signals{grid-column:1 / -1; display:grid;
  grid-template-columns:repeat(4,1fr); gap:8px 16px; margin-top:6px;}
.sig{display:flex; align-items:center; gap:8px;}
.sig .lab{font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--muted); width:46px; flex:none;}
.sig .t{flex:1; height:5px; border-radius:3px; background:var(--track); overflow:hidden;}
.sig .t > i{display:block; height:100%; background:var(--accent); border-radius:3px;}
.sig .n{font-family:"IBM Plex Mono",monospace; font-size:11px; color:var(--muted);
  width:30px; text-align:right; flex:none;}
.evi{grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px;
  padding-top:8px; border-top:1px dashed var(--line);}
.evi a{font-family:"IBM Plex Mono",monospace; font-size:12px; display:inline-flex; gap:6px;}
.evi a::before{content:"↳"; color:var(--muted);}

/* culled */
details.culled{background:var(--inset); border:1px solid var(--line); border-radius:12px;
  padding:4px 18px; margin-top:16px;}
details.culled summary{cursor:pointer; padding:12px 0; font-family:"IBM Plex Mono",monospace;
  font-size:13px; color:var(--ink); list-style:none;}
details.culled summary::-webkit-details-marker{display:none;}
details.culled summary .caret{color:var(--accent); transition:transform .15s ease; display:inline-block;}
details.culled[open] summary .caret{transform:rotate(90deg);}
.culled ul{list-style:none; margin:0 0 12px; padding:0; display:flex; flex-direction:column; gap:2px;}
.culled li{display:flex; justify-content:space-between; gap:12px; padding:6px 0;
  border-top:1px solid var(--line); font-size:13px;}
.culled li .why{font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--muted);
  white-space:nowrap;}

/* methodology footer */
.method{margin-top:44px; padding:20px; background:var(--surface); border:1px solid var(--line);
  border-radius:12px; box-shadow:var(--shadow);}
.method h3{margin:0 0 8px; font-size:13px; letter-spacing:.12em; text-transform:uppercase;
  color:var(--muted); font-family:"IBM Plex Mono",monospace;}
.method p{margin:0 0 10px; font-size:14px; color:var(--muted); max-width:70ch;}
.method p:last-child{margin-bottom:0;}
.method b{color:var(--ink); font-weight:600;}

@media (max-width:640px){
  .funnel{grid-template-columns:repeat(2,1fr);}
  .card{grid-template-columns:auto 1fr; }
  .score-wrap{grid-column:2; align-items:flex-start; margin-top:4px;}
  .strack{width:100%;}
  .signals{grid-template-columns:repeat(2,1fr);}
}
@media (prefers-reduced-motion: reduce){*{transition:none!important;}}
"""


def _esc(s) -> str:
    return html.escape(str(s), quote=True)


def _tier_var(t: str) -> str:
    return {"A": "var(--tier-a)", "B": "var(--tier-b)",
            "C": "var(--tier-c)", "watch": "var(--tier-watch)"}.get(t, "var(--tier-watch)")


def _funnel_html(counts: Dict[str, int]) -> str:
    crawled = max(counts.get("raw_docs", 0), 1)
    stages = [
        ("Crawled", counts.get("raw_docs", 0), "public repos ingested"),
        ("Survived", counts.get("survivors", 0), "cleared keyword prefilter"),
        ("Relevant", counts.get("relevant", 0), "classified as on-topic"),
        ("Candidates", counts.get("candidates", 0), "companies scored"),
    ]
    out = ['<div class="funnel">']
    for name, val, desc in stages:
        w = round(val / crawled * 100)
        out.append(
            f'<div class="stage"><div class="k">{_esc(name)}</div>'
            f'<div class="v">{val}</div><div class="d">{_esc(desc)}</div>'
            f'<div class="bar"><i style="width:{w}%"></i></div></div>'
        )
    out.append("</div>")
    return "".join(out)


def _tiers_html(tiers: Dict[str, int]) -> str:
    order = [("A", "Tier A"), ("B", "Tier B"), ("C", "Tier C"), ("watch", "Watch")]
    items = [
        f'<span class="tierstat"><span class="dot" style="background:{_tier_var(k)}"></span>'
        f'{_esc(label)} · {tiers.get(k, 0)}</span>'
        for k, label in order
    ]
    return '<div class="tiers">' + "".join(items) + "</div>"


def _signals_html(cat: Dict[str, float]) -> str:
    rows = []
    for key, label in _CAT_ORDER:
        v = float(cat.get(key, 0.0))
        rows.append(
            f'<div class="sig"><span class="lab">{_esc(label)}</span>'
            f'<span class="t"><i style="width:{round(v*100)}%"></i></span>'
            f'<span class="n">{v:.2f}</span></div>'
        )
    return '<div class="signals">' + "".join(rows) + "</div>"


def _card_html(i: int, c: Dict) -> str:
    tvar = _tier_var(c["tier"])
    repos = c.get("evidence", [])
    reptxt = f'{len(repos)} repo' + ("s" if len(repos) != 1 else "")
    stars = c.get("stars")
    metabits = [reptxt]
    if stars:
        metabits.append(f'{stars:,}★')
    if c.get("language"):
        metabits.append(_esc(c["language"]))
    aliases = c.get("aliases", [])
    if len(aliases) > 1:
        metabits.append("aka " + _esc(", ".join(a for a in aliases if a != c["company"])[:40]))
    evi = "".join(
        f'<a href="{_esc(r["url"])}" target="_blank" rel="noopener">{_esc(r.get("name") or r["url"])}</a>'
        for r in repos
    )
    return (
        '<div class="card">'
        f'<div class="rank mono">{i:02d}</div>'
        f'<div class="co"><div class="name">{_esc(c["company"])}</div>'
        f'<div class="meta">{" · ".join(metabits)}</div></div>'
        '<div class="score-wrap"><div class="score-line">'
        f'<span class="score">{c["score"]}</span>'
        f'<span class="tier" style="background:{tvar}">{_esc(c["tier"])}</span></div>'
        f'<div class="strack"><i style="width:{c["score"]}%;background:{tvar}"></i></div></div>'
        f'{_signals_html(c.get("category_scores", {}))}'
        + (f'<div class="evi">{evi}</div>' if evi else "")
        + "</div>"
    )


def _culled_html(culled: List[Dict]) -> str:
    if not culled:
        return ""
    items = "".join(
        f'<li><span>{_esc(c["title"])}</span><span class="why">{_esc(c["reason"])}</span></li>'
        for c in culled
    )
    return (
        '<details class="culled" open><summary><span class="caret">▸</span> '
        f'{len(culled)} repos dropped by the prefilter &mdash; why</summary>'
        f'<ul>{items}</ul></details>'
    )


def render(candidates: List[Dict], counts: Dict[str, int], tiers: Dict[str, int],
           culled: List[Dict], meta: Dict, mode: str = "standalone") -> str:
    crawled = counts.get("raw_docs", 0)
    survivors = counts.get("survivors", 0)
    dropped = crawled - survivors
    prov = []
    if meta.get("crawled_at"):
        prov.append(f'<span class="chip">crawled {_esc(meta["crawled_at"])}</span>')
    if meta.get("source"):
        prov.append(f'<span class="chip">source: {_esc(meta["source"])}</span>')
    if meta.get("queries"):
        prov.append(f'<span class="chip">{len(meta["queries"])} search queries</span>')
    prov.append('<span class="chip">public signal only</span>')

    cards = "".join(_card_html(i + 1, c) for i, c in enumerate(candidates))

    body = f"""
<div class="wrap">
  <header>
    <p class="eyebrow">AgentScope · lead qualification</p>
    <h1>Companies shipping AI agents, ranked by prospect signal</h1>
    <p class="lede">A live pass of the AgentScope funnel over {crawled} public GitHub
      repositories &mdash; keyword prefilter, classification, entity resolution and
      0&ndash;100 scoring &mdash; surfacing the strongest fits for agent-testing and
      AI-safety services.</p>
    <div class="provenance">{"".join(prov)}</div>
  </header>

  <section class="sec">
    <div class="sec-h"><h2>The funnel</h2>
      <span class="note">{dropped} of {crawled} dropped before scoring</span></div>
    {_funnel_html(counts)}
    {_tiers_html(tiers)}
  </section>

  <section class="sec">
    <div class="sec-h"><h2>Ranked candidates</h2>
      <span class="note">score = weighted agent · pain · scale · hiring signal</span></div>
    <div class="cards">{cards}</div>
    {_culled_html(culled)}
  </section>

  <section class="method">
    <h3>How to read this</h3>
    <p><b>Score (0&ndash;100)</b> blends four public signals &mdash; agent technology,
      reliability/safety <b>pain</b>, production <b>scale</b>, and <b>hiring</b> &mdash;
      each saturating so keyword spam can't inflate it. Tiers: A&nbsp;&ge;&nbsp;70,
      B&nbsp;&ge;&nbsp;45, C&nbsp;&ge;&nbsp;25, else watch.</p>
    <p>This snapshot scores from repository <b>descriptions and topics only</b>. The live
      GitHub source also pulls READMEs, where reliability/evaluation/guardrails language
      lives &mdash; that enrichment lifts scores materially, so treat these as a floor.</p>
    <p><b>Scope:</b> public signal only (published repos, descriptions, topics). AgentScope
      never probes, scans, or tests anyone's running systems.</p>
  </section>
</div>
"""

    head_extras = (
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
        'family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">'
    )
    title = "AgentScope Prospects"
    if mode == "artifact":
        return f'<title>{title}</title>{head_extras}<style>{_CSS}</style>{body}'
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{title}</title>{head_extras}<style>{_CSS}</style></head>"
        f"<body>{body}</body></html>"
    )
