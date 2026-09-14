# bl — Browserless use-case demos

Nine runnable demos of the [Browserless](https://www.browserless.io) API in plain Node.js.
No TypeScript, no build step, no runtime dependencies — just `fetch` and the standard library.

## Setup

```bash
cd ~/bl
node index.js doctor      # creates .env on first run
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
node index.js                          # list the demos
node index.js screenshot               # one demo, default target
node index.js screenshot https://stripe.com
node index.js scrape https://news.ycombinator.com --selector ".titleline > a"
node index.js all                      # every demo, then build output/report.html
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

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` / `403` | Token wrong, or the endpoint isn't on your plan (`/unblock` and BrowserQL are plan-gated) |
| `404` on `bql` | Try `BROWSERLESS_BQL_PATH=/chrome/bql` |
| `429` | All your concurrent sessions are busy — run demos one at a time |
| Timeouts | Raise `BROWSERLESS_TIMEOUT_MS`, or relax `gotoOptions.waitUntil` from `networkidle2` to `domcontentloaded` |
| `puppeteer-core is not installed` | `npm i puppeteer-core` — it ships no browser, Browserless *is* the browser |

Set `DEBUG=1` for full stack traces.

## A note on verification

The request/response shapes here follow the Browserless v2 API. They were written without a
live account to test against, so if your plan or region differs, `doctor` and the per-demo error
hints will tell you exactly which call disagreed. The likeliest thing to need adjusting is
`BROWSERLESS_BQL_PATH`, and `/unblock` if it isn't included in your plan.
