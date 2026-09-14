"""Dataclasses that move between pipeline stages.

These are deliberately plain: each stage consumes the previous stage's type
and emits the next. They serialise cleanly to/from the SQLite store and would
map just as well onto Postgres rows or JSON columns later.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_doc_id(source: str, url: str) -> str:
    """Stable id so re-ingesting the same URL from the same source upserts."""
    return hashlib.sha1(f"{source}::{url}".encode("utf-8")).hexdigest()[:16]


@dataclass
class RawDoc:
    """A single ingested public document (job post, repo, company page...)."""

    source: str                 # e.g. "demo", "jobboard", "github", "commoncrawl"
    url: str
    title: str
    text: str
    company: Optional[str] = None
    doc_id: str = ""
    fetched_at: str = field(default_factory=_now)
    meta: Dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.doc_id:
            self.doc_id = make_doc_id(self.source, self.url)


@dataclass
class Prefiltered:
    """Result of the cheap keyword cull for one RawDoc."""

    doc_id: str
    passed: bool
    total_hits: int
    hits_by_category: Dict[str, List[str]]  # category -> matched phrases

    def agent_hits(self) -> int:
        return len(self.hits_by_category.get("agent_tech", []))


@dataclass
class Classification:
    """Result of classifying a survivor. Backend-agnostic by design."""

    doc_id: str
    relevant: bool
    confidence: float                 # 0.0-1.0
    labels: List[str]                 # category / topic labels
    backend: str                      # "keyword", "ollama", "api:<model>"...
    rationale: str = ""
    company: Optional[str] = None


@dataclass
class Candidate:
    """A scored prospect, aggregated from one or more classified docs.

    `canonical` is the entity-resolution key (see pipeline.entities); it is the
    storage identity so surface-form variants of one company merge. `company`
    is the human-friendly display name chosen from the observed aliases.
    """

    company: str                      # display name
    score: int                        # 0-100
    tier: str                         # "A" / "B" / "C" / "watch"
    canonical: str = ""               # entity key; defaults from company
    aliases: List[str] = field(default_factory=list)    # observed surface forms
    category_scores: Dict[str, float] = field(default_factory=dict)
    evidence: List[str] = field(default_factory=list)   # supporting URLs
    doc_ids: List[str] = field(default_factory=list)
    first_seen: str = field(default_factory=_now)
    last_seen: str = field(default_factory=_now)

    def __post_init__(self) -> None:
        if not self.canonical:
            # Lazy import avoids a models<->pipeline import cycle.
            from .pipeline.entities import normalize_company
            self.canonical = normalize_company(self.company)
