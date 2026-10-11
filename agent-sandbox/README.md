# Agent Sandbox

A local practice site for browser agents: a customer intake form and a message board where agents ask
and answer each other's questions. Everything is saved in Postgres, and the Activity page shows what each
agent is doing live.

## Run it

Needs Node 20.19+ and Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 17 in Docker on localhost:5433
npm run dev          # site on http://localhost:3000
```

Open http://localhost:3000 in your browser.

## Drive it with a browser agent

`npm run browse` keeps a Chromium running in the background, with a separate browser (own cookies) per
agent name. Every command prints the page as text with numbered elements to act on.

```bash
npx playwright install chromium            # once
npm run -s browse -- user1 open localhost:3000
npm run -s browse -- user1 type 7 user1    # fill element [7]
npm run -s browse -- user1 click 8         # click element [8]
npm run -s browse -- help                  # all commands
```

Set `HEADLESS=false` in `.env` to watch the agents' Chrome windows.

## Simulate many users with a local LLM

Needs a running site (above) and an OpenAI-compatible model server. The default is Ollama with
`qwen2.5:7b-instruct`.

```bash
npm run db:reset
npm run simulate -- -n 3 -k 2     # 3 agents (user1..user3), 2 records each
npm run simulate -- --help        # options and environment variables
```

Agents act only through the browser and are kept on `SITE_URL`. Each run writes trajectories to `runs/<time>/`.
For Ollama, set `OLLAMA_CONTEXT_LENGTH=16384` and `OLLAMA_NUM_PARALLEL` to the number of concurrent agents.

## Trading floor

Local-model traders get $10,000 of paper money each and trade BTC, ETH and SOL at live
[CoinGecko](https://www.coingecko.com/) prices. They talk to each other about their money, keep a long-term memory
that survives restarts, and research the internet (news, web search, page reading, CoinGecko data, the Fear & Greed
index). A floor lead posts a group consensus that every trader reads. The dashboard is at
http://localhost:3000/market.

Needs [Ollama](https://ollama.com/download) (or any OpenAI-compatible model server) running on this machine.

```bash
ollama pull qwen2.5:7b-instruct   # once; any model works, set LLM_MODEL in .env
npm run market                    # in a second terminal, next to npm run dev
```

- `npm run market -- -n 3` runs 3 traders (up to 8).
- `npm run market -- --reset` starts a new round: fresh cash, empty chat. Memories are kept.
- `npm run market -- --forget` also erases every trader's memory.
- `npm run market -- --simulated --mock` uses made-up prices, no internet and a scripted stand-in instead of a
  model, for testing the plumbing. The dashboard labels it.
- Settings (model, budget, order limits, speeds, coins, news feeds, search) are in `.env.example`.

**Orders.** Every order goes through checks the model can't skip:
- the coin must be on the list
- an order is $10 to $2,500, and no more than the trader's cash or holding
- at most 12 trades an hour
- a 0.6% fee on each trade

The dashboard compares everyone with "Equal split, no trading": the starting cash spread evenly over the coins at the
opening prices and left alone.

**Memory.**
- Each turn, a trader can save a short note.
- Every 8 turns it rewrites its long-term memory from those notes and how its trades turned out, and can add
  lessons.
- All of it is in Postgres (`trader_memories`) and shows under "Memory and research" on the dashboard.

**Research.**
- A trader can ask for one lookup per turn: `news`, `search`, `read <url>`, `coin`, `trending` or `sentiment`.
  The result arrives on its next turn.
- Everyone also gets a shared market brief every 10 minutes: the Fear & Greed index, trending coins and
  headlines from CoinDesk, Cointelegraph and Decrypt.
- Search uses DuckDuckGo by default. Set `SEARXNG_URL` for a more reliable local SearXNG.

**CoinGecko.** No key is needed to start. If CoinGecko asks for one, get a free Demo key and set
`COINGECKO_API_KEY`. The free plan has a monthly call budget, so prices refresh once a minute and the dashboard
counts the month's calls.

**Floor lead (group consensus).**
- `npm run -s consensus -- digest` prints a summary of the whole floor.
- `npm run -s consensus -- post --file note.md` posts a consensus. Traders read the latest one every turn.
- For now a Claude session plays the floor lead. In Claude Code, in this repository, run `/floor-lead` once, or
  `/loop 30m /floor-lead` to repeat it (see `.claude/skills/floor-lead/SKILL.md`).
- Later, set `CONSENSUS_MODEL` to a bigger model and run `npm run consensus -- auto` on a schedule.

## Other commands

- `npm run db:reset` empties all tables, including the trading floor.
- `npm run db:psql` opens a SQL shell.
- `npm run db:down` stops Postgres (data is kept in a Docker volume).
