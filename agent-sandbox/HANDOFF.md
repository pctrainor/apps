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

Verified in the cloud container:

- `next build` and `tsc` pass.
- Postgres starts with all four tables, and `db:reset` works.
- The browser CLI opens the site, and sign-in sets the cookie.

**Not verified yet:**

- Intake form, rejected path: errors show, and the entered values come back after the submit.
  - The form remounts with `key={state.attempt}` and uses `defaultValue`/`defaultChecked`.
  - Check that the select, radio buttons and checkboxes really get their values back.
- Intake form, success path: the "Saved record #N" banner.
- Board: ask, reply (both kinds), resolve, and the filters.
- The Activity page and the "Mine" filter on Records.
- On macOS: `npx playwright install chromium` and `HEADLESS=false`.

## Next steps

1. **Run it and smoke-test it.** Start the database and the dev server. Then, with the browser CLI, play
   `user1` and `user2`:
   - Submit an invalid record, then a valid one.
   - Have `user1` post a question, have `user2` reply with each kind, and have `user1` mark it resolved.
   - Check that Records and Activity show all of it.
   - Fix what breaks, then run `npm run typecheck` and `npm run build`, and commit.
2. **Ask Phil about the model machine**: OS, and GPU with VRAM (or Mac and its memory). That decides the
   model size, how many agents run at once, and the context length.
3. **Build the simulation runner** (`scripts/simulate.ts`, `npm run simulate -- -n 5`):
   - **Model:** any OpenAI-compatible `/v1/chat/completions` endpoint. Default to Ollama at
     `http://localhost:11434/v1`, set with `LLM_BASE_URL` and `LLM_MODEL`.
     - The CLI describes pages as text, so a text-only instruct model is enough (for example an
       8B-class Qwen3). No vision model is needed.
     - Context of 16k or more. In Ollama, set `OLLAMA_CONTEXT_LENGTH`, and `OLLAMA_NUM_PARALLEL` equal to
       the number of agents that run at once.
   - **Reuse the browser code:** refactor `browse.ts` so `run()` and `look()` can be imported, and drive
     the agents in-process instead of starting a CLI process per step.
   - **Each agent:**
     - Gets a persona (`user1` … `userN`, a role and some quirks) and a goal: sign in, save K fictional
       records, post a question when stuck, and regularly check the board's Unanswered filter to reply.
       It answers when it knows, and otherwise explains how it would find out.
   - **Each step:**
     - The model sees the system prompt, the current `look` output and the last ~15 history lines.
     - It replies with one JSON action (`open`, `click`, `type`, `select`, `check`, `uncheck`, `press`,
       `back` or `done`).
     - Request JSON output (`response_format`, or Ollama's `format`). Parse leniently: strip `<think>`
       blocks and code fences.
     - Give up after 3 invalid replies in a row, and nudge the model when it repeats an action.
   - **Limits:** run the agents concurrently, capped by `CONCURRENCY`. Stagger their starts and add random
     pauses between actions so the traffic looks human.
   - **Logs:** write each trajectory to JSONL (step, observation hash, action, result). This also builds a
     dataset for fine-tuning later.
   - **Browser only:** agents act only through the browser, never through curl, the API or psql. That's the
     point of the simulation.
   - **Stay on the site:** restrict `open` to `http://localhost:3000` while simulating. Today the CLI
     accepts any URL.
4. **Later ideas:**
   - A "scenario" setting (number of agents, records per agent, how chatty they are).
   - Edit and delete for records.
   - Run several simulations side by side and compare them.
   - Let the runner use a separate planner model.

## Background

An earlier session built a "Local Browser Swarm" v0.1 (TypeScript, a planner plus parallel Playwright
agents against Ollama). Its code only exists as a zip on Phil's machine and isn't in this repo. Phil said to
set it aside. If Phil shares it, its agent loop (`server/agent.ts`) and tolerant JSON parsing (`server/llm.ts`)
could replace step 3's runner.
