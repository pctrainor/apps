"""Stage 2: the cheap keyword cull.

This is the widest part of the funnel and the cheapest filter, so it runs
first and drops the bulk of the corpus before any model is invoked. A doc
survives only if it references agent tech at least `prefilter_min_agent_hits`
times and clears the total-hit floor.
"""

from __future__ import annotations

from typing import Dict, List

from ..config import Config, DEFAULT_CONFIG
from ..models import Prefiltered, RawDoc


def _match(text: str, phrases: List[str]) -> List[str]:
    lowered = text.lower()
    return [p for p in phrases if p in lowered]


def prefilter(doc: RawDoc, config: Config = DEFAULT_CONFIG) -> Prefiltered:
    haystack = f"{doc.title}\n{doc.text}"
    hits: Dict[str, List[str]] = {}
    total = 0
    for category, phrases in config.signals.items():
        matched = _match(haystack, phrases)
        if matched:
            hits[category] = matched
            total += len(matched)

    th = config.thresholds
    agent_hits = len(hits.get("agent_tech", []))
    passed = (
        agent_hits >= th.prefilter_min_agent_hits
        and total >= th.prefilter_min_total_hits
    )
    return Prefiltered(
        doc_id=doc.doc_id, passed=passed, total_hits=total, hits_by_category=hits
    )
