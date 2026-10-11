import { pool } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { PERSONAS, pct, price as fmtPrice, usd as fmtUsd, usdChange } from "@/lib/market";
import AutoRefresh from "../activity/AutoRefresh";
import ValueChart, { type Series } from "./ValueChart";

// Each trader keeps its color across reloads and filters: color follows the trader, never its rank.
const traderColor = (name: string) => {
  const i = PERSONAS.findIndex((p) => p.name === name);
  return `var(--series-${(i >= 0 ? i : 7) + 1})`;
};

type Trader = { name: string; persona: string; model: string; start_usd: string; cash: string };
type Kind = "chat" | "trade" | "rejected" | "system" | "research" | "memory" | "consensus";
type Message = { id: number; trader: string; kind: Kind; body: string; created_at: Date };
type Trade = { id: number; trader: string; side: string; coin: string; usd: string; price: string; reason: string; created_at: Date };
type Memory = { trader: string; kind: "note" | "lesson" | "reflection"; body: string; created_at: Date };
type Research = { trader: string; tool: string; input: string; ok: boolean; result: string; created_at: Date };
type MarketRow = { price: number; ch1h: number | null; ch24h: number | null; ch7d: number | null };
type Brief = {
  updatedAt: number;
  fearGreed?: { value: number; label: string; history: number[] };
  trending?: { symbol: string; name: string; change24h: number | null }[];
  headlines?: { source: string; title: string; link: string; published: number }[];
  errors: string[];
};

async function load() {
  try {
    const [meta, traders, holdings, latest, spark, values, messages, trades, memories, research, consensus] = await Promise.all([
      pool.query<{ key: string; value: string }>("SELECT key, value FROM market_meta"),
      pool.query<Trader>("SELECT name, persona, model, start_usd, cash FROM traders ORDER BY name"),
      pool.query<{ trader: string; coin: string; qty: string }>("SELECT trader, coin, qty FROM holdings WHERE qty > 0"),
      pool.query<{ coin: string; price: string; ts: Date }>("SELECT DISTINCT ON (coin) coin, price, ts FROM prices ORDER BY coin, ts DESC"),
      pool.query<{ coin: string; ts: Date; price: string }>("SELECT coin, ts, price FROM prices WHERE ts > now() - interval '24 hours' ORDER BY ts"),
      pool.query<{ series: string; ts: Date; value: string }>(
        "SELECT series, ts, value FROM value_history WHERE ts > now() - interval '12 hours' ORDER BY ts",
      ),
      pool.query<Message>("SELECT * FROM floor_messages ORDER BY id DESC LIMIT 100"),
      pool.query<Trade>("SELECT id, trader, side, coin, usd, price, reason, created_at FROM trades ORDER BY id DESC LIMIT 15"),
      pool.query<Memory>("SELECT trader, kind, body, created_at FROM trader_memories ORDER BY id DESC LIMIT 500"),
      pool.query<Research>("SELECT trader, tool, input, ok, result, created_at FROM research_log ORDER BY id DESC LIMIT 80"),
      pool.query<{ author: string; body: string; created_at: Date }>("SELECT author, body, created_at FROM consensus ORDER BY id DESC LIMIT 1"),
    ]);
    return { meta, traders, holdings, latest, spark, values, messages, trades, memories, research, consensus };
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null; // tables not created yet
    throw err;
  }
}

/** Keep at most `max` evenly spaced points, always including the last one. */
function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out = Array.from({ length: max - 1 }, (_, i) => xs[Math.floor(i * step)]);
  out.push(xs[xs.length - 1]);
  return out;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 132;
  const h = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (w - 6) + 3, h - 4 - ((p - min) / range) * (h - 8)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg width={w} height={h} className="spark" aria-hidden="true">
      <path d={`${line}L${lx.toFixed(1)},${h}L3,${h}Z`} className="spark-area" />
      <path d={line} className="spark-line" />
      <circle cx={lx} cy={ly} r="3" className="spark-dot" />
    </svg>
  );
}

function Change({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="meta">n/a</span>;
  return <span className={value >= 0 ? "up" : "down"}>{pct(value)}</span>;
}

const BADGE: Partial<Record<Kind, string>> = { trade: "Trade", rejected: "Rejected", research: "Research", memory: "Memory" };

export default async function MarketPage() {
  const data = await load();
  if (!data || data.traders.rows.length === 0) {
    return (
      <>
        <AutoRefresh seconds={3} />
        <h1>Trading floor</h1>
        <div className="card">
          <p>No traders yet. In a second terminal, from the agent-sandbox folder, run:</p>
          <pre className="code">npm run market</pre>
          <p className="meta">
            That starts 5 local-model traders with $10,000 of paper money each, trading at live CoinGecko prices. This page
            updates on its own.
          </p>
        </div>
      </>
    );
  }

  const meta = Object.fromEntries(data.meta.rows.map((r) => [r.key, r.value]));
  const coins = (meta.coins ?? "").split(",").filter(Boolean);
  const live = meta.price_source === "coingecko";
  const markets = (meta.markets ? JSON.parse(meta.markets) : {}) as Record<string, MarketRow>;
  const brief = (meta.brief ? JSON.parse(meta.brief) : null) as Brief | null;
  const geckoCalls = Number(meta[`coingecko_calls:${new Date().toISOString().slice(0, 7)}`] ?? 0);
  const priceNow = Object.fromEntries(data.latest.rows.map((r) => [r.coin, Number(r.price)]));
  const lastTick = Math.max(...data.latest.rows.map((r) => r.ts.getTime()));
  const stale = Date.now() - lastTick > 3 * 60_000;

  const sparkByCoin = new Map<string, number[]>();
  for (const r of data.spark.rows) sparkByCoin.set(r.coin, [...(sparkByCoin.get(r.coin) ?? []), Number(r.price)]);

  const holdingsByTrader = new Map<string, { coin: string; qty: number }[]>();
  for (const h of data.holdings.rows) {
    holdingsByTrader.set(h.trader, [...(holdingsByTrader.get(h.trader) ?? []), { coin: h.coin, qty: Number(h.qty) }]);
  }

  const board = data.traders.rows
    .map((t) => {
      const cash = Number(t.cash);
      const start = Number(t.start_usd);
      const positions = (holdingsByTrader.get(t.name) ?? []).map((h) => ({ ...h, value: h.qty * (priceNow[h.coin] ?? 0) }));
      const total = cash + positions.reduce((s, p) => s + p.value, 0);
      return { ...t, cash, start, positions, total, change: ((total - start) / start) * 100 };
    })
    .sort((a, b) => b.total - a.total);

  // Chart series from the value history, thinned to keep the page light.
  const bySeries = new Map<string, { t: number; v: number }[]>();
  for (const r of data.values.rows) bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), { t: r.ts.getTime(), v: Number(r.value) }]);
  const series: Series[] = [
    ...board.map((t) => ({ key: t.name, label: t.name, color: traderColor(t.name), points: thin(bySeries.get(t.name) ?? [], 240) })),
    { key: "benchmark", label: "Equal split, no trading", color: "var(--muted)", dashed: true, points: thin(bySeries.get("benchmark") ?? [], 240) },
  ];
  const benchmarkNow = bySeries.get("benchmark")?.at(-1)?.v;
  const startUsd = board[0]?.start ?? 10_000;
  const consensus = data.consensus.rows[0];

  const mind = (name: string) => {
    const mine = data.memories.rows.filter((m) => m.trader === name);
    return {
      reflection: mine.find((m) => m.kind === "reflection"),
      lessons: mine.filter((m) => m.kind === "lesson").slice(0, 3),
      notes: mine.filter((m) => m.kind === "note").slice(0, 3),
      research: data.research.rows.filter((r) => r.trader === name).slice(0, 3),
    };
  };

  return (
    <div className="wide">
      <AutoRefresh seconds={2} />
      <div className="market-head">
        <div>
          <h1>Trading floor</h1>
          <p className="lede">
            {board.length} local-model traders with paper money. Model: <strong>{meta.model ?? "?"}</strong>.
          </p>
        </div>
        <div className="feed-status">
          <span className={`pill ${stale ? "warn" : live ? "live" : "sim"}`}>
            {stale ? "Price feed stopped" : live ? "Live prices from CoinGecko" : "Simulated prices"}
          </span>
          <span className="meta">
            {stale ? `Last update ${timeAgo(new Date(lastTick))}. Is npm run market running?` : `Updated ${timeAgo(new Date(lastTick))}`}
          </span>
          <span className="pill paper">Paper money only</span>
        </div>
      </div>

      <section className="tickers" aria-label="Prices">
        {coins.map((coin) => {
          const now = priceNow[coin];
          const points = sparkByCoin.get(coin) ?? [];
          const change24 = markets[coin]?.ch24h ?? (now && points[0] ? ((now - points[0]) / points[0]) * 100 : null);
          return (
            <div key={coin} className="ticker">
              <div className="ticker-top">
                <span className="symbol">{coin}</span>
                <Change value={change24} />
              </div>
              <div className="ticker-price num">{now ? fmtPrice(now) : "—"}</div>
              <Sparkline points={thin(points, 120)} />
              <div className="meta">24-hour change · last 24 hours</div>
            </div>
          );
        })}
      </section>

      <section className="consensus" aria-labelledby="consensus-title">
        <div className="consensus-head">
          <h2 id="consensus-title">Group consensus</h2>
          {consensus && (
            <span className="meta">
              {consensus.author} · {timeAgo(consensus.created_at)}
            </span>
          )}
        </div>
        {consensus ? (
          <p className="consensus-body">{consensus.body}</p>
        ) : (
          <p className="meta">
            No consensus yet. The floor lead posts one with <code>npm run consensus</code> or the floor-lead skill, and every
            trader reads it on its next turn.
          </p>
        )}
      </section>

      <div className="market-grid">
        <div className="market-main">
          <section aria-labelledby="board-title">
            <h2 id="board-title">Leaderboard</h2>
            <div className="table-wrap">
              <table className="board">
                <thead>
                  <tr>
                    <th>Trader</th>
                    <th className="right">Total</th>
                    <th className="right">Since start</th>
                    <th className="right">Cash</th>
                    <th>Holdings</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((t) => (
                    <tr key={t.name}>
                      <td>
                        <span className="swatch" style={{ background: traderColor(t.name) }} />
                        <strong>{t.name}</strong>
                        <div className="meta">{t.persona}</div>
                      </td>
                      <td className="right num">{fmtUsd(t.total)}</td>
                      <td className="right num">
                        <Change value={t.change} />
                        <div className="meta">{usdChange(t.total - t.start)}</div>
                      </td>
                      <td className="right num">{fmtUsd(t.cash)}</td>
                      <td>
                        {t.positions.length === 0 ? (
                          <span className="meta">All cash</span>
                        ) : (
                          <ul className="positions">
                            {t.positions
                              .sort((a, b) => b.value - a.value)
                              .map((p) => (
                                <li key={p.coin}>
                                  <span className="num">{p.qty.toPrecision(4)}</span> {p.coin}{" "}
                                  <span className="meta">
                                    {fmtUsd(p.value)} · {((p.value / t.total) * 100).toFixed(0)}%
                                  </span>
                                </li>
                              ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                  {benchmarkNow != null && (
                    <tr className="benchmark-row">
                      <td>
                        <svg width="18" height="8" className="dash-swatch" aria-hidden="true">
                          <line x1="1" y1="4" x2="17" y2="4" stroke="var(--muted)" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
                        </svg>
                        Equal split, no trading
                        <div className="meta">{fmtUsd(startUsd)} split evenly at the opening prices</div>
                      </td>
                      <td className="right num">{fmtUsd(benchmarkNow)}</td>
                      <td className="right num">
                        <Change value={((benchmarkNow - startUsd) / startUsd) * 100} />
                      </td>
                      <td className="right num">—</td>
                      <td className="meta">The bar to beat</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="chart-title">
            <h2 id="chart-title">Portfolio value</h2>
            <ValueChart series={series} />
          </section>

          <section aria-labelledby="minds-title">
            <h2 id="minds-title">Memory and research</h2>
            <div className="minds">
              {board.map((t) => {
                const m = mind(t.name);
                return (
                  <details key={t.name} className="mind">
                    <summary>
                      <span className="swatch" style={{ background: traderColor(t.name) }} />
                      <strong>{t.name}</strong>
                      <span className="meta">
                        {m.reflection ? `memory updated ${timeAgo(m.reflection.created_at)}` : "no long-term memory yet"}
                        {m.research.length > 0 && ` · last lookup ${timeAgo(m.research[0].created_at)}`}
                      </span>
                    </summary>
                    <div className="mind-body">
                      <div>
                        <h3>Long-term memory</h3>
                        <p>{m.reflection?.body ?? "Written after the trader's first few turns."}</p>
                      </div>
                      {m.lessons.length > 0 && (
                        <div>
                          <h3>Lessons</h3>
                          <ul>{m.lessons.map((l, i) => <li key={i}>{l.body}</li>)}</ul>
                        </div>
                      )}
                      {m.notes.length > 0 && (
                        <div>
                          <h3>Recent notes</h3>
                          <ul>{m.notes.map((n, i) => <li key={i}>{n.body} <span className="meta">{timeAgo(n.created_at)}</span></li>)}</ul>
                        </div>
                      )}
                      {m.research.length > 0 && (
                        <div>
                          <h3>Research</h3>
                          <ul className="research">
                            {m.research.map((r, i) => (
                              <li key={i}>
                                <strong>{r.tool}</strong> {r.input && `“${r.input}”`}{" "}
                                <span className="meta">{timeAgo(r.created_at)}{r.ok ? "" : " · failed"}</span>
                                <p className="research-result">{r.result.slice(0, 320)}{r.result.length > 320 ? "…" : ""}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="trades-title">
            <h2 id="trades-title">Latest trades</h2>
            {data.trades.rows.length === 0 ? (
              <p className="meta">No trades yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Trader</th>
                      <th>Order</th>
                      <th className="right">Price</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.rows.map((t) => (
                      <tr key={t.id}>
                        <td className="meta">{timeAgo(t.created_at)}</td>
                        <td>
                          <span className="swatch" style={{ background: traderColor(t.trader) }} />
                          {t.trader}
                        </td>
                        <td className="nowrap">
                          <span className={`side ${t.side}`}>{t.side === "buy" ? "Buy" : "Sell"}</span> {fmtUsd(Number(t.usd))} {t.coin}
                        </td>
                        <td className="right num">{fmtPrice(Number(t.price))}</td>
                        <td className="meta">{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="side">
          <section className="brief" aria-labelledby="brief-title">
            <h2 id="brief-title">Market brief</h2>
            {!live ? (
              <p className="meta">Off in simulated mode. With live prices this shows the Fear &amp; Greed index, trending coins and headlines.</p>
            ) : !brief ? (
              <p className="meta">Loading the first brief…</p>
            ) : (
              <>
                {brief.fearGreed && (
                  <div className="fng">
                    <span className="fng-value num">{brief.fearGreed.value}</span>
                    <div>
                      <strong>{brief.fearGreed.label}</strong>
                      <div className="meta">Fear &amp; Greed index · 7 days: {brief.fearGreed.history.slice().reverse().join(" → ")}</div>
                    </div>
                  </div>
                )}
                {brief.trending && brief.trending.length > 0 && (
                  <p className="trending">
                    <span className="meta">Trending:</span>{" "}
                    {brief.trending.map((c) => (
                      <span key={c.symbol} className="chip">{c.symbol}</span>
                    ))}
                  </p>
                )}
                {brief.headlines && brief.headlines.length > 0 && (
                  <ul className="headlines">
                    {brief.headlines.slice(0, 5).map((h) => (
                      <li key={h.link}>
                        <a href={h.link} target="_blank" rel="noopener noreferrer">{h.title}</a>
                        <div className="meta">{h.source} · {timeAgo(new Date(h.published))}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {brief.errors.length > 0 && <p className="meta">Couldn&apos;t load: {brief.errors.join("; ")}</p>}
                <p className="meta">Updated {timeAgo(new Date(brief.updatedAt))}</p>
              </>
            )}
          </section>

          <section className="floor" aria-labelledby="floor-title">
            <h2 id="floor-title">On the floor</h2>
            <ol className="feed">
              {data.messages.rows.map((m) => (
                <li key={m.id} className={`msg ${m.kind}`}>
                  {m.kind === "system" ? (
                    <span>{m.body}</span>
                  ) : m.kind === "consensus" ? (
                    <>
                      <div className="msg-head">
                        <span className="badge consensus">Consensus</span>
                        <strong>{m.trader}</strong>
                        <span className="meta">{timeAgo(m.created_at)}</span>
                      </div>
                      <p>{m.body}</p>
                    </>
                  ) : (
                    <>
                      <div className="msg-head">
                        <span className="swatch" style={{ background: traderColor(m.trader) }} />
                        <strong>{m.trader}</strong>
                        {BADGE[m.kind] && <span className={`badge ${m.kind}`}>{BADGE[m.kind]}</span>}
                        <span className="meta">{timeAgo(m.created_at)}</span>
                      </div>
                      <p>{m.body}</p>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <p className="meta attribution">
        {live ? (
          <>
            Price data by{" "}
            <a href="https://www.coingecko.com/" target="_blank" rel="noopener noreferrer">
              CoinGecko
            </a>{" "}
            · {geckoCalls.toLocaleString()} CoinGecko calls this month (the free Demo plan allows 10,000)
          </>
        ) : (
          "Simulated prices: not real market data."
        )}
      </p>
    </div>
  );
}
