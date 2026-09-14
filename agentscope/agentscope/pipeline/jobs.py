"""Stage orchestration with cooperative start / pause / stop control.

The runner walks the funnel stage by stage — ingest -> prefilter -> classify
-> score — persisting after each so a run is resumable and every stage is
idempotent (writes are upserts). Control is a single row in `job_state`
("control"); the runner checks it at each item boundary, so a `pause`/`stop`
issued from the CLI (or another process) takes effect at the next checkpoint
rather than mid-write. Because stages are idempotent, resuming is just running
again with control set back to "run".
"""

from __future__ import annotations

from collections import defaultdict
from typing import Callable, Dict, List, Optional

from ..classify.classifier import Classifier, get_classifier
from ..config import Config, DEFAULT_CONFIG
from ..sources.base import Source
from ..store.db import Store
from .prefilter import prefilter
from .entities import choose_display, normalize_company
from .scoring import score_company

STAGES = ["ingest", "prefilter", "classify", "score"]
_CONTROL = "control"

ProgressFn = Callable[[str, str], None]  # (stage, message) -> None


class Stopped(Exception):
    """Raised internally when control is set to 'stopped' mid-run."""


class JobRunner:
    def __init__(
        self,
        store: Store,
        source: Source,
        classifier: Optional[Classifier] = None,
        config: Config = DEFAULT_CONFIG,
        progress: Optional[ProgressFn] = None,
    ) -> None:
        self.store = store
        self.source = source
        self.classifier = classifier or get_classifier("keyword", config=config)
        self.config = config
        self.progress = progress or (lambda stage, msg: None)

    # --- control surface ---------------------------------------------------
    def request_pause(self) -> None:
        self.store.set_state(_CONTROL, "paused")

    def request_stop(self) -> None:
        self.store.set_state(_CONTROL, "stopped")

    def resume(self) -> None:
        self.store.set_state(_CONTROL, "run")

    def _control(self) -> str:
        st = self.store.get_state(_CONTROL)
        return st["status"] if st else "run"

    def _checkpoint(self, stage: str) -> None:
        ctrl = self._control()
        if ctrl == "stopped":
            self.store.set_state(stage, "stopped")
            raise Stopped()
        if ctrl == "paused":
            self.store.set_state(stage, "paused")
            raise Stopped()

    # --- stages ------------------------------------------------------------
    def _ingest(self) -> None:
        self.store.set_state("ingest", "running")
        n = 0
        for doc in self.source.fetch():
            self._checkpoint("ingest")
            self.store.upsert_raw_doc(doc)
            n += 1
        self.store.set_state("ingest", "done", f"{n} docs")
        self.progress("ingest", f"ingested {n} documents")

    def _prefilter(self) -> None:
        self.store.set_state("prefilter", "running")
        seen = passed = 0
        for doc in self.store.iter_raw_docs():
            self._checkpoint("prefilter")
            pf = prefilter(doc, self.config)
            self.store.save_prefiltered(pf)
            seen += 1
            passed += int(pf.passed)
        dropped = seen - passed
        pct = (dropped / seen * 100) if seen else 0.0
        self.store.set_state("prefilter", "done", f"{passed}/{seen} survived")
        self.progress("prefilter",
                      f"{seen} in -> {passed} survived ({pct:.0f}% dropped)")

    def _classify(self) -> None:
        self.store.set_state("classify", "running")
        n = relevant = 0
        for pf in self.store.iter_survivors():
            self._checkpoint("classify")
            doc = self.store.get_raw_doc(pf.doc_id)
            if doc is None:
                continue
            cl = self.classifier.classify(doc)
            self.store.save_classification(cl)
            n += 1
            relevant += int(cl.relevant)
        self.store.set_state("classify", "done", f"{relevant}/{n} relevant")
        self.progress("classify",
                      f"classified {n} survivors -> {relevant} relevant "
                      f"[{self.classifier.backend}]")

    def _score(self) -> None:
        self.store.set_state("score", "running")
        # Group relevant docs by *resolved* company entity so that surface-form
        # variants across sources (e.g. "tessellate-ai" vs "Tessellate AI")
        # merge into one candidate instead of several weak duplicates.
        by_docs: Dict[str, list] = defaultdict(list)
        by_pf: Dict[str, list] = defaultdict(list)
        by_cl: Dict[str, list] = defaultdict(list)
        aliases: Dict[str, set] = defaultdict(set)

        relevant = list(self.store.iter_relevant())
        pf_index = {pf.doc_id: pf for pf in self.store.iter_survivors()}
        for cl in relevant:
            self._checkpoint("score")
            doc = self.store.get_raw_doc(cl.doc_id)
            if doc is None:
                continue
            raw_name = cl.company or doc.company or "unknown"
            key = normalize_company(raw_name) or "unknown"
            by_docs[key].append(doc)
            by_cl[key].append(cl)
            aliases[key].add(raw_name)
            if cl.doc_id in pf_index:
                by_pf[key].append(pf_index[cl.doc_id])

        made = 0
        for key, docs in by_docs.items():
            display = choose_display(aliases[key]) or key
            cand = score_company(
                display, docs, by_pf.get(key, []), by_cl.get(key, []),
                self.config, canonical=key, aliases=list(aliases[key]),
            )
            self.store.upsert_candidate(cand)
            made += 1
        self.store.set_state("score", "done", f"{made} candidates")
        self.progress("score", f"scored {made} candidate companies")

    # --- driver ------------------------------------------------------------
    def run(self, stages: Optional[List[str]] = None) -> bool:
        """Run the requested stages in funnel order. Returns True if completed,
        False if a pause/stop interrupted it."""
        stages = stages or STAGES
        self.resume()  # clear any stale stop/pause before a fresh run
        fns = {
            "ingest": self._ingest, "prefilter": self._prefilter,
            "classify": self._classify, "score": self._score,
        }
        try:
            for stage in STAGES:            # always run in canonical order
                if stage in stages:
                    fns[stage]()
        except Stopped:
            return False
        return True
