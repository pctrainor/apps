# datapipe

An hourly pipeline over open government data. Each run picks a dataset, downloads it, profiles
every column, runs data-quality tests, generates falsifiable hypotheses, **tests each one against
the actual data**, and rewrites a dashboard. A daily command rolls the runs up into a digest.

Plain Node.js, no build step. The only dependency is optional (the AWS Bedrock SDK).

## The seven stages

```
select -> download -> parse -> profile -> quality tests -> hypothesise -> verify -> report
```

1. **select** — queries the data.gov CKAN API for a popular dataset with a CSV or JSON resource,
   skipping anything analysed in the last week.
2. **download** — streams the file with a hard size cap, so a 4 GB resource can't take the box down.
3. **parse** — RFC4180 CSV (quotes, embedded newlines, delimiter sniffing) or JSON.
4. **profile** — per column: inferred type, null rate, cardinality, distribution statistics,
   and whether it looks like an identifier rather than a measurement.
5. **quality tests** — empty columns, high null rates, duplicate rows, constant columns, mixed
   types, outliers beyond 3× IQR, future dates, and columns that duplicate each other.
6. **hypothesise** — Bedrock sees only the *summary statistics* and proposes hypotheses, each with
   a machine-checkable test spec. Without AWS credentials it falls back to searching the data.
7. **verify** — every hypothesis is actually tested: Pearson correlation with a p-value, Welch's
   t-test with Cohen's d, OLS trend, or a skewness check. Verdict: supported, refuted, inconclusive.

## Setup

```
cd ~/datapipe
node run.js doctor
```

`doctor` creates `.env`, checks the catalogue is reachable, and reports which credentials it can see.
Nothing is required to start — try it offline first:

```
node run.js run --fixture
```

That runs the whole pipeline against a bundled synthetic dataset with known relationships, so you
can see the output before pointing it at the network.

For LLM-generated hypotheses:

```
npm i @anthropic-ai/bedrock-sdk
```

and set AWS credentials however you normally do (env vars, `~/.aws/credentials`, SSO). The default
model is `anthropic.claude-haiku-4-5`, the cheapest current Claude model — each run sends a
schema summary and gets a short JSON array back, so it's fractions of a cent. Change `BEDROCK_MODEL`
to `anthropic.claude-sonnet-5` or `anthropic.claude-opus-5` for deeper analysis.

## Commands

```
node run.js run
node run.js run --fixture
node run.js run --no-bedrock
node run.js digest
node run.js digest --hours 48
node run.js dashboard
node run.js doctor
```

| Flag | Effect |
| --- | --- |
| `--fixture` | Use the bundled synthetic dataset instead of the network |
| `--no-bedrock` | Skip the LLM; generate hypotheses by searching the data |
| `--cooldown N` | Hours before a dataset may be analysed again (default 168) |
| `--hours N` | Digest window (default 24) |
| `--keep` | Don't prune old downloads |

## Scheduling

`crontab -e`, then:

```
0 * * * * cd ~/datapipe && /usr/bin/env node run.js run >> data/pipeline.log 2>&1
30 7 * * * cd ~/datapipe && /usr/bin/env node run.js digest >> data/pipeline.log 2>&1
```

Hourly runs, digest at 07:30. Use the absolute path to `node` if cron can't find it
(`which node`). On macOS, cron needs Full Disk Access in System Settings → Privacy to write
outside its own directory; `launchd` is the better-supported alternative if you hit that.

## Output

| File | Written by | Contents |
| --- | --- | --- |
| `data/dashboard.html` | every run | Latest run in full, plus a table of recent runs |
| `data/digest-<date>.html` | `digest` | 24h rollup: findings, quality failures, failed runs |
| `data/runs/*.json` | every run | One complete record per run, including the full profile |
| `data/state.json` | every run | Which datasets have been analysed and when |

Open the dashboard with `open data/dashboard.html`.

## How to read the results

This matters more than any other section.

**Predicted vs discovered.** A hypothesis marked *predicted* came from Bedrock, which saw only
summary statistics — never the values. Testing it is therefore a real test, and "supported" is a
genuine result. A hypothesis marked *discovered* came from the fallback, which searched the data
for the strongest relationship it could find. Verifying that confirms the search worked; it does
not independently test an idea. The digest leads with predicted findings for this reason.

**Multiple comparisons.** A wide table produces a lot of tests. The thresholds are p < 0.01 *and*
a minimum effect size (|r| ≥ 0.2, |d| ≥ 0.3), which helps, but some "supported" results will still
be chance. Treat everything here as a screen that tells you where to look, not as a finding.

**Correlation is not causation**, and this pipeline has no way to tell the difference.

**Truncation.** Files are capped at `MAX_DOWNLOAD_BYTES` and `MAX_ROWS`. When either bites, the
statistics describe the first N rows — not the dataset. The dashboard flags it when it happens.

## Configuration

All in `.env`, all optional:

| Variable | Default | Notes |
| --- | --- | --- |
| `CKAN_BASE_URL` | `https://catalog.data.gov` | Any CKAN portal works |
| `ALLOWED_FORMATS` | `CSV,JSON` | Resource formats to consider |
| `MAX_DOWNLOAD_BYTES` | `41943040` (40 MB) | Enforced while streaming |
| `MAX_ROWS` | `50000` | Parse cap |
| `AWS_REGION` | `us-east-1` | Bedrock region |
| `BEDROCK_MODEL` | `anthropic.claude-haiku-4-5` | Bedrock model ids take the `anthropic.` prefix |
| `BROWSERLESS_TOKEN` | — | Optional; only used to screenshot the landing page |

## Layout

```
run.js                 CLI and orchestration
src/config.js          .env loading and settings
src/sources/datagov.js CKAN search with fallback sort strategies
src/fetch.js           streaming download with a size ceiling
src/table.js           CSV/JSON parsing
src/profile.js         type inference and column statistics
src/tests.js           data-quality checks
src/stats.js           correlation, t-tests, effect sizes, trend fitting
src/hypothesis.js      Bedrock prompt, response validation, search fallback
src/verify.js          runs each hypothesis's test spec against the data
src/render.js          dashboard and digest HTML
src/store.js           run history and seen-dataset state
fixtures/generate.js   builds the offline test dataset
```

### Adding another source

`src/sources/datagov.js` exports one function, `findDataset({ skip })`, returning
`{ dataset, resource, strategy, rank }`. Any module matching that shape can be dropped in —
every other portal running CKAN (there are many) needs only a different `CKAN_BASE_URL`.

### Why the API and not a browser

data.gov exposes a real API, so discovery and download go through CKAN. Browserless is used for
exactly one thing here — a screenshot of the dataset's landing page for the dashboard — because
that's the only part an API can't provide. Reaching for a browser where an API exists buys you
fragility and nothing else.

## What has been verified

The analytical core was tested end to end against `fixtures/sample.csv`, which has known
relationships planted in it and deliberate defects:

- CSV parser: quoted delimiters, doubled quotes, embedded newlines, CRLF, BOM, semicolon/tab
  sniffing, row caps — all pass.
- Statistics: Pearson, the t-distribution p-value, and Welch's t-test check out against reference
  values and hand calculations.
- Profiling correctly identified all 10 column types, the 35% null column, the constant column,
  the empty column, the 6 duplicate rows, and the derived `visitors ~ ticket_revenue` pair.
- Hypothesis → verification round trip recovered every planted relationship.
- The failure path was exercised: with the catalogue unreachable, the run degrades through all
  four sort strategies, records the failure, and shows it on the dashboard.

**Not verified:** the live data.gov calls and the Bedrock call — the environment this was built in
blocks both hosts. Those two modules are small and isolated, and both report precisely what went
wrong. The CKAN sort strategies in particular are a deliberate guess-and-check: data.gov may not
have view tracking enabled, in which case the run logs that and falls through to recency.
