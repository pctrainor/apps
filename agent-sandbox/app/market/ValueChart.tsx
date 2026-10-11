"use client";

import { useEffect, useRef, useState } from "react";

export type Series = { key: string; label: string; color: string; dashed?: boolean; points: { t: number; v: number }[] };

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const clock = (t: number, seconds = false) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined });

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/** Portfolio value over time, one line per trader plus a dashed benchmark. Hover for exact values. */
export default function ValueChart({ series, height = 280 }: { series: Series[]; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
  if (times.length < 2) {
    return (
      <div ref={wrap} className="chart">
        <p className="chart-empty">The chart fills in after the first couple of price updates.</p>
      </div>
    );
  }

  const pad = { l: 68, r: 16, t: 12, b: 28 };
  const t0 = times[0];
  const t1 = times[times.length - 1];
  let vMin = Math.min(...all.map((p) => p.v));
  let vMax = Math.max(...all.map((p) => p.v));
  const spread = Math.max(vMax - vMin, vMax * 0.002, 1);
  vMin -= spread * 0.08;
  vMax += spread * 0.08;
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * plotH;
  const yTicks = niceTicks(vMin, vMax, 4);
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((f) => t0 + f * (t1 - t0));
  const showSeconds = t1 - t0 < 15 * 60_000;

  const nearest = (points: { t: number; v: number }[], t: number) =>
    points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left - pad.l) / plotW) * (t1 - t0);
    setHoverT(nearest(times.map((tt) => ({ t: tt, v: 0 })), t).t);
  };

  const hoverRows =
    hoverT == null
      ? []
      : series
          .filter((s) => s.points.length > 0)
          .map((s) => ({ s, p: nearest(s.points, hoverT) }))
          .sort((a, b) => b.p.v - a.p.v);
  const tipLeft = hoverT == null ? 0 : x(hoverT) + 14 > width - 200 ? x(hoverT) - 214 : x(hoverT) + 14;

  return (
    <div ref={wrap} className="chart">
      <ul className="legend" aria-label="Chart legend">
        {series.map((s) => (
          <li key={s.key}>
            <svg width="18" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinecap="round" />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Portfolio value over time for each trader"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverT(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 8} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">
              {money(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={x(t)} y={height - 8} className="axis" textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
            {clock(t, showSeconds)}
          </text>
        ))}
        {series.map((s) =>
          s.points.length > 1 ? (
            <path
              key={s.key}
              d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
          ) : null,
        )}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return last ? <circle key={s.key} cx={x(last.t)} cy={y(last.v)} r="4" fill={s.color} className="endpoint" /> : null;
        })}
        {hoverT != null && (
          <g>
            <line x1={x(hoverT)} x2={x(hoverT)} y1={pad.t} y2={height - pad.b} className="crosshair" />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.key} cx={x(p.t)} cy={y(p.v)} r="4" fill={s.color} className="endpoint" />
            ))}
          </g>
        )}
      </svg>
      {hoverT != null && (
        <div className="tooltip" style={{ left: tipLeft, top: pad.t + 28 }}>
          <div className="tooltip-time">{clock(hoverT, true)}</div>
          {hoverRows.map(({ s, p }) => (
            <div key={s.key} className="tooltip-row">
              <span className="swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span className="num">{money2(p.v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
