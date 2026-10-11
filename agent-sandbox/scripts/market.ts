// Trading floor: local-model traders with paper money at real Coinbase prices.
//
//   npm run market                 5 traders, live Coinbase prices, model from LLM_MODEL (default qwen2.5:7b-instruct on Ollama)
//   npm run market -- -n 3         number of traders (1-8)
//   npm run market -- --reset      wipe the floor and start everyone over with fresh cash
//   npm run market -- --simulated  random-walk prices instead of Coinbase (offline testing)
//   npm run market -- --mock       scripted stand-in instead of a model (tests the plumbing only)
//
// Watch it at http://localhost:3000/market while `npm run dev` is running.

import { readFileSync } from "node:fs";
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "../lib/db";
import { FEE_RATE, PERSONAS, pct, price as fmtPrice, usd as fmtUsd, type Persona } from "../lib/market";
import { chatJson, checkModelServer, llmConfigFromEnv, mockTurn, type ChatMessage } from "./llm";

try {
  process.loadEnvFile(".env");
} catch {}

// ---------- settings ----------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const TRADER_COUNT = Math.min(PERSONAS.length, Math.max(1, Number(option("-n") ?? process.env.TRADERS ?? 5)));
const COINS = (process.env.MARKET_COINS ?? "BTC,ETH,SOL").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const START_USD = Number(process.env.START_USD ?? 10_000);
const MAX_ORDER_USD = Number(process.env.MAX_ORDER_USD ?? 2_500);
const MIN_ORDER_USD = 10;
const MAX_TRADES_PER_HOUR = Number(process.env.MAX_TRADES_PER_HOUR ?? 12);
const TURN_SECONDS = Number(process.env.TURN_SECONDS ?? 45);
const PRICE_SECONDS = Number(process.env.PRICE_SECONDS ?? 10);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 1));
const PRICE_SOURCE = flag("--simulated") || process.env.PRICE_SOURCE === "simulated" ? "simulated" : "coinbase";

const llm = llmConfigFromEnv();
if (flag("--mock")) llm.model = "mock";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 5 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- prices ----------

type Point = { t: number; p: number };
const history = new Map<string, Point[]>(); // per coin, oldest first, last ~6 hours
const latest = new Map<string, number>();

function remember(coin: string, t: number, p: number) {
  const list = history.get(coin) ?? [];
  if (list.length === 0 || t > list[list.length - 1].t) list.push({ t, p });
  while (list.length > 0 && list[0].t < Date.now() - 6 * 3600_000) list.shift();
  history.set(coin, list);
  latest.set(coin, p);
}

/** Price at or before `msAgo`, or the oldest we have. */
function priceAgo(coin: string, msAgo: number): number | undefined {
  const list = history.get(coin) ?? [];
  const cutoff = Date.now() - msAgo;
  let found: number | undefined = list[0]?.p;
  for (const point of list) {
    if (point.t <= cutoff) found = point.p;
    else break;
  }
  return found;
}

const COINBASE = "https://api.exchange.coinbase.com";
const coinbaseHeaders = { "User-Agent": "agent-sandbox/0.1", Accept: "application/json" };

async function coinbaseTicker(coin: string): Promise<number> {
  const res = await fetch(`${COINBASE}/products/${coin}-USD/ticker`, { headers: coinbaseHeaders, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Coinbase ${coin}-USD ticker returned ${res.status}`);
  const body = (await res.json()) as { price?: string };
  const value = Number(body.price);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Coinbase sent no price for ${coin}-USD`);
  return value;
}

/** Last ~5 hours of 1-minute closes, oldest first. */
async function coinbaseHistory(coin: string): Promise<Point[]> {
  const res = await fetch(`${COINBASE}/products/${coin}-USD/candles?granularity=60`, { headers: coinbaseHeaders, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const rows = (await res.json()) as [number, number, number, number, number, number][];
  return rows.map(([time, , , , close]) => ({ t: time * 1000, p: close })).sort((a, b) => a.t - b.t);
}

// Simulated prices are clearly labeled as such on the dashboard. Starting values are arbitrary.
const SIM_START: Record<string, number> = { BTC: 100_000, ETH: 4_000, SOL: 200, DOGE: 0.25, XRP: 2.5, ADA: 0.8 };
function simulatedStep(p: number) {
  const shock = (Math.random() + Math.random() + Math.random() - 1.5) * 0.004;
  return p * (1 + shock);
}

async function seedHistory() {
  for (const coin of COINS) {
    let points: Point[];
    if (PRICE_SOURCE === "coinbase") {
      points = await coinbaseHistory(coin);
    } else {
      // Walk backwards from the start price so the series ends there.
      points = [];
      let p = SIM_START[coin] ?? 100;
      for (let i = 1; i <= 300; i++) {
        points.push({ t: Date.now() - i * 60_000, p });
        p = simulatedStep(p);
      }
      points.reverse();
    }
    for (const point of points) remember(coin, point.t, point.p);
    if (points.length > 0) {
      await pool.query(
        `INSERT INTO prices (coin, ts, price, source)
         SELECT $1, to_timestamp(t / 1000.0), p, $2 FROM unnest($3::float8[], $4::float8[]) AS x(t, p)
         ON CONFLICT DO NOTHING`,
        [coin, PRICE_SOURCE, points.map((x) => x.t), points.map((x) => x.p)],
      );
    }
  }
}

async function pollPrices(): Promise<number> {
  const now = Date.now();
  const values = await Promise.all(
    COINS.map(async (coin) => {
      if (PRICE_SOURCE === "coinbase") return coinbaseTicker(coin);
      return simulatedStep(latest.get(coin) ?? SIM_START[coin] ?? 100);
    }),
  );
  COINS.forEach((coin, i) => remember(coin, now, values[i]));
  await pool.query(
    `INSERT INTO prices (coin, ts, price, source)
     SELECT c, to_timestamp($1 / 1000.0), p, $2 FROM unnest($3::text[], $4::float8[]) AS x(c, p)
     ON CONFLICT DO NOTHING`,
    [now, PRICE_SOURCE, COINS, values],
  );
  return now;
}

// ---------- accounts ----------

type Account = { cash: number; startUsd: number; qty: Record<string, number> };

async function account(trader: string, client: pg.PoolClient | pg.Pool = pool): Promise<Account> {
  const [{ rows: t }, { rows: h }] = await Promise.all([
    client.query<{ cash: string; start_usd: string }>("SELECT cash, start_usd FROM traders WHERE name = $1", [trader]),
    client.query<{ coin: string; qty: string }>("SELECT coin, qty FROM holdings WHERE trader = $1", [trader]),
  ]);
  const qty: Record<string, number> = {};
  for (const row of h) qty[row.coin] = Number(row.qty);
  return { cash: Number(t[0].cash), startUsd: Number(t[0].start_usd), qty };
}

const valueOf = (a: Account) => a.cash + Object.entries(a.qty).reduce((sum, [coin, q]) => sum + q * (latest.get(coin) ?? 0), 0);

async function snapshotValues(ts: number) {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM traders");
  const series: string[] = [];
  const values: number[] = [];
  for (const { name } of rows) {
    series.push(name);
    values.push(round2(valueOf(await account(name))));
  }
  // Benchmark: the starting cash split evenly across the coins at the opening prices, then left alone.
  const startPrices = JSON.parse((await meta("start_prices")) ?? "{}") as Record<string, number>;
  const perCoin = START_USD / COINS.length;
  const benchmark = COINS.reduce((sum, coin) => sum + (startPrices[coin] ? (perCoin / startPrices[coin]) * (latest.get(coin) ?? 0) : perCoin), 0);
  series.push("benchmark");
  values.push(round2(benchmark));
  await pool.query(
    `INSERT INTO value_history (series, ts, value)
     SELECT s, to_timestamp($1 / 1000.0), v FROM unnest($2::text[], $3::float8[]) AS x(s, v)
     ON CONFLICT DO NOTHING`,
    [ts, series, values],
  );
}

async function meta(key: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ value: string }>("SELECT value FROM market_meta WHERE key = $1", [key]);
  return rows[0]?.value;
}
async function setMeta(key: string, value: string) {
  await pool.query("INSERT INTO market_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, value]);
}

async function post(trader: string, kind: "chat" | "trade" | "rejected" | "system", body: string) {
  await pool.query("INSERT INTO floor_messages (trader, kind, body) VALUES ($1, $2, $3)", [trader, kind, body]);
}

// ---------- orders ----------

type Decision = { say: string; action: "buy" | "sell" | "hold"; coin: string | null; usd: number | null; reason: string };
type OrderResult = { ok: boolean; message: string };

async function executeOrder(trader: string, d: Decision): Promise<OrderResult | null> {
  if (d.action === "hold") return null;
  const coin = (d.coin ?? "").toUpperCase();
  const reject = (why: string): OrderResult => ({ ok: false, message: `Order rejected: ${d.action} ${d.usd != null ? fmtUsd(d.usd) : "?"} of ${coin || "?"}. ${why}` });
  if (!COINS.includes(coin)) return reject(`You can only trade ${COINS.join(", ")}.`);
  const p = latest.get(coin);
  if (!p) return reject("No price yet for that coin.");
  if (d.usd == null || !Number.isFinite(d.usd) || d.usd <= 0) return reject("Give the order size in US dollars.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM traders WHERE name = $1 FOR UPDATE", [trader]);
    const { rows: recent } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM trades WHERE trader = $1 AND created_at > now() - interval '1 hour'",
      [trader],
    );
    if (recent[0].n >= MAX_TRADES_PER_HOUR) {
      await client.query("ROLLBACK");
      return reject(`You've hit the limit of ${MAX_TRADES_PER_HOUR} trades an hour.`);
    }
    const acct = await account(trader, client);

    let amount: number; // USD value of the coins traded
    let qty: number;
    if (d.action === "buy") {
      amount = round2(d.usd);
      if (amount < MIN_ORDER_USD) return rollback(client, reject(`The smallest order is ${fmtUsd(MIN_ORDER_USD)}.`));
      if (amount > MAX_ORDER_USD) return rollback(client, reject(`The largest order is ${fmtUsd(MAX_ORDER_USD)}.`));
      if (amount > acct.cash) return rollback(client, reject(`You only have ${fmtUsd(acct.cash)} in cash.`));
      const fee = round2(amount * FEE_RATE);
      qty = (amount - fee) / p;
      await client.query("UPDATE traders SET cash = cash - $2 WHERE name = $1", [trader, amount]);
      await client.query(
        `INSERT INTO holdings (trader, coin, qty) VALUES ($1, $2, $3)
         ON CONFLICT (trader, coin) DO UPDATE SET qty = holdings.qty + $3`,
        [trader, coin, qty.toFixed(10)],
      );
      await client.query(
        "INSERT INTO trades (trader, side, coin, qty, price, usd, fee, reason) VALUES ($1, 'buy', $2, $3, $4, $5, $6, $7)",
        [trader, coin, qty.toFixed(10), p, amount, fee, d.reason.slice(0, 300)],
      );
      await client.query("COMMIT");
      return { ok: true, message: `Bought ${fmtUsd(amount)} of ${coin} at ${fmtPrice(p)} (${qty.toPrecision(4)} ${coin}, fee ${fmtUsd(fee)}).` };
    }

    const held = acct.qty[coin] ?? 0;
    const heldValue = held * p;
    if (held <= 0 || heldValue < 0.01) return rollback(client, reject(`You don't hold any ${coin}.`));
    // Asking for (nearly) everything sells the whole position.
    if (d.usd >= heldValue * 0.98) {
      qty = held;
      amount = round2(heldValue);
    } else {
      amount = round2(d.usd);
      if (amount < MIN_ORDER_USD) return rollback(client, reject(`The smallest order is ${fmtUsd(MIN_ORDER_USD)}.`));
      qty = amount / p;
    }
    if (amount > MAX_ORDER_USD && qty !== held) return rollback(client, reject(`The largest order is ${fmtUsd(MAX_ORDER_USD)}.`));
    const fee = round2(amount * FEE_RATE);
    await client.query("UPDATE traders SET cash = cash + $2 WHERE name = $1", [trader, round2(amount - fee)]);
    await client.query("UPDATE holdings SET qty = GREATEST(qty - $3, 0) WHERE trader = $1 AND coin = $2", [trader, coin, qty.toFixed(10)]);
    await client.query("DELETE FROM holdings WHERE trader = $1 AND qty <= 0", [trader]);
    await client.query(
      "INSERT INTO trades (trader, side, coin, qty, price, usd, fee, reason) VALUES ($1, 'sell', $2, $3, $4, $5, $6, $7)",
      [trader, coin, qty.toFixed(10), p, amount, fee, d.reason.slice(0, 300)],
    );
    await client.query("COMMIT");
    return { ok: true, message: `Sold ${fmtUsd(amount)} of ${coin} at ${fmtPrice(p)} (${qty.toPrecision(4)} ${coin}, fee ${fmtUsd(fee)}).` };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rollback(client: pg.PoolClient, result: OrderResult) {
  await client.query("ROLLBACK");
  return result;
}

// ---------- model turn ----------

const TURN_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    action: { type: "string", enum: ["buy", "sell", "hold"] },
    coin: { type: ["string", "null"], enum: [...COINS, null] },
    usd: { type: ["number", "null"] },
    reason: { type: "string" },
  },
  required: ["say", "action", "coin", "usd", "reason"],
  additionalProperties: false,
};

function systemPrompt(p: Persona) {
  return [
    `You are ${p.name}, one of several traders on a paper-trading floor. The money is fake US dollars, but the prices are real.`,
    `Your style: ${p.brief}`,
    "Every turn you post one short message to the other traders and decide on at most one order.",
    "Talk about your own money: what you hold, how you're doing, what you'll do next. Reply to other traders by name when you agree or disagree with them.",
    "Write like a person in a group chat: under 40 words, plain words, no hashtags or emoji.",
    "Only use the numbers you are given. Never invent prices, holdings or news.",
    "Reply with a single JSON object and nothing else.",
  ].join("\n");
}

const lastResult = new Map<string, string>();

async function turnPrompt(p: Persona): Promise<string> {
  const acct = await account(p.name);
  const value = valueOf(acct);
  const priceLines = COINS.map((coin) => {
    const now = latest.get(coin)!;
    const ago15 = priceAgo(coin, 15 * 60_000) ?? now;
    const ago60 = priceAgo(coin, 60 * 60_000) ?? now;
    return `- ${coin} ${fmtPrice(now)}  (15 min: ${pct(((now - ago15) / ago15) * 100)}, 1 hour: ${pct(((now - ago60) / ago60) * 100)})`;
  });
  const holdingLines = Object.entries(acct.qty).map(
    ([coin, q]) => `${q.toPrecision(5)} ${coin} worth ${fmtUsd(q * (latest.get(coin) ?? 0))}`,
  );
  const { rows: messages } = await pool.query<{ trader: string; kind: string; body: string }>(
    "SELECT trader, kind, body FROM floor_messages ORDER BY id DESC LIMIT 14",
  );
  const floor = messages
    .reverse()
    .map((m) => (m.kind === "chat" ? `[${m.trader}] ${m.body}` : `(${m.kind}: ${m.trader}) ${m.body}`));

  return [
    `Prices ${PRICE_SOURCE === "coinbase" ? "live from Coinbase" : "(simulated)"}:`,
    ...priceLines,
    "",
    `Your account: cash ${fmtUsd(acct.cash)}; ${holdingLines.length ? `holdings: ${holdingLines.join(", ")}` : "no coins yet"}.`,
    `Total ${fmtUsd(value)}, ${pct(((value - acct.startUsd) / acct.startUsd) * 100)} since you started with ${fmtUsd(acct.startUsd)}.`,
    lastResult.has(p.name) ? `Your last order: ${lastResult.get(p.name)}` : "",
    "",
    "Recent messages on the floor, oldest first:",
    ...(floor.length ? floor : ["(nobody has said anything yet)"]),
    "",
    `Rules: at most one order per turn. Buy between ${fmtUsd(MIN_ORDER_USD)} and ${fmtUsd(MAX_ORDER_USD)}, and no more than your cash.`,
    `Sell up to the value of a coin you hold. Every trade costs a ${(FEE_RATE * 100).toFixed(1)}% fee. Holding is a valid choice.`,
    `Reply as JSON: {"say": "your message", "action": "buy" | "sell" | "hold", "coin": ${COINS.map((c) => `"${c}"`).join(" | ")} | null, "usd": number | null, "reason": "why, in a few words"}`,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

function normalize(raw: Record<string, unknown>): Decision {
  const action = String(raw.action ?? raw.decision ?? "hold").toLowerCase();
  const amount = raw.usd ?? raw.amount ?? raw.amount_usd ?? null;
  return {
    say: String(raw.say ?? raw.message ?? "").trim().slice(0, 400),
    action: action === "buy" || action === "sell" ? action : "hold",
    coin: raw.coin == null ? null : String(raw.coin).toUpperCase().replace(/-USD$/, ""),
    usd: amount == null || amount === "" ? null : Number(String(amount).replace(/[$,]/g, "")),
    reason: String(raw.reason ?? "").trim(),
  };
}

async function takeTurn(p: Persona) {
  let decision: Decision;
  if (llm.model === "mock") {
    const acct = await account(p.name);
    const values = Object.fromEntries(Object.entries(acct.qty).map(([coin, q]) => [coin, q * (latest.get(coin) ?? 0)]));
    decision = normalize(mockTurn(p.name, COINS, acct.cash, values));
  } else {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(p) },
      { role: "user", content: await turnPrompt(p) },
    ];
    decision = normalize(await chatJson(llm, messages, TURN_SCHEMA));
  }

  if (decision.say) await post(p.name, "chat", decision.say);
  const result = await executeOrder(p.name, decision);
  if (result) {
    lastResult.set(p.name, result.message);
    await post(p.name, result.ok ? "trade" : "rejected", result.message);
  } else {
    lastResult.set(p.name, "You held (no order).");
  }
  console.log(`${p.name}: ${decision.action}${decision.coin ? ` ${decision.coin}` : ""}${decision.usd ? ` ${fmtUsd(decision.usd)}` : ""} | ${decision.say}`);
}

// ---------- main ----------

let running = true;
let slots = CONCURRENCY;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (slots === 0) await new Promise<void>((r) => waiting.push(r));
  else slots--;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else slots++;
  }
}

async function traderLoop(p: Persona, index: number) {
  await sleep(index * 4_000); // stagger the first turns
  let failures = 0;
  while (running) {
    try {
      await withSlot(() => takeTurn(p));
      failures = 0;
    } catch (err) {
      failures++;
      const message = (err as Error).message;
      console.error(`${p.name}: turn failed (${failures} in a row): ${message}`);
      if (failures === 3) await post("system", "system", `${p.name} keeps failing to get a reply from the model: ${message.slice(0, 160)}`);
    }
    // Jitter so the floor doesn't move in lockstep.
    await sleep(TURN_SECONDS * 1000 * (0.75 + Math.random() * 0.5) * Math.min(4, 1 + failures));
  }
}

async function main() {
  await pool.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));

  if (flag("--reset")) {
    await pool.query("TRUNCATE traders, holdings, trades, floor_messages, prices, value_history, market_meta CASCADE");
    console.log("Trading floor reset.");
  }

  try {
    await checkModelServer(llm);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  try {
    await seedHistory();
    await pollPrices();
  } catch (err) {
    console.error(`Couldn't load prices: ${(err as Error).message}`);
    if (PRICE_SOURCE === "coinbase") console.error("To test without Coinbase, run: npm run market -- --simulated");
    process.exit(1);
  }

  const personas = PERSONAS.slice(0, TRADER_COUNT);
  for (const p of personas) {
    await pool.query(
      `INSERT INTO traders (name, persona, model, start_usd, cash) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (name) DO UPDATE SET persona = $2, model = $3`,
      [p.name, p.label, llm.model, START_USD],
    );
  }
  if (!(await meta("start_prices"))) {
    await setMeta("start_prices", JSON.stringify(Object.fromEntries(latest)));
    await setMeta("started_at", new Date().toISOString());
  }
  await setMeta("price_source", PRICE_SOURCE);
  await setMeta("coins", COINS.join(","));
  await setMeta("model", llm.model);

  const opening = `Floor open: ${personas.map((p) => p.name).join(", ")} trading ${COINS.join(", ")} with ${
    PRICE_SOURCE === "coinbase" ? "live Coinbase prices" : "simulated prices"
  }. Model: ${llm.model}.`;
  await post("system", "system", opening);
  console.log(opening);
  console.log("Watch at http://localhost:3000/market (needs `npm run dev`). Ctrl+C to stop.");

  let pricesFailing = false;
  const priceLoop = (async () => {
    while (running) {
      try {
        const ts = await pollPrices();
        await snapshotValues(ts);
        if (pricesFailing) await post("system", "system", "Price feed is back.");
        pricesFailing = false;
      } catch (err) {
        if (!pricesFailing) await post("system", "system", `Price feed problem: ${(err as Error).message}`).catch(() => {});
        pricesFailing = true;
      }
      await sleep(PRICE_SECONDS * 1000);
    }
  })();

  const stop = async () => {
    if (!running) return process.exit(1);
    running = false;
    console.log("\nStopping…");
    await post("system", "system", "Floor closed.").catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await Promise.all([priceLoop, ...personas.map((p, i) => traderLoop(p, i))]);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
