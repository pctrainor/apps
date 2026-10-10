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

## Background

An earlier session built a "Local Browser Swarm" v0.1 (TypeScript, a planner plus parallel Playwright
agents against Ollama). Its code only exists as a zip on Phil's machine and isn't in this repo. Phil said to
set it aside. If Phil shares it, its agent loop (`server/agent.ts`) and tolerant JSON parsing (`server/llm.ts`)
could replace step 3's runner.
