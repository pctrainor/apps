// Everything the trading floor reads from the internet: CoinGecko market data, the Fear & Greed index,
// crypto news RSS feeds, web search and plain-text page reading. No API keys are required.

import type pg from "pg";

const UA = "agent-sandbox/0.2 (paper-trading research bot)";
const TEXT_LIMIT = 1500; // characters of research text handed to a trader

// ---------- coins ----------

// Common symbols mapped to CoinGecko ids. MARKET_COINS can also use "SYMBOL:coingecko-id" for others.
const KNOWN_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin", XRP: "ripple", ADA: "cardano",
  AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot", LTC: "litecoin", BNB: "binancecoin", SUI: "sui",
};

export type Coin = { symbol: string; id: string };

export function parseCoins(spec: string): Coin[] {
  return spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [sym, id] = part.split(":");
      const symbol = sym.toUpperCase();
      const geckoId = id ?? KNOWN_IDS[symbol];
      if (!geckoId) throw new Error(`Unknown coin "${symbol}". Use SYMBOL:coingecko-id in MARKET_COINS, e.g. PEPE:pepe.`);
      return { symbol, id: geckoId };
    });
}

// ---------- CoinGecko ----------

export type MarketRow = {
  price: number;
  ch1h: number | null;
  ch24h: number | null;
  ch7d: number | null;
  marketCap: number | null;
  volume24h: number | null;
};

export class CoinGecko {
  private base: string;
  private headers: Record<string, string>;

  constructor(private pool: pg.Pool) {
    const key = process.env.COINGECKO_API_KEY;
    const pro = process.env.COINGECKO_PRO === "true";
    this.base = pro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    this.headers = { Accept: "application/json", "User-Agent": UA };
    if (key) this.headers[pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;
  }

  private async get<T>(path: string): Promise<T> {
    // Count calls per month: the free Demo plan has a monthly budget.
    const month = new Date().toISOString().slice(0, 7);
    await this.pool.query(
      `INSERT INTO market_meta (key, value) VALUES ($1, '1')
       ON CONFLICT (key) DO UPDATE SET value = (market_meta.value::int + 1)::text`,
      [`coingecko_calls:${month}`],
    );
    const res = await fetch(`${this.base}${path}`, { headers: this.headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) throw new Error("CoinGecko rate limit hit (429). Slow down PRICE_SECONDS or add a free COINGECKO_API_KEY.");
    if (res.status === 401 || res.status === 403) {
      throw new Error(`CoinGecko refused the request (${res.status}). Get a free Demo key at coingecko.com/en/api and set COINGECKO_API_KEY.`);
    }
    if (!res.ok) throw new Error(`CoinGecko ${path.split("?")[0]} returned ${res.status}`);
    return (await res.json()) as T;
  }

  /** Price, 1h/24h/7d change, market cap and volume for every coin, in one call. */
  async markets(coins: Coin[]): Promise<Record<string, MarketRow>> {
    type Row = {
      id: string; current_price: number; market_cap: number | null; total_volume: number | null;
      price_change_percentage_1h_in_currency?: number | null;
      price_change_percentage_24h_in_currency?: number | null;
      price_change_percentage_7d_in_currency?: number | null;
    };
    const ids = coins.map((c) => c.id).join(",");
    const rows = await this.get<Row[]>(`/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=1h,24h,7d`);
    const out: Record<string, MarketRow> = {};
    for (const coin of coins) {
      const r = rows.find((row) => row.id === coin.id);
      if (!r || !(r.current_price > 0)) continue;
      out[coin.symbol] = {
        price: r.current_price,
        ch1h: r.price_change_percentage_1h_in_currency ?? null,
        ch24h: r.price_change_percentage_24h_in_currency ?? null,
        ch7d: r.price_change_percentage_7d_in_currency ?? null,
        marketCap: r.market_cap,
        volume24h: r.total_volume,
      };
    }
    return out;
  }

  /** The last 24 hours of prices (about every 5 minutes), oldest first. */
  async history(coin: Coin): Promise<{ t: number; p: number }[]> {
    const body = await this.get<{ prices?: [number, number][] }>(`/coins/${coin.id}/market_chart?vs_currency=usd&days=1`);
    return (body.prices ?? []).map(([t, p]) => ({ t, p }));
  }

  async trending(): Promise<{ symbol: string; name: string; rank: number | null; change24h: number | null }[]> {
    type Item = { item: { symbol: string; name: string; market_cap_rank: number | null; data?: { price_change_percentage_24h?: { usd?: number } } } };
    const body = await this.get<{ coins?: Item[] }>("/search/trending");
    return (body.coins ?? []).slice(0, 10).map(({ item }) => ({
      symbol: item.symbol.toUpperCase(),
      name: item.name,
      rank: item.market_cap_rank,
      change24h: item.data?.price_change_percentage_24h?.usd ?? null,
    }));
  }

  async monthCalls(): Promise<number> {
    const month = new Date().toISOString().slice(0, 7);
    const { rows } = await this.pool.query<{ value: string }>("SELECT value FROM market_meta WHERE key = $1", [`coingecko_calls:${month}`]);
    return Number(rows[0]?.value ?? 0);
  }
}

// ---------- Fear & Greed (alternative.me) ----------

export async function fearGreed(): Promise<{ value: number; label: string; history: number[] }> {
  const res = await fetch("https://api.alternative.me/fng/?limit=7", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Fear & Greed index returned ${res.status}`);
  const body = (await res.json()) as { data?: { value: string; value_classification: string }[] };
  const data = body.data ?? [];
  if (data.length === 0) throw new Error("Fear & Greed index sent no data");
  return { value: Number(data[0].value), label: data[0].value_classification, history: data.map((d) => Number(d.value)) };
}

// ---------- news (RSS) ----------

const DEFAULT_FEEDS = [
  "CoinDesk|https://www.coindesk.com/arc/outboundfeeds/rss/",
  "Cointelegraph|https://cointelegraph.com/rss",
  "Decrypt|https://decrypt.co/feed",
];

export type Headline = { source: string; title: string; link: string; published: number; summary: string };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

async function readFeed(source: string, url: string): Promise<Headline[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${source} feed returned ${res.status}`);
  const xml = await res.text();
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  const field = (item: string, tag: string) => item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
  return items.slice(0, 30).map((item) => ({
    source,
    title: decode(field(item, "title")),
    link: decode(field(item, "link")),
    published: Date.parse(decode(field(item, "pubDate"))) || 0,
    summary: decode(field(item, "description")).slice(0, 240),
  }));
}

/** Latest headlines across the feeds, newest first, optionally filtered by words in the query. */
export async function news(query = ""): Promise<Headline[]> {
  const feeds = (process.env.NEWS_FEEDS?.split(",") ?? DEFAULT_FEEDS).map((f) => {
    const [name, url] = f.includes("|") ? f.split("|") : [new URL(f).hostname, f];
    return { name: name.trim(), url: url.trim() };
  });
  const results = await Promise.allSettled(feeds.map((f) => readFeed(f.name, f.url)));
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (all.length === 0) throw new Error("No news feed could be read");
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const matches = words.length
    ? all.filter((h) => words.some((w) => `${h.title} ${h.summary}`.toLowerCase().includes(w)))
    : all;
  return matches.sort((a, b) => b.published - a.published);
}

// ---------- web search ----------

export type SearchHit = { title: string; url: string; snippet: string };

/** SearXNG when SEARXNG_URL is set, otherwise DuckDuckGo's HTML results page. */
export async function webSearch(query: string): Promise<SearchHit[]> {
  const searx = process.env.SEARXNG_URL;
  if (searx) {
    const res = await fetch(`${searx.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json`, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`SearXNG returned ${res.status}`);
    const body = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
    return (body.results ?? []).slice(0, 6).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
  }
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", Accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);
  for (const block of blocks) {
    const a = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, "&");
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    hits.push({ title: decode(a[2]), url, snippet: decode(snippet) });
    if (hits.length === 6) break;
  }
  if (hits.length === 0) throw new Error("Search returned no results (DuckDuckGo may be blocking automated searches; set SEARXNG_URL)");
  return hits;
}

// ---------- read a page ----------

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "::1") return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Fetches a public web page and returns its readable text. */
export async function readPage(rawUrl: string): Promise<{ title: string; text: string }> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error(`"${rawUrl}" isn't a valid URL`);
  }
  if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) throw new Error("Only public http(s) pages can be read");
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", Accept: "text/html, text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The page returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|xml|json/.test(type)) throw new Error(`Can't read ${type || "that kind of"} content`);
  const raw = (await res.text()).slice(0, 2_000_000);
  const title = decode(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = raw
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr|section|article)>/gi, "\n");
  const text = decode(body.replace(/\n/g, " ¶ ")).replace(/( ¶ )+/g, "\n").trim();
  return { title, text };
}

// ---------- research tools for traders ----------

export const RESEARCH_TOOLS = ["news", "search", "read", "coin", "trending", "sentiment"] as const;
export type ResearchTool = (typeof RESEARCH_TOOLS)[number];

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

const clip = (s: string) => (s.length > TEXT_LIMIT ? `${s.slice(0, TEXT_LIMIT)}…` : s);

/** Runs one research request and returns plain text for the trader's next turn. */
export async function research(tool: ResearchTool, input: string, gecko: CoinGecko, coins: Coin[]): Promise<string> {
  switch (tool) {
    case "news": {
      const items = (await news(input)).slice(0, 6);
      if (items.length === 0) return `No recent headlines mention "${input}".`;
      return clip(items.map((h) => `- [${h.source}, ${ago(h.published)}] ${h.title}. ${h.summary} (${h.link})`).join("\n"));
    }
    case "search": {
      if (!input) throw new Error("search needs a query");
      const hits = await webSearch(input);
      return clip(hits.map((h) => `- ${h.title}: ${h.snippet} (${h.url})`).join("\n"));
    }
    case "read": {
      const page = await readPage(input);
      return clip(`${page.title}\n${page.text}`);
    }
    case "coin": {
      const symbol = input.toUpperCase().replace(/[^A-Z0-9:-]/g, "");
      const coin = coins.find((c) => c.symbol === symbol) ?? parseCoins(symbol)[0];
      const row = (await gecko.markets([coin]))[coin.symbol];
      if (!row) return `CoinGecko has no market data for ${symbol}.`;
      const pct = (n: number | null) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
      return `${coin.symbol}: $${row.price} | 1h ${pct(row.ch1h)} | 24h ${pct(row.ch24h)} | 7d ${pct(row.ch7d)} | market cap $${(
        (row.marketCap ?? 0) / 1e9
      ).toFixed(1)}B | 24h volume $${((row.volume24h ?? 0) / 1e9).toFixed(2)}B`;
    }
    case "trending": {
      const list = await gecko.trending();
      return list.map((c) => `- ${c.symbol} (${c.name}), rank ${c.rank ?? "?"}, 24h ${c.change24h?.toFixed(1) ?? "?"}%`).join("\n");
    }
    case "sentiment": {
      const fg = await fearGreed();
      return `Fear & Greed index: ${fg.value} (${fg.label}). Last 7 days, newest first: ${fg.history.join(", ")}.`;
    }
  }
}
