"""Render the domain hyperlink graph as a visual map (inline SVG).

Node positions come from a small deterministic Fruchterman-Reingold layout
(pure standard library), node size encodes PageRank, colour encodes category,
and seed / discovered domains are highlighted. Two modes: 'standalone' (full
HTML document) and 'artifact' (title + style + body for publishing).
"""

from __future__ import annotations

import html
import math
import random
from typing import Dict, List, Optional, Tuple

_CATS = [
    ("hub", "Hubs / infra"), ("model_provider", "Model providers"),
    ("framework", "Agent frameworks"), ("agent_company", "Agent companies"),
    ("observability", "Observability"), ("eval_safety", "Eval / safety"),
]

_CSS = """
:root{
  --paper:#eef1f1; --surface:#ffffff; --ink:#13201f; --muted:#586a6a;
  --line:#d5dedd; --accent:#0a6b70; --link:#0a6b70; --edge:#9fb0af;
  --svg-bg:#f7faf9;
  --cat-hub:#6b7a7b; --cat-model_provider:#0a6b70; --cat-framework:#2f6f9f;
  --cat-agent_company:#c0842a; --cat-observability:#7a5aa6; --cat-eval_safety:#b5495b;
  --shadow:0 1px 2px rgba(19,32,31,.06),0 8px 24px -14px rgba(19,32,31,.18);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#0c1413; --surface:#111c1b; --ink:#e8efee; --muted:#93a5a4;
  --line:#243532; --accent:#38b6ad; --link:#5fcfc5; --edge:#3d5450;
  --svg-bg:#0e1817;
  --cat-hub:#8b9a9b; --cat-model_provider:#38b6ad; --cat-framework:#5fa3d6;
  --cat-agent_company:#e0a94a; --cat-observability:#a488cf; --cat-eval_safety:#d9788a;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -16px rgba(0,0,0,.6);
}}
:root[data-theme="dark"]{
  --paper:#0c1413; --surface:#111c1b; --ink:#e8efee; --muted:#93a5a4;
  --line:#243532; --accent:#38b6ad; --link:#5fcfc5; --edge:#3d5450; --svg-bg:#0e1817;
  --cat-hub:#8b9a9b; --cat-model_provider:#38b6ad; --cat-framework:#5fa3d6;
  --cat-agent_company:#e0a94a; --cat-observability:#a488cf; --cat-eval_safety:#d9788a;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -16px rgba(0,0,0,.6);
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;}
.wrap{max-width:1000px;margin:0 auto;padding-inline:20px;padding-block:40px 64px;}
.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;}
a{color:var(--link);text-decoration:none;} a:hover{text-decoration:underline;}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--accent);margin:0 0 10px;}
h1{font-size:clamp(28px,4.5vw,40px);line-height:1.05;letter-spacing:-.02em;margin:0 0 12px;
  text-wrap:balance;font-weight:600;}
.lede{font-size:16px;color:var(--muted);max-width:64ch;margin:0 0 20px;}
.mapcard{background:var(--surface);border:1px solid var(--line);border-radius:14px;
  box-shadow:var(--shadow);padding:8px;overflow:hidden;}
svg.map{display:block;width:100%;height:auto;background:var(--svg-bg);border-radius:8px;}
svg.map text{font-family:"IBM Plex Mono",monospace;fill:var(--ink);
  paint-order:stroke;stroke:var(--svg-bg);stroke-width:3.5px;stroke-linejoin:round;}
svg.map .edge{stroke:var(--edge);stroke-width:1;fill:none;}
svg.map .edge.hot{stroke:var(--accent);stroke-width:1.6;opacity:.9;}
svg.map .seedring{fill:none;stroke:var(--ink);stroke-width:2.5;}
svg.map .disc{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-dasharray:3 3;}
.legend{display:flex;flex-wrap:wrap;gap:10px 16px;margin:14px 2px 0;}
.legend span{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);
  font-family:"IBM Plex Mono",monospace;}
.legend i{width:11px;height:11px;border-radius:50%;display:inline-block;}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px;}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;
  padding:16px 18px;box-shadow:var(--shadow);}
.panel h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
  margin:0 0 12px;font-family:"IBM Plex Mono",monospace;font-weight:600;}
.row{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-top:1px solid var(--line);}
.row:first-of-type{border-top:none;}
.row .v{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--muted);
  width:64px;flex:none;}
.row .d{font-weight:500;} .row .c{font-family:"IBM Plex Mono",monospace;font-size:11px;
  color:var(--muted);margin-left:auto;}
.dotc{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:2px;flex:none;}
.note{margin-top:24px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);
  border-radius:12px;color:var(--muted);font-size:13.5px;box-shadow:var(--shadow);}
.note b{color:var(--ink);}
@media (max-width:640px){.panels{grid-template-columns:1fr;}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;}}
"""


def _esc(s) -> str:
    return html.escape(str(s), quote=True)


def _layout(nodes: List[str], edges: List[Tuple[str, str]],
            w: float, h: float, iters: int = 260, seed: int = 7
            ) -> Dict[str, List[float]]:
    rnd = random.Random(seed)
    pad = 54.0
    pos = {n: [rnd.uniform(pad, w - pad), rnd.uniform(pad, h - pad)] for n in nodes}
    k = math.sqrt((w * h) / max(len(nodes), 1)) * 1.1
    temp = w / 7.0
    for _ in range(iters):
        disp = {n: [0.0, 0.0] for n in nodes}
        for i, a in enumerate(nodes):
            for b in nodes[i + 1:]:
                dx = pos[a][0] - pos[b][0]; dy = pos[a][1] - pos[b][1]
                dist = math.hypot(dx, dy) or 0.01
                f = k * k / dist
                ux, uy = dx / dist, dy / dist
                disp[a][0] += ux * f; disp[a][1] += uy * f
                disp[b][0] -= ux * f; disp[b][1] -= uy * f
        for u, v in edges:
            dx = pos[u][0] - pos[v][0]; dy = pos[u][1] - pos[v][1]
            dist = math.hypot(dx, dy) or 0.01
            f = dist * dist / k
            ux, uy = dx / dist, dy / dist
            disp[u][0] -= ux * f; disp[u][1] -= uy * f
            disp[v][0] += ux * f; disp[v][1] += uy * f
        for n in nodes:
            d = math.hypot(*disp[n]) or 0.01
            pos[n][0] = min(w - pad, max(pad, pos[n][0] + disp[n][0] / d * min(d, temp)))
            pos[n][1] = min(h - pad, max(pad, pos[n][1] + disp[n][1] / d * min(d, temp)))
        temp = max(temp * 0.955, 2.0)
    return pos


def _svg(graph, pagerank: Dict[str, float], seeds: List[str],
         discovered: List[str]) -> str:
    W, H = 940.0, 680.0
    nodes = sorted(graph.nodes)
    edges = [(u, v) for u in nodes for v in graph.out.get(u, ())]
    pos = _layout(nodes, edges, W, H)
    seed_set, disc_set = set(seeds), set(discovered)
    hot = seed_set | disc_set

    pr_vals = list(pagerank.values()) or [0.0]
    pr_max = max(pr_vals) or 1.0

    def radius(n: str) -> float:
        return 5.0 + 20.0 * math.sqrt(pagerank.get(n, 0.0) / pr_max)

    parts = [f'<svg class="map" viewBox="0 0 {int(W)} {int(H)}" '
             f'role="img" aria-label="Domain hyperlink graph of the AI-agent ecosystem" '
             f'preserveAspectRatio="xMidYMid meet">']
    # edges
    for u, v in edges:
        cls = "edge hot" if (u in hot or v in hot) else "edge"
        x1, y1 = pos[u]; x2, y2 = pos[v]
        parts.append(f'<line class="{cls}" x1="{x1:.1f}" y1="{y1:.1f}" '
                     f'x2="{x2:.1f}" y2="{y2:.1f}" />')
    # nodes + labels
    for n in nodes:
        x, y = pos[n]; r = radius(n)
        cat = graph.labels.get(n, "hub")
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" '
                     f'fill="var(--cat-{_esc(cat)})" stroke="var(--svg-bg)" stroke-width="1.5"/>')
        if n in seed_set:
            parts.append(f'<circle class="seedring" cx="{x:.1f}" cy="{y:.1f}" r="{r+4:.1f}"/>')
        elif n in disc_set:
            parts.append(f'<circle class="disc" cx="{x:.1f}" cy="{y:.1f}" r="{r+4:.1f}"/>')
        fs = 12 if r > 14 else 10.5
        ly = y - r - 4 if y - r - 4 > 14 else y + r + 12
        parts.append(f'<text x="{x:.1f}" y="{ly:.1f}" text-anchor="middle" '
                     f'font-size="{fs}" font-weight="{600 if n in hot else 400}">{_esc(n)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def _legend() -> str:
    items = "".join(
        f'<span><i style="background:var(--cat-{k})"></i>{_esc(label)}</span>'
        for k, label in _CATS
    )
    items += ('<span><i style="background:var(--ink);width:9px;height:9px;'
              'border-radius:50%"></i>seed</span>')
    return f'<div class="legend">{items}</div>'


def _panel(title: str, rows: List[str]) -> str:
    return f'<div class="panel"><h2>{_esc(title)}</h2>{"".join(rows)}</div>'


def render(graph, pagerank: Dict[str, float], seeds: List[str],
           discovery: List[Tuple[str, float]], mode: str = "standalone") -> str:
    discovered = [d for d, _ in discovery]
    top = graph.top(8, by="pagerank")

    auth_rows = []
    for d, s in top:
        cat = graph.labels.get(d, "")
        auth_rows.append(
            f'<div class="row"><span class="v">{s:.4f}</span>'
            f'<span class="dotc" style="background:var(--cat-{_esc(cat)})"></span>'
            f'<span class="d">{_esc(d)}</span><span class="c">in {graph.in_degree(d)}</span></div>')

    disc_rows = []
    for d, s in discovery[:8]:
        cat = graph.labels.get(d, "")
        disc_rows.append(
            f'<div class="row"><span class="v">{s:.2f}</span>'
            f'<span class="dotc" style="background:var(--cat-{_esc(cat)})"></span>'
            f'<span class="d">{_esc(d)}</span><span class="c">{_esc(cat)}</span></div>')
    if not disc_rows:
        disc_rows = ['<div class="row"><span class="d">no seeds given</span></div>']

    seed_txt = ", ".join(_esc(s) for s in seeds) if seeds else "—"
    body = f"""
<div class="wrap">
  <header>
    <p class="eyebrow">AgentScope · web structure</p>
    <h1>The AI-agent web, mapped by structure not content</h1>
    <p class="lede">A domain-level hyperlink graph of {graph.order()} nodes and
      {graph.size()} links. Node size is PageRank (structural authority), colour is
      category. This is the cheap top of the funnel &mdash; who links to whom &mdash;
      before a single page is fetched.</p>
  </header>
  <div class="mapcard">{_svg(graph, pagerank, seeds, discovered)}</div>
  {_legend()}
  <div class="panels">
    {_panel("Structural authorities · PageRank", auth_rows)}
    {_panel(f"Discovered near seeds ({seed_txt})", disc_rows)}
  </div>
  <div class="note"><b>How discovery works:</b> given companies you already know
    (the ringed seeds), AgentScope ranks other domains by how much of the same
    stack they link out to &mdash; surfacing structurally similar companies as new
    prospects, plus the vendors they cluster around. <b>Scope:</b> published graph
    data only; no probing or scanning. This sample uses real domains with
    illustrative edges &mdash; swap in a Web Data Commons host/domain graph by path.</div>
</div>
"""
    head = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
            'family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">')
    title = "AI-Agent Web Map"
    if mode == "artifact":
        return f'<title>{title}</title>{head}<style>{_CSS}</style>{body}'
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{title}</title>{head}<style>{_CSS}</style></head><body>{body}</body></html>')
