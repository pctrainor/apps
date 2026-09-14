"""AgentScope admin CLI — the control surface over the funnel.

    python -m agentscope                 # zero-setup end-to-end demo
    python -m agentscope run --source demo --classifier keyword
    python -m agentscope run --stages ingest,prefilter   # partial run
    python -m agentscope status          # per-stage state + funnel counts
    python -m agentscope top --limit 10 --min-score 25   # ranked prospects
    python -m agentscope pause | stop | resume           # control a run
    python -m agentscope reset           # wipe the local store

Sources: demo (offline fixtures). jobboard/github/commoncrawl are wired as
skeletons and will report that they are not yet implemented.
Classifiers: keyword (free, default), ollama (local LLM), api (hosted LLM).
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from .classify.classifier import get_classifier
from .config import DEFAULT_CONFIG, Config
from .pipeline.jobs import STAGES, JobRunner
from .sources.base import Source
from .sources.demo import DemoSource
from .sources.real_stubs import CommonCrawlSource, GitHubSource, JobBoardSource
from .store.db import Store

_SOURCES = {
    "demo": lambda: DemoSource(),
    "jobboard": lambda: JobBoardSource(),
    "github": lambda: GitHubSource(),
    "commoncrawl": lambda: CommonCrawlSource(),
}

_TIER_MARK = {"A": "***", "B": "** ", "C": "*  ", "watch": "   "}


def _make_source(name: str) -> Source:
    try:
        return _SOURCES[name]()
    except KeyError:
        raise SystemExit(f"unknown source {name!r}; choose from {sorted(_SOURCES)}")


def _print_progress(stage: str, msg: str) -> None:
    print(f"  [{stage:9}] {msg}")


def cmd_run(args: argparse.Namespace) -> int:
    store = Store(args.db)
    config = DEFAULT_CONFIG
    source = _make_source(args.source)
    classifier_kwargs = {"config": config}
    if args.model:
        classifier_kwargs["model"] = args.model
    classifier = get_classifier(args.classifier, **classifier_kwargs)

    stages: List[str] = (
        [s.strip() for s in args.stages.split(",")] if args.stages else STAGES
    )
    bad = [s for s in stages if s not in STAGES]
    if bad:
        raise SystemExit(f"unknown stage(s) {bad}; valid: {STAGES}")

    runner = JobRunner(store, source, classifier, config, progress=_print_progress)
    print(f"Running stages {stages} | source={args.source} "
          f"classifier={classifier.backend}")
    try:
        completed = runner.run(stages)
    except NotImplementedError as exc:
        store.close()
        raise SystemExit(f"source '{args.source}' is not implemented yet: {exc}")

    counts = store.counts()
    print(f"\nFunnel: {counts['raw_docs']} ingested "
          f"-> {counts['survivors']} survived prefilter "
          f"-> {counts['relevant']} relevant "
          f"-> {counts['candidates']} candidates")
    if not completed:
        print("(run was paused/stopped before completing all stages)")
    store.close()
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    store = Store(args.db)
    counts = store.counts()
    print("Funnel counts:")
    for k in ("raw_docs", "prefiltered", "survivors", "relevant", "candidates"):
        print(f"  {k:12} {counts[k]}")
    print("\nStage state:")
    state = store.all_state()
    if not state:
        print("  (no runs yet)")
    for st in state:
        detail = f" - {st['detail']}" if st.get("detail") else ""
        print(f"  {st['stage']:10} {st['status']:8} {st['updated_at']}{detail}")
    store.close()
    return 0


def cmd_top(args: argparse.Namespace) -> int:
    store = Store(args.db)
    cands = store.top_candidates(limit=args.limit, min_score=args.min_score)
    if args.tier:
        cands = [c for c in cands if c.tier == args.tier]
    if not cands:
        print("No candidates yet. Run the pipeline first (python -m agentscope run).")
        store.close()
        return 0
    print(f"Top {len(cands)} candidates:\n")
    print(f"  {'':3} {'SCORE':>5}  {'TIER':4} COMPANY")
    print(f"  {'':3} {'-----':>5}  {'----':4} -------")
    for c in cands:
        print(f"  {_TIER_MARK.get(c.tier, '   ')} {c.score:>5}  {c.tier:4} {c.company}")
        cats = ", ".join(f"{k}={v:.2f}" for k, v in c.category_scores.items() if v)
        if cats:
            print(f"      signals: {cats}")
        if args.evidence and c.evidence:
            for url in c.evidence:
                print(f"      - {url}")
    store.close()
    return 0


def _control(args: argparse.Namespace, action: str) -> int:
    store = Store(args.db)
    runner = JobRunner(store, DemoSource())  # only the control surface is used
    {"pause": runner.request_pause, "stop": runner.request_stop,
     "resume": runner.resume}[action]()
    print(f"control -> {action}")
    store.close()
    return 0


def cmd_reset(args: argparse.Namespace) -> int:
    store = Store(args.db)
    store.reset()
    print(f"store '{args.db}' reset (all tables cleared)")
    store.close()
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    """Zero-setup end-to-end run over the offline fixtures, then show top."""
    store = Store(args.db)
    store.reset()
    runner = JobRunner(store, DemoSource(), get_classifier("keyword"),
                       DEFAULT_CONFIG, progress=_print_progress)
    print("AgentScope demo — running the full funnel over offline fixtures\n")
    runner.run()
    counts = store.counts()
    print(f"\nFunnel: {counts['raw_docs']} ingested "
          f"-> {counts['survivors']} survived prefilter "
          f"-> {counts['relevant']} relevant "
          f"-> {counts['candidates']} candidates\n")
    store.close()
    # Reuse the top view for a consistent presentation.
    top_args = argparse.Namespace(db=args.db, limit=20, min_score=0,
                                  tier=None, evidence=True)
    return cmd_top(top_args)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="agentscope",
        description="Public-signal market segmentation for AI-agent adopters.",
    )
    p.add_argument("--db", default=DEFAULT_CONFIG.db_path,
                   help="SQLite path (default: %(default)s)")
    sub = p.add_subparsers(dest="command")

    r = sub.add_parser("run", help="run the pipeline")
    r.add_argument("--source", default="demo")
    r.add_argument("--classifier", default="keyword",
                   choices=["keyword", "ollama", "api"])
    r.add_argument("--model", default=None, help="model id for ollama/api backends")
    r.add_argument("--stages", default=None,
                   help="comma list subset of: " + ",".join(STAGES))
    r.set_defaults(func=cmd_run)

    s = sub.add_parser("status", help="show funnel counts and stage state")
    s.set_defaults(func=cmd_status)

    t = sub.add_parser("top", help="show top candidates")
    t.add_argument("--limit", type=int, default=20)
    t.add_argument("--min-score", type=int, default=0)
    t.add_argument("--tier", default=None, choices=["A", "B", "C", "watch"])
    t.add_argument("--evidence", action="store_true", help="list supporting URLs")
    t.set_defaults(func=cmd_top)

    for name in ("pause", "stop", "resume"):
        c = sub.add_parser(name, help=f"set run control to '{name}'")
        c.set_defaults(func=lambda a, _n=name: _control(a, _n))

    d = sub.add_parser("reset", help="clear the local store")
    d.set_defaults(func=cmd_reset)

    dm = sub.add_parser("demo", help="zero-setup end-to-end demo")
    dm.set_defaults(func=cmd_demo)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        # No subcommand -> run the demo (the friendliest default).
        return cmd_demo(argparse.Namespace(db=args.db))
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
