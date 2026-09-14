# AgentScope

Public-signal market segmentation for AI-agent adopters. AgentScope ingests
**public** documents (job posts, public repos, company/product pages, funding
notes, Common Crawl), funnels them through cheap-to-expensive filters, and
scores companies 0–100 as sales prospects — surfacing organizations that are
deploying AI agents at scale and would benefit from agent-testing / AI-safety
services.

## Scope boundary (important)

AgentScope reads **only public signal**. It does **not** probe, scan, log
into, fuzz, or otherwise test any third party's live systems, and it does not
build lists of "exploitable" targets. Vulnerability discovery, if ever needed,
belongs on infrastructure you own and are authorized to test — never on other
people's sites. The `sources/` skeletons all read published/archived material
(e.g. Common Crawl reads an existing public archive, not the live site).

## The funnel (cheap filters before expensive ones)

```
  sources ──▶ prefilter ──▶ classify ──▶ score ──▶ candidates
  (ingest)    (keyword,      (keyword /   (0–100,    (ranked
              ~free, drops   local LLM /  weighted   prospects
              the bulk)      hosted LLM)  signals)   by tier)
```

1. **Ingest** — a `Source` yields `RawDoc`s from a public corpus.
2. **Prefilter** — a free keyword cull drops docs with no agent signal. This is
   the widest, cheapest stage, so it runs first and removes most of the corpus
   before any model is invoked.
3. **Classify** — survivors are labelled by a swappable backend:
   `keyword` (free, default), `ollama` (local LLM), or `api` (hosted LLM).
4. **Score** — signals are aggregated per company into a 0–100 score and an
   A/B/C/watch tier, using the weights in `config.py`.

Everything persists to a local SQLite store after each stage, so runs are
resumable and idempotent.

## Quickstart

No install, no network, no API keys:

```bash
cd agentscope
python -m agentscope            # runs the full funnel over offline fixtures
```

You'll see the funnel counts and a ranked candidate list. Then explore:

```bash
python -m agentscope run --source demo --classifier keyword
python -m agentscope run --stages ingest,prefilter    # run a subset of stages
python -m agentscope status                           # funnel counts + stage state
python -m agentscope top --limit 10 --min-score 25    # ranked prospects
python -m agentscope top --tier A --evidence          # tier A with source URLs
python -m agentscope pause | stop | resume            # control a background run
python -m agentscope reset                            # wipe the local store
python -m agentscope --help
```

Point at a different database with `--db path/to.db` (default `agentscope.db`).

## Layout

```
agentscope/
  config.py              # signal vocabulary, scoring weights, thresholds
  models.py              # RawDoc, Prefiltered, Classification, Candidate
  cli.py / __main__.py   # admin control surface + entry point
  store/db.py            # SQLite store (Postgres-friendly surface)
  sources/
    base.py              # Source interface
    demo.py              # offline fixtures (zero setup)
    real_stubs.py        # JobBoard / GitHub / CommonCrawl skeletons
  pipeline/
    prefilter.py         # stage 2: keyword cull
    classify (../classify/classifier.py)  # stage 4 backends
    scoring.py           # stage 5: 0–100 score per company
    jobs.py              # orchestrator with start/pause/stop control
  tests/                 # stdlib smoke tests
```

## Extending

Designed so the parts you'll want to change are swappable config, not rewrites:

- **New source** — subclass `sources.base.Source`, implement `fetch()` to yield
  `RawDoc`s from public data, and register it in `cli._SOURCES`. Skeletons for
  job boards, GitHub, and Common Crawl are in `sources/real_stubs.py`.
- **New classifier** — subclass `classify.classifier.Classifier`, return a
  `Classification`, and add it to the `_BACKENDS` factory. Keyword / Ollama /
  API backends are provided; the API backend is a one-line swap to Bedrock.
- **Postgres / cloud storage** — reimplement the `store.db.Store` method surface
  against another connection; the SQL is vanilla and access is funnelled
  through that one class.
- **Retune scoring** — edit weights, saturation, and tier cut-offs in
  `config.py`; no pipeline code changes.

## Tests

```bash
cd agentscope
python -m unittest discover -s tests    # zero third-party deps
# or, if installed:  pytest
```

## Roadmap

- Implement the real sources (`real_stubs.py`) against public APIs/archives.
- Company-entity resolution (dedupe across sources).
- Move storage to Postgres and classification to Bedrock as a config change.
- SaaS surface on top of the same funnel.
