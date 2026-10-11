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
type Message = { id: number; trader: string; kind: "chat" | "trade" | "rejected" | "system"; body: string; created_at: Date };
type Trade = { id: number; trader: string; side: string; coin: string; usd: string; price: string; reason: string; created_at: Date };

async function load() {
  try {
    const [meta, traders, holdings, latest, hourAgo, spark, values, messages, trades] = await Promise.all([
      pool.query<{ key: string; value: string }>("SELECT key, value FROM market_meta"),
      pool.query<Trader>("SELECT name, persona, model, start_usd, cash FROM traders ORDER BY name"),
      pool.query<{ trader: string; coin: string; qty: string }>("SELECT trader, coin, qty FROM holdings WHERE qty > 0"),
      pool.query<{ coin: string; price: string; ts: Date }>("SELECT DISTINCT ON (coin) coin, price, ts FROM prices ORDER BY coin, ts DESC"),
      pool.query<{ coin: string; price: string }>(
        "SELECT DISTINCT ON (coin) coin, price FROM prices WHERE ts <= now() - interval '1 hour' ORDER BY coin, ts DESC",
      ),
      pool.query<{ coin: string; ts: Date; price: string }>(
        "SELECT coin, ts, price FROM prices WHERE ts > now() - interval '3 hours' ORDER BY ts",
      ),
      pool.query<{ series: string; ts: Date; value: string }>(
        "SELECT series, ts, value FROM value_history WHERE ts > now() - interval '12 hours' ORDER BY ts",
      ),
      pool.query<Message>("SELECT * FROM floor_messages ORDER BY id DESC LIMIT 80"),
      pool.query<Trade>("SELECT id, trader, side, coin, usd, price, reason, created_at FROM trades ORDER BY id DESC LIMIT 15"),
    ]);
    return { meta, traders, holdings, latest, hourAgo, spark, values, messages, trades };
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

function Change({ value }: { value: number }) {
  return <span className={value >= 0 ? "up" : "down"}>{pct(value)}</span>;
}

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
            That starts 5 local-model traders with $10,000 of paper money each, trading at live Coinbase prices. This page
            updates on its own.
          </p>
        </div>
      </>
    );
  }

  const meta = Object.fromEntries(data.meta.rows.map((r) => [r.key, r.value]));
  const coins = (meta.coins ?? "").split(",").filter(Boolean);
  const live = meta.price_source === "coinbase";
  const priceNow = Object.fromEntries(data.latest.rows.map((r) => [r.coin, Number(r.price)]));
  const lastTick = Math.max(...data.latest.rows.map((r) => r.ts.getTime()));
  const stale = Date.now() - lastTick > 60_000;
  const priceHourAgo = Object.fromEntries(data.hourAgo.rows.map((r) => [r.coin, Number(r.price)]));

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
            {stale ? "Price feed stopped" : live ? "Live prices from Coinbase" : "Simulated prices"}
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
          const ago = priceHourAgo[coin] ?? sparkByCoin.get(coin)?.[0];
          return (
            <div key={coin} className="ticker">
              <div className="ticker-top">
                <span className="symbol">{coin}</span>
                {now && ago ? <Change value={((now - ago) / ago) * 100} /> : null}
              </div>
              <div className="ticker-price num">{now ? fmtPrice(now) : "—"}</div>
              <Sparkline points={thin(sparkByCoin.get(coin) ?? [], 120)} />
              <div className="meta">1-hour change · last 3 hours</div>
            </div>
          );
        })}
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
                        <td>
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

        <section className="floor" aria-labelledby="floor-title">
          <h2 id="floor-title">On the floor</h2>
          <ol className="feed">
            {data.messages.rows.map((m) => (
              <li key={m.id} className={`msg ${m.kind}`}>
                {m.kind === "system" ? (
                  <span>{m.body}</span>
                ) : (
                  <>
                    <div className="msg-head">
                      <span className="swatch" style={{ background: traderColor(m.trader) }} />
                      <strong>{m.trader}</strong>
                      {m.kind !== "chat" && <span className={`badge ${m.kind}`}>{m.kind === "trade" ? "Trade" : "Rejected"}</span>}
                      <span className="meta">{timeAgo(m.created_at)}</span>
                    </div>
                    <p>{m.body}</p>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
