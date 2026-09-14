"""Stage 5: turn signals into a 0-100 candidate score per company.

Signals are aggregated across every relevant doc for a company, each category
saturates (so keyword spam can't run the score up), and the weighted blend is
scaled to 0-100. Tiers come from the thresholds in config.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple

from ..config import Config, DEFAULT_CONFIG
from ..models import Candidate, Classification, Prefiltered, RawDoc


def _tier(score: int, cfg: Config) -> str:
    s = cfg.scoring
    if score >= s.tier_a:
        return "A"
    if score >= s.tier_b:
        return "B"
    if score >= s.tier_c:
        return "C"
    return "watch"


def score_company(
    company: str,
    docs: List[RawDoc],
    prefilters: List[Prefiltered],
    classifications: List[Classification],
    config: Config = DEFAULT_CONFIG,
    canonical: str = "",
    aliases: Optional[List[str]] = None,
) -> Candidate:
    """Aggregate one resolved company's evidence into a Candidate.

    `company` is the display name and `canonical` the entity key (see
    pipeline.entities); callers that have already resolved the entity pass both,
    otherwise `canonical` is derived from `company`.
    """
    # Union of distinct matched phrases per category across all the company's docs.
    per_category: Dict[str, set] = {}
    for pf in prefilters:
        for cat, matched in pf.hits_by_category.items():
            per_category.setdefault(cat, set()).update(matched)

    s = config.scoring
    category_scores: Dict[str, float] = {}
    weighted = 0.0
    max_weight = sum(s.weights.values())
    for cat, weight in s.weights.items():
        distinct = len(per_category.get(cat, set()))
        sat = s.saturation.get(cat, 3)
        sub = min(distinct / sat, 1.0) if sat else 0.0
        category_scores[cat] = round(sub, 3)
        weighted += weight * sub

    # Confidence from classification nudges the score a little (up to +/-10%).
    if classifications:
        avg_conf = sum(c.confidence for c in classifications) / len(classifications)
    else:
        avg_conf = 0.5
    confidence_factor = 0.9 + 0.2 * avg_conf   # 0.9 .. 1.1

    raw = (weighted / max_weight) * 100 * confidence_factor if max_weight else 0.0
    score = max(0, min(100, round(raw)))

    evidence = [d.url for d in docs]
    doc_ids = [d.doc_id for d in docs]
    return Candidate(
        company=company,
        score=score,
        tier=_tier(score, config),
        canonical=canonical,
        aliases=sorted(set(aliases or [])),
        category_scores=category_scores,
        evidence=evidence,
        doc_ids=doc_ids,
    )
