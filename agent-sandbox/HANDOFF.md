# Handoff: Agent Sandbox and local LLM test users

## Goal

Phil wants to simulate real users and traffic on a site. Many browser agents, each driven by a **local** LLM
(no cloud model APIs), act as test users:

- They enter data through a form, and the data is saved to Postgres.
- They use a message board to ask each other questions. Another agent answers if it knows the answer, or
  explains how it would find it out.

The long-term plan is one dedicated machine that runs everything: the site, Postgres, a local model server
(Ollama, LM Studio or vLLM) and all the agents. They have to share one `localhost` so that they see each
other's records and board posts.

This session runs on Phil's own computer, so it can start Docker, run the site and open browsers. The earlier
session ran in a cloud container that Phil couldn't reach from their browser.

## Where things are

- Repo `pctrainor/apps`, branch `claude/beautiful-thompson-32osyk`, folder `agent-sandbox/`.
- The repo root holds an unrelated Vite + Mapbox demo app. Leave it alone.
- Commit and push work to the same branch. Don't open a pull request unless Phil asks.

## Stack

- Next.js 16.4 (App Router), React 19.3, TypeScript 5.9.
  - Read `AGENTS.md`: this Next.js version differs from older training data, and its docs are in
    `node_modules/next/dist/docs/`.
  - `next dev` rewrites `AGENTS.md` and `tsconfig.json`. Commit those changes.
- Postgres 17 (`postgres:17-alpine`) in Docker Compose, on host port **5433**.
  - `db/schema.sql` runs on the first `docker compose up` and on `npm run db:reset`.
- `pg` for queries, through server actions in `lib/actions.ts`. There is no ORM.
- Playwright 1.64 and tsx for the browser CLI.

## Commands

All of these run from `agent-sandbox/`. Docker Desktop must be running.

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres, waits until it is healthy
npm run dev          # http://localhost:3000
npm run typecheck
npm run build
npm run db:reset     # empty all tables
npm run db:psql      # SQL shell
npx playwright install chromium            # once, for the browser CLI
npm run -s browse -- user1 open localhost:3000
```

## Files

| Path | What it does |
|---|---|
| `app/layout.tsx` | Header nav and "Signed in as …" |
| `app/page.tsx` | Sign-in by agent name (cookie `agent`) and per-agent stats |
| `app/intake/page.tsx`, `app/intake/IntakeForm.tsx` | Customer intake form (client component, `useActionState`) |
| `app/records/page.tsx` | Table of saved records, with an "All / Mine" filter |
| `app/board/page.tsx` | Ask a question, and list questions (filters: all, unanswered, open, resolved) |
| `app/board/[id]/page.tsx` | One question, its replies, the reply form, and "Mark as resolved" (author only) |
| `app/reference/page.tsx` | Region codes, plan rules, roles and interests, FAQ |
| `app/activity/page.tsx` | Live log: per-agent summary and the last 100 events, refreshed every 3 s |
| `app/api/health/route.ts` | `GET /api/health` checks the database connection |
| `lib/actions.ts` | All server actions: sign in and out, intake validation and insert, ask, reply, resolve |
| `lib/reference.ts` | Regions, plans, roles and interests. One source for the reference page and validation |
| `lib/db.ts` | `pg` pool and `logEvent()` |
| `db/schema.sql` | Tables: `submissions`, `questions`, `answers` (`kind` is `answer` or `approach`), `events` |
| `scripts/browse.ts` | Browser CLI for agents (see below) |
| `scripts/db.ts` | `db:reset` |
| `scripts/market.ts`, `scripts/llm.ts` | Trading floor runner and model client (see "Trading floor") |
| `scripts/market/feeds.ts`, `scripts/market/memory.ts` | CoinGecko, news, search and page reading; trader memory |
| `scripts/consensus.ts`, `.claude/skills/floor-lead/` | Floor digest and consensus posting; the floor-lead skill |
| `app/market/` | Trading floor dashboard |
| `lib/market.ts` | Trader personas, fee, number formatting |

## Deliberate friction (don't "fix" it)

The intake form is meant to make agents stuck sometimes, so that they have real questions for the board.

- The form uses `noValidate`. The server returns errors that show up as page text, which agents can read.
  Native browser validation bubbles would be invisible to them.
- The region code must be a code from the Reference page. The error message doesn't list the valid codes.
- Plan rules:
  - Starter: team size 1–10.
  - Team: team size 2–250.
  - Enterprise: team size 50 or more, and the Security interest must be selected.
  - The error message only says to check the Reference page.
- The start date can't be in the past. The consent checkbox is required.
- The Reference page doesn't say which region covers the UK, Germany or Mexico. That gap is on purpose, so
  agents have to reason out an answer or explain how they would find out.

Every rejected submit is logged as `intake_rejected` with the fields that failed. Saved records, questions,
replies and resolutions are logged too.

## Browser CLI (`scripts/browse.ts`)

```
npm run -s browse -- <agent> <command> [args]
commands: open <url> | look | click <n> | type <n> <text> | select <n> <option> | check <n> | uncheck <n>
          press <key> | back | screenshot [file] | close | stop
```

- The first call starts a background server on `127.0.0.1:3999` (`BROWSE_PORT`). The server keeps one
  Chromium running, with a separate browser context per agent name, so each agent has its own cookies and
  login. Server logs go to `.browse.log`.
- Every command prints the result page: the URL, the visible text (up to 5,000 characters) and a numbered
  list of interactive elements.
  - Numbering works by adding `data-agent-id` attributes, and the numbers change on every look.
  - Example line: `[7] input:text "Agent name" value=""`
- Waiting for the page to finish: Playwright's `networkidle` returns at once when no new document loads,
  which is the case for server actions and client-side navigation. So `settle()` counts in-flight
  requests itself and waits for 500 ms of quiet.
- tsx compiles named functions with an `__name()` helper, so `observe()` runs in the page as a string with
  a stub for that helper.
- `HEADLESS=false` in `.env` shows the Chrome windows. `BROWSER_EXECUTABLE` overrides the browser binary.
  There is also a fallback path, `/opt/pw-browsers/chromium`, that only exists in Claude cloud containers.
- `stop` closes every context, so all agents lose their sign-in.

## Status

Verified on Phil's Mac (M4, 24 GB, macOS 26) on 2026-10-10:

- `npm run typecheck` and `npm run build` pass.
- Postgres starts, and `db:reset` works.
- Full smoke test with the browser CLI as `user1` and `user2`:
  - Intake rejected path: all errors show, and text fields, the Role dropdown, the plan radio and the
    interest checkboxes keep their values.
  - Intake success path: "Saved record #1" banner, and the form clears.
  - Board: ask, reply with both kinds, resolve (author only), and the All, Unanswered, Open and Resolved
    filters.
  - Records with "My records", and Activity with the per-agent summary and events.
- `npx playwright install chromium` works on macOS (headless). `HEADLESS=false` hasn't been tried.
- macOS gotcha: Docker Desktop's CLI may not be on PATH. Use
  `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`.

### Simulation runner (`scripts/simulate.ts`): built, partly verified

- The browser core moved to `scripts/browser.ts` (`createAgents()` returns `run`, `lookAt` and `close`).
  `browse.ts` is now just the CLI and server on top of it. With `allowedOrigin`, `open` refuses other
  origins, accepts paths like `/board`, and undoes any action that lands off-site.
  `BROWSE_ALLOWED_ORIGIN` sets that for the CLI too.
- `npm run simulate -- -n 3 -k 2 [-s 60] [-c 3] [-m qwen2.5:7b-instruct]`. Env: `SITE_URL`, `LLM_BASE_URL`,
  `LLM_MODEL`, `LLM_API_KEY`, `CONCURRENCY`, `PAUSE_MS` ("min-max"), `LLM_TIMEOUT_MS` (default 180 s).
- Each agent gets a persona (role plus quirk) and generated customer cards. Card countries include the UK,
  Germany and Mexico, and about 30% of cards ask for a plan that breaks the rules, so agents hit the
  deliberate friction.
- The runner tracks progress from the page: "Saved record #N", "Post question" landing on /board/N,
  "Your reply was posted.", and "Mark as resolved". It refuses `done` until K records are saved and the
  board has been checked, and it nudges agents to check the board if they haven't for 12 steps.
- Logs go to `runs/<time>/`: `trajectories.jsonl` (one line per step: obs hash, raw reply, action,
  result, prompt_tokens), `observations.jsonl` (each distinct page once, by hash), `config.json` and
  `summary.json`.
- Verified: a 2-agent run with `qwen2.5:7b-instruct` got through 29 steps. Both agents signed in, filled
  the intake form, recovered from tool errors (typing into a select, unchecking a radio) and got realistic
  rejections (region "SG").
- Not verified: a full run to the end, because Ollama on the Mac wedged mid-run. Requests hung even after
  `brew services restart ollama`, and then ran at about 5 tokens/s on the 7B and 38 tokens/s on the 1.5B,
  with the Mac on battery. That's why the LLM request timeout exists. Retry on mains power, or after a
  reboot.
- Ollama runs with a 4096-token context today. Prompts were about 850 to 1,500 tokens, but board pages will
  grow. Set `OLLAMA_CONTEXT_LENGTH=16384` and `OLLAMA_NUM_PARALLEL` to the concurrency, then restart Ollama.

## Next steps

1. Finish a full simulation run (`npm run db:reset && npm run simulate -- -n 2 -k 1`), read
   `summary.json` and the trajectories, and tune the prompt or nudges where agents loop.
2. Agents that finish early stop answering questions. Consider letting them linger on the board until all
   agents are done.
3. **Later ideas:**
   - A "scenario" setting (number of agents, records per agent, how chatty they are).
   - Edit and delete for records.
   - Run several simulations side by side and compare them.
   - Let the runner use a separate planner model.

## Trading floor

**What Phil wants.**
- Local-model traders hold paper money and trade at real prices (CoinGecko, no Coinbase).
- They talk to each other about their money.
- They have long-term memory, and they research coins on the internet in real time.
- They act on what they learn.
- A higher-level model sets a group consensus. For now a Claude session plays that role through the
  `floor-lead` skill.
- Phil chose not to connect Coinbase.

**Runner** (`npm run market`, `scripts/market.ts`):
- **Prices:** CoinGecko `/coins/markets` every `PRICE_SECONDS` (60) gives price, 1h/24h/7d change and market
  cap. `/coins/{id}/market_chart?days=1` seeds the last 24 hours on start.
  - The client is in `scripts/market/feeds.ts`. It counts calls per month in `market_meta`, because the free
    Demo plan has a monthly budget.
  - `COINGECKO_API_KEY` sends the Demo key header.
- **Market brief:** shared by all traders, refreshed every `BRIEF_MINUTES` (10) and stored in
  `market_meta.brief`. It holds the Fear & Greed index (alternative.me), CoinGecko trending, and headlines from
  CoinDesk, Cointelegraph and Decrypt RSS (`NEWS_FEEDS`).
- **Research:** a trader asks for one lookup per turn in its JSON (`research: {tool, input}`). Tools: `news`,
  `search` (DuckDuckGo HTML, or SearXNG with `SEARXNG_URL`), `read` (fetches a public page as text and refuses
  private and localhost hosts), `coin`, `trending` and `sentiment`.
  - Results go to `research_log` and appear in that trader's next prompt.
  - An identical lookup from the last 10 minutes is reused.
- **Memory** (`scripts/market/memory.ts`, table `trader_memories`):
  - Each turn, a trader can save one `remember` note. Duplicates are skipped.
  - Every `REFLECT_EVERY` (8) turns, a reflection call rewrites the long-term memory (under 120 words) from the
    notes and how the trader's recent trades turned out, and adds up to 2 new lessons.
  - Each prompt shows the latest reflection, up to 6 lessons and the notes since the last reflection.
  - Memories survive `--reset`. Only `--forget` erases them.
- **Consensus:** the latest row in `consensus` goes into every trader's prompt (up to 900 characters). Traders are
  told it's advice and that they decide in their own style.
- **Orders:** `executeOrder()` runs in one transaction, with `SELECT … FOR UPDATE` on the trader row.
  - Allowed coins only; $10 to `MAX_ORDER_USD`; no more than the trader's cash or holding.
  - A sell of 98% or more sells the whole position.
  - At most `MAX_TRADES_PER_HOUR`, and a 0.6% fee.
- **Single runner:** a heartbeat in `market_meta` stops a second `npm run market` from starting. Two runners
  garble the floor: two price sources and a zigzag chart.
- **Model client** (`scripts/llm.ts`):
  - Uses `response_format` json_schema, with `anyOf` for the nullable fields.
  - Falls back to json_object, then none, when the server returns a 400.
  - Parses leniently (`<think>` blocks and code fences) and supports `LLM_API_KEY`.
  - `--mock` uses a scripted stand-in.

**Floor lead** (`scripts/consensus.ts` and `.claude/skills/floor-lead/SKILL.md`):
- `npm run -s consensus -- digest` prints Markdown:
  - prices and the brief
  - positioning for the whole floor and the benchmark
  - per trader: holdings, recent trades with the price move since, the last 3 messages, long-term memory and
    research
  - rejected orders and the previous consensus
- `post --file f [--author name]` saves a consensus (20 to 2,500 characters) and posts it to the floor.
- `auto` lets `CONSENSUS_MODEL` write one, using the skill file as its guide.
- The skill has Claude read the digest, optionally search the news, and post under 220 words: outlook, a lean per
  coin, the floor's risks by name, one settled disagreement, what to watch, and a cash range.
- `/loop 30m /floor-lead` keeps it going.

**Dashboard** (`app/market/page.tsx`, chart in `ValueChart.tsx`, refreshed every 2 s):
- price tiles (24h change and a 24h sparkline)
- the group consensus panel
- leaderboard with the benchmark row, and portfolio value over time
- "Memory and research" per trader, collapsible
- latest trades
- the market brief, and the floor feed (chat, trades, rejections, research, memory, consensus)
- CoinGecko attribution and the month's call count

**Status:**
- Tested in the cloud container. Its network blocks CoinGecko, news, search and Ollama.
  - `--simulated --mock`: traders chat and trade, notes, reflections and lessons are saved, research requests
    are logged (marked offline), the digest and post work, and the dashboard renders.
  - Against a fake OpenAI-compatible server: the json_schema request is sent, a reply wrapped in a code fence
    or `<think>` block parses, and the prompt includes the consensus, memory, research and order feedback.
    That run is also how the duplicate-lesson bug was found and fixed.
  - Cash and holdings reconcile with the trade log, and the single-runner guard works.
- **Not tested yet:**
  - CoinGecko, RSS, DuckDuckGo, alternative.me and page reading against the real internet.
  - Whether CoinGecko needs a Demo key now.
  - Ollama accepting the schema.
  - How long turns take on the M4.
- The prompt is about 2,000 to 2,800 tokens. Ollama's default 4,096 context fits it, but set
  `OLLAMA_CONTEXT_LENGTH=16384` to be safe.

**Next steps:**
1. On the Mac: `npm run market -- --forget`, watch `/market`, then `/floor-lead` a few times.
2. Check each feed. If one fails, the brief shows "Couldn't load: …" and research results say "Research failed".
3. Tune the prompts after reading real turns: do traders use their memory, research before big trades, and respond
   to the consensus?
4. Pause and resume from the dashboard, and a "new round" button.
5. Later: semantic memory recall (embeddings via Ollama), and a bigger local model as `CONSENSUS_MODEL`.

## Background

An earlier session built a "Local Browser Swarm" v0.1 (TypeScript, a planner plus parallel Playwright
agents against Ollama). Its code only exists as a zip on Phil's machine and isn't in this repo. Phil said to
set it aside. If Phil shares it, its agent loop (`server/agent.ts`) and tolerant JSON parsing (`server/llm.ts`)
could replace step 3's runner.
