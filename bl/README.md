# bl — Browserless use-case demos

Eleven runnable demos of the [Browserless](https://www.browserless.io) API in plain Node.js.
No TypeScript, no build step, no runtime dependencies — just `fetch` and the standard library.

## Setup

```bash
cd ~/bl
node index.js doctor
```

Then paste your token into `.env`:

```
BROWSERLESS_TOKEN=your-token-here
```

Re-run `node index.js doctor`. It checks the token, the region, and that a real browser
renders — so you find problems there instead of halfway through a demo.

Requires Node 18+ (uses built-in `fetch`). Nothing to `npm install` unless you want the
`puppeteer` demo, which needs `npm i puppeteer-core`.

## Run

```bash
node index.js
node index.js screenshot
node index.js screenshot https://stripe.com
node index.js scrape https://news.ycombinator.com --selector ".titleline > a"
node index.js all
```

Everything lands in `output/`. After `all`, open `output/report.html` for a gallery of the
screenshots, PDFs and JSON side by side:

```bash
open output/report.html
```

npm scripts mirror the commands: `npm run doctor`, `npm run screenshot`, `npm run all`, …

## What each demo shows

| Demo | Endpoint | What it proves | Output |
| --- | --- | --- | --- |
| `screenshot` | `POST /screenshot` | Full-page 2x PNG + a 1200x630 JPEG hero, with cookie banners hidden via `addStyleTag` | `screenshot-full.png`, `screenshot-hero.jpg` |
| `pdf` | `POST /pdf` | A URL printed to A4 with running headers/footers, **and** raw HTML rendered into a styled invoice | `page.pdf`, `invoice.pdf` |
| `content` | `POST /content` | Runs a plain `fetch()` against the same URL first, then counts the elements only the browser can see | `content-rendered.html` |
| `scrape` | `POST /scrape` | CSS selectors in, structured JSON out — no parser to maintain | `scrape.json` |
| `function` | `POST /function` | Ships a Puppeteer script to Browserless and gets an SEO/accessibility audit back as JSON | `function-audit.json` |
| `bql` | `POST /chromium/bql` | The whole session — navigate, read, screenshot — as one GraphQL mutation | `bql-screenshot.png`, `bql-result.json` |
| `unblock` | `POST /unblock` | Stealth fetch returning HTML, session cookies and a screenshot in one call | `unblock-*.{html,png,json}` |
| `performance` | `POST /performance` | Lighthouse scores + Core Web Vitals | `lighthouse.json` |
| `puppeteer` | `wss://` connect | Real session control: clicks through three pages of a pager and collects results | `puppeteer-*.{png,json}` |
| `replay` | `wss://?replay=true` | Records the session; watch it back in the dashboard under Session Replay | `replay-*.{png,json}` |
| `profile` | `POST /profile` + `wss://?profile=<name>` | Creates a profile, saves state into it, reuses it in a new browser, with a no-profile control | `profile-result.json` |

`replay` and `profile` both need `npm i puppeteer-core`.

The two worth reading first are **`content`** (it prints the raw-HTML vs rendered-DOM gap, which
is the entire argument for a browser API) and **`pdf`** (HTML + CSS instead of a PDF library).

## Configuration

All optional except the token — set in `.env`:

| Variable | Default | Notes |
| --- | --- | --- |
| `BROWSERLESS_TOKEN` | — | From [account.browserless.io](https://account.browserless.io) |
| `BROWSERLESS_BASE_URL` | `https://production-sfo.browserless.io` | Also `production-lon`, `production-ams` — pick the closest |
| `BROWSERLESS_BQL_PATH` | `/chromium/bql` | Some accounts use `/chrome/bql` |
| `DEMO_URL` | `https://news.ycombinator.com` | Default target when you don't pass a URL |
| `BROWSERLESS_TIMEOUT_MS` | `60000` | The `performance` demo triples this |

Environment variables win over `.env`, so this works for one-off runs:

```bash
BROWSERLESS_BASE_URL=https://production-lon.browserless.io node index.js screenshot
```

## Layout

```
index.js              CLI: arg parsing, single runs, `all`, help
src/config.js         .env loading (auto-created on first run) + settings
src/client.js         one POST helper, BrowserQL helper, actionable error messages
src/out.js            console formatting + artifact saving
src/report.js         builds output/report.html after `all`
src/doctor.js         preflight check
src/demos/*.js        one file per use case — each is readable on its own
```

Each demo is self-contained: read `src/demos/scrape.js` and you have the whole pattern.

## Recording and profiles

Both are switched on with a query parameter on the connection URL — no SDK, no extra call.

```
wss://production-sfo.browserless.io?token=...&replay=true
wss://production-sfo.browserless.io?token=...&profile=my-login
```

`replay=true` records the session; it uploads when the session **ends**, so disconnecting
matters. Watch it at account.browserless.io under Session Replay. BrowserQL takes the same
parameter, which the `bql` demo exposes:

```bash
node index.js bql --replay
```

`profile=<name>` loads a saved snapshot of cookies, localStorage and IndexedDB before your code
runs — log in once, reuse it everywhere. `sessionStorage` is deliberately excluded because it is
tab-scoped.

A profile has to be **created before it can be attached** — passing `?profile=` for a name that
doesn't exist fails the WebSocket upgrade with a 404. The full flow, which the `profile` demo
implements:

1. `POST /profile` with a name → returns a WebSocket URL for a capture session.
2. Connect to it and log in as normal.
3. Send the `Browserless.saveProfile` CDP command — it snapshots cookies, localStorage and
   IndexedDB under that name. It's a CDP method, not a BrowserQL mutation, so this step needs
   Puppeteer, Playwright or raw CDP.
4. From then on, `?profile=<name>` restores that state on any session. Changes made during a
   session stay local to it and don't modify the saved profile.

The demo then reads the state back with the profile attached, and once more with no profile, so
the result is a comparison rather than a claim.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` / `403` | Token wrong, or the endpoint isn't on your plan (`/unblock` and BrowserQL are plan-gated) |
| `404` on `bql` | Try `BROWSERLESS_BQL_PATH=/chrome/bql` |
| `bql` timeout waiting for a DOM selector | That element isn't on the page — pass `--selector "body"` |
| `429` | All your concurrent sessions are busy — run demos one at a time |
| Timeouts | Raise `BROWSERLESS_TIMEOUT_MS`, or relax `gotoOptions.waitUntil` from `networkidle2` to `domcontentloaded` |
| `puppeteer-core is not installed` | `npm i puppeteer-core` — it ships no browser, Browserless *is* the browser |
| Replay not in the dashboard | The session must end — check the demo disconnected. Recording is plan-gated |
| `profile` reports "not persisted" | Authenticated Profiles are plan-gated; check Profiles in the dashboard |

Set `DEBUG=1` for full stack traces.

## What has been verified live

Run against a real token (SFO region, Node 24) — 7 of 9 demos passed on the first attempt:

- `screenshot`, `pdf`, `content`, `scrape`, `function`, `unblock`, `performance` all worked.
  Lighthouse took ~11s; everything else was 1-4s.
- `content` showed 0 `.quote` elements in the raw HTML vs 10 after rendering.
- BrowserQL is reachable at `/chromium/bql`, so that default is right.
- `bql` initially failed on a bad selector (fixed since, but not re-run).
- `puppeteer` was not exercised — it needs `npm i puppeteer-core` first.

Worth knowing about BrowserQL: its `text` field *waits* for the selector and fails the whole
mutation if the element never appears. Hacker News has no `<h1>`, so the demo now picks a
selector per site, overridable with `--selector`.
