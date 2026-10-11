// The floor lead's tools. The floor lead is a higher-level model (for now, a Claude session using the
// floor-lead skill) that reads the whole floor and posts a group consensus every trader sees on its next turn.
//
//   npm run -s consensus -- digest                          print the floor digest (Markdown)
//   npm run -s consensus -- post --file note.md [--author "floor lead"]
//   npm run -s consensus -- post "text of the consensus"
//   npm run -s consensus -- auto                            let CONSENSUS_MODEL write and post it

import { readFileSync } from "node:fs";
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "../lib/db";
import { pct, price as fmtPrice, usd as fmtUsd } from "../lib/market";
import { chatJson, llmConfigFromEnv } from "./llm";

try {
  process.loadEnvFile(".env");
} catch {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 3 });

const ago = (d: Date | number) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const ch = (n: number | null | undefined) => (n == null ? "n/a" : pct(n));

type MarketRow = { price: number; ch1h: number | null; ch24h: number | null; ch7d: number | null };
type Brief = {
  updatedAt: number;
  fearGreed?: { value: number; label: string; history: number[] };
  trending?: { symbol: string }[];
  headlines?: { source: string; title: string; published: number }[];
};

async function digest(): Promise<string> {
  const { rows: metaRows } = await pool.query<{ key: string; value: string }>("SELECT key, value FROM market_meta");
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  if (!meta.markets) return "The trading floor hasn't started yet. Start it with `npm run market`.";
  const markets = JSON.parse(meta.markets) as Record<string, MarketRow>;
  const brief = meta.brief ? (JSON.parse(meta.brief) as Brief) : null;
  const price = (coin: string) => markets[coin]?.price ?? 0;

  const [{ rows: lastTick }, { rows: traders }, { rows: holdings }, { rows: trades }, { rows: chats }, { rows: rejected }, { rows: memories }, { rows: research }, { rows: consensus }, { rows: bench }] =
    await Promise.all([
      pool.query<{ ts: Date }>("SELECT max(ts) AS ts FROM prices"),
      pool.query<{ name: string; persona: string; cash: string; start_usd: string }>("SELECT name, persona, cash, start_usd FROM traders ORDER BY name"),
      pool.query<{ trader: string; coin: string; qty: string }>("SELECT trader, coin, qty FROM holdings WHERE qty > 0"),
      pool.query<{ trader: string; side: string; coin: string; usd: string; price: string; created_at: Date }>(
        "SELECT trader, side, coin, usd, price, created_at FROM trades WHERE created_at > now() - interval '3 hours' ORDER BY id DESC",
      ),
      pool.query<{ trader: string; body: string; created_at: Date }>(
        "SELECT trader, body, created_at FROM floor_messages WHERE kind = 'chat' ORDER BY id DESC LIMIT 60",
      ),
      pool.query<{ trader: string; body: string }>(
        "SELECT trader, body FROM floor_messages WHERE kind = 'rejected' AND created_at > now() - interval '1 hour' ORDER BY id DESC LIMIT 10",
      ),
      pool.query<{ trader: string; kind: string; body: string }>(
        `SELECT DISTINCT ON (trader, kind) trader, kind, body FROM trader_memories
         WHERE kind IN ('reflection', 'lesson') ORDER BY trader, kind, id DESC`,
      ),
      pool.query<{ trader: string; tool: string; input: string; ok: boolean; created_at: Date }>(
        "SELECT trader, tool, input, ok, created_at FROM research_log WHERE created_at > now() - interval '2 hours' ORDER BY id DESC",
      ),
      pool.query<{ author: string; body: string; created_at: Date }>("SELECT author, body, created_at FROM consensus ORDER BY id DESC LIMIT 1"),
      pool.query<{ value: string }>("SELECT value FROM value_history WHERE series = 'benchmark' ORDER BY ts DESC LIMIT 1"),
    ]);

  const coins = (meta.coins ?? Object.keys(markets).join(",")).split(",");
  const out: string[] = [];
  out.push(`# Floor digest, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  out.push("");
  out.push(`## Prices (${meta.price_source === "coingecko" ? "CoinGecko" : "SIMULATED"}, updated ${lastTick[0]?.ts ? ago(lastTick[0].ts) : "never"})`);
  for (const coin of coins) {
    const m = markets[coin];
    if (m) out.push(`- ${coin} ${fmtPrice(m.price)} | 1h ${ch(m.ch1h)} | 24h ${ch(m.ch24h)} | 7d ${ch(m.ch7d)}`);
  }
  if (brief) {
    out.push("", `## Market brief (updated ${ago(brief.updatedAt)})`);
    if (brief.fearGreed) out.push(`- Fear & Greed ${brief.fearGreed.value} (${brief.fearGreed.label}); 7 days, newest first: ${brief.fearGreed.history.join(", ")}`);
    if (brief.trending?.length) out.push(`- Trending: ${brief.trending.map((t) => t.symbol).join(", ")}`);
    for (const h of brief.headlines?.slice(0, 6) ?? []) out.push(`- [${h.source}, ${ago(h.published)}] ${h.title}`);
  }

  // Positioning across the whole floor.
  const exposure: Record<string, number> = {};
  let floorTotal = 0;
  let floorCash = 0;
  const rows = traders.map((t) => {
    const cash = Number(t.cash);
    const start = Number(t.start_usd);
    const pos = holdings.filter((h) => h.trader === t.name).map((h) => ({ coin: h.coin, value: Number(h.qty) * price(h.coin) }));
    const total = cash + pos.reduce((s, p) => s + p.value, 0);
    floorTotal += total;
    floorCash += cash;
    for (const p of pos) exposure[p.coin] = (exposure[p.coin] ?? 0) + p.value;
    return { ...t, cash, start, pos, total };
  });
  rows.sort((a, b) => b.total - a.total);

  out.push("", "## Floor positioning");
  if (floorTotal > 0) {
    const parts = Object.entries(exposure)
      .sort((a, b) => b[1] - a[1])
      .map(([coin, v]) => `${coin} ${((v / floorTotal) * 100).toFixed(0)}%`);
    out.push(`- All traders together: ${[...parts, `cash ${((floorCash / floorTotal) * 100).toFixed(0)}%`].join(", ")}`);
  }
  const benchmark = Number(bench[0]?.value ?? NaN);
  if (Number.isFinite(benchmark) && rows[0]) {
    out.push(`- Benchmark (equal split at the open, no trading): ${fmtUsd(benchmark)} (${pct(((benchmark - rows[0].start) / rows[0].start) * 100)})`);
  }
  out.push(`- Trades in the last 3 hours: ${trades.length}. Rejected orders in the last hour: ${rejected.length}.`);

  out.push("", "## Traders (best first)");
  for (const t of rows) {
    out.push("", `### ${t.name}, ${t.persona}: ${fmtUsd(t.total)} (${pct(((t.total - t.start) / t.start) * 100)})`);
    const pos = t.pos
      .sort((a, b) => b.value - a.value)
      .map((p) => `${p.coin} ${fmtUsd(p.value)} (${((p.value / t.total) * 100).toFixed(0)}%)`);
    out.push(`- Holdings: ${[...pos, `cash ${fmtUsd(t.cash)} (${((t.cash / t.total) * 100).toFixed(0)}%)`].join(", ")}`);
    const mine = trades.filter((x) => x.trader === t.name).slice(0, 4);
    if (mine.length) {
      out.push(
        `- Recent trades: ${mine
          .map((x) => {
            const then = Number(x.price);
            const move = ((price(x.coin) - then) / then) * 100;
            return `${x.side} ${fmtUsd(Number(x.usd))} ${x.coin} ${ago(x.created_at)} (price since: ${pct(move)})`;
          })
          .join("; ")}`,
      );
    }
    const said = chats.filter((c) => c.trader === t.name).slice(0, 3);
    for (const c of said) out.push(`- Said ${ago(c.created_at)}: "${c.body}"`);
    const reflection = memories.find((m) => m.trader === t.name && m.kind === "reflection");
    if (reflection) out.push(`- Long-term memory: ${reflection.body}`);
    const looked = research.filter((r) => r.trader === t.name).slice(0, 3);
    if (looked.length) out.push(`- Researched: ${looked.map((r) => `${r.tool}${r.input ? ` "${r.input}"` : ""}${r.ok ? "" : " (failed)"}`).join(", ")}`);
  }

  if (rejected.length) {
    out.push("", "## Rejected orders, last hour");
    for (const r of rejected) out.push(`- ${r.trader}: ${r.body}`);
  }
  out.push("", "## Previous consensus");
  out.push(consensus[0] ? `Posted ${ago(consensus[0].created_at)} by ${consensus[0].author}:\n${consensus[0].body}` : "None yet.");
  return out.join("\n");
}

async function post(body: string, author: string) {
  const text = body.trim();
  if (text.length < 20) throw new Error("The consensus is too short (under 20 characters).");
  if (text.length > 2500) throw new Error("Keep the consensus under 2,500 characters. The traders are small models with small context.");
  await pool.query("INSERT INTO consensus (author, body) VALUES ($1, $2)", [author, text]);
  await pool.query("INSERT INTO floor_messages (trader, kind, body) VALUES ($1, 'consensus', $2)", [author, text]);
  console.log(`Posted consensus by ${author} (${text.length} characters). Traders see it on their next turn.`);
}

async function auto(author?: string) {
  const model = process.env.CONSENSUS_MODEL;
  if (!model) throw new Error("Set CONSENSUS_MODEL (and CONSENSUS_BASE_URL if it isn't the trader's server), or post one yourself.");
  const cfg = llmConfigFromEnv();
  cfg.model = model;
  if (process.env.CONSENSUS_BASE_URL) cfg.baseUrl = process.env.CONSENSUS_BASE_URL.replace(/\/+$/, "");
  if (process.env.CONSENSUS_API_KEY) cfg.apiKey = process.env.CONSENSUS_API_KEY;
  const guide = readFileSync(new URL("../.claude/skills/floor-lead/SKILL.md", import.meta.url), "utf8");
  const reply = await chatJson(
    cfg,
    [
      { role: "system", content: `You are the floor lead. Follow this guide, but you can't run commands: write the consensus text only.\n\n${guide}` },
      { role: "user", content: `${await digest()}\n\nWrite the consensus now. Reply as JSON: {"consensus": "..."}` },
    ],
    { type: "object", properties: { consensus: { type: "string" } }, required: ["consensus"], additionalProperties: false },
  );
  await post(String(reply.consensus ?? ""), author ?? `floor lead (${model})`);
}

async function main() {
  const [command = "digest", ...rest] = process.argv.slice(2);
  const option = (name: string) => {
    const i = rest.indexOf(name);
    if (i < 0) return undefined;
    const value = rest[i + 1];
    rest.splice(i, 2);
    return value;
  };
  if (command === "digest") console.log(await digest());
  else if (command === "post") {
    const author = option("--author") ?? "floor lead";
    const file = option("--file");
    const body = file ? readFileSync(file === "-" ? 0 : file, "utf8") : rest.join(" ");
    await post(body, author);
  } else if (command === "auto") await auto(option("--author"));
  else {
    console.log("Usage: npm run -s consensus -- digest | post --file note.md [--author name] | post \"text\" | auto");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
