"""SQLite-backed storage.

Chosen for zero-setup local runs. The SQL is intentionally vanilla and the
access is funnelled through a small `Store` surface, so swapping in Postgres
(or a Bedrock/RDS-backed store) later is a config change, not a rewrite:
implement the same methods against a different connection.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from typing import Dict, Iterable, Iterator, List, Optional

from ..models import Candidate, Classification, Prefiltered, RawDoc

SCHEMA = """
CREATE TABLE IF NOT EXISTS raw_docs (
    doc_id     TEXT PRIMARY KEY,
    source     TEXT NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT,
    text       TEXT,
    company    TEXT,
    fetched_at TEXT,
    meta       TEXT
);

CREATE TABLE IF NOT EXISTS prefiltered (
    doc_id           TEXT PRIMARY KEY,
    passed           INTEGER NOT NULL,
    total_hits       INTEGER NOT NULL,
    hits_by_category TEXT,
    FOREIGN KEY (doc_id) REFERENCES raw_docs(doc_id)
);

CREATE TABLE IF NOT EXISTS classifications (
    doc_id     TEXT PRIMARY KEY,
    relevant   INTEGER NOT NULL,
    confidence REAL,
    labels     TEXT,
    backend    TEXT,
    rationale  TEXT,
    company    TEXT,
    FOREIGN KEY (doc_id) REFERENCES raw_docs(doc_id)
);

CREATE TABLE IF NOT EXISTS candidates (
    canonical       TEXT PRIMARY KEY,
    company         TEXT,
    score           INTEGER NOT NULL,
    tier            TEXT,
    aliases         TEXT,
    category_scores TEXT,
    evidence        TEXT,
    doc_ids         TEXT,
    first_seen      TEXT,
    last_seen       TEXT
);

CREATE TABLE IF NOT EXISTS job_state (
    stage      TEXT PRIMARY KEY,
    status     TEXT NOT NULL,      -- idle | running | paused | stopped | done | error
    updated_at TEXT,
    detail     TEXT
);
"""


class Store:
    """Thin SQLite wrapper. All methods are safe to call repeatedly."""

    def __init__(self, path: str = "agentscope.db") -> None:
        self.path = path
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self._conn
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    # --- raw_docs ----------------------------------------------------------
    def upsert_raw_doc(self, doc: RawDoc) -> None:
        with self._tx() as c:
            c.execute(
                """INSERT INTO raw_docs
                   (doc_id, source, url, title, text, company, fetched_at, meta)
                   VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(doc_id) DO UPDATE SET
                     source=excluded.source, url=excluded.url, title=excluded.title,
                     text=excluded.text, company=excluded.company,
                     fetched_at=excluded.fetched_at, meta=excluded.meta""",
                (doc.doc_id, doc.source, doc.url, doc.title, doc.text,
                 doc.company, doc.fetched_at, json.dumps(doc.meta)),
            )

    def iter_raw_docs(self) -> Iterator[RawDoc]:
        for r in self._conn.execute("SELECT * FROM raw_docs"):
            yield RawDoc(
                source=r["source"], url=r["url"], title=r["title"],
                text=r["text"], company=r["company"], doc_id=r["doc_id"],
                fetched_at=r["fetched_at"], meta=json.loads(r["meta"] or "{}"),
            )

    def get_raw_doc(self, doc_id: str) -> Optional[RawDoc]:
        r = self._conn.execute(
            "SELECT * FROM raw_docs WHERE doc_id=?", (doc_id,)
        ).fetchone()
        if not r:
            return None
        return RawDoc(
            source=r["source"], url=r["url"], title=r["title"], text=r["text"],
            company=r["company"], doc_id=r["doc_id"], fetched_at=r["fetched_at"],
            meta=json.loads(r["meta"] or "{}"),
        )

    # --- prefiltered -------------------------------------------------------
    def save_prefiltered(self, pf: Prefiltered) -> None:
        with self._tx() as c:
            c.execute(
                """INSERT INTO prefiltered (doc_id, passed, total_hits, hits_by_category)
                   VALUES (?,?,?,?)
                   ON CONFLICT(doc_id) DO UPDATE SET
                     passed=excluded.passed, total_hits=excluded.total_hits,
                     hits_by_category=excluded.hits_by_category""",
                (pf.doc_id, int(pf.passed), pf.total_hits,
                 json.dumps(pf.hits_by_category)),
            )

    def iter_survivors(self) -> Iterator[Prefiltered]:
        rows = self._conn.execute("SELECT * FROM prefiltered WHERE passed=1")
        for r in rows:
            yield Prefiltered(
                doc_id=r["doc_id"], passed=bool(r["passed"]),
                total_hits=r["total_hits"],
                hits_by_category=json.loads(r["hits_by_category"] or "{}"),
            )

    # --- classifications ---------------------------------------------------
    def save_classification(self, cl: Classification) -> None:
        with self._tx() as c:
            c.execute(
                """INSERT INTO classifications
                   (doc_id, relevant, confidence, labels, backend, rationale, company)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(doc_id) DO UPDATE SET
                     relevant=excluded.relevant, confidence=excluded.confidence,
                     labels=excluded.labels, backend=excluded.backend,
                     rationale=excluded.rationale, company=excluded.company""",
                (cl.doc_id, int(cl.relevant), cl.confidence, json.dumps(cl.labels),
                 cl.backend, cl.rationale, cl.company),
            )

    def iter_relevant(self) -> Iterator[Classification]:
        rows = self._conn.execute("SELECT * FROM classifications WHERE relevant=1")
        for r in rows:
            yield Classification(
                doc_id=r["doc_id"], relevant=bool(r["relevant"]),
                confidence=r["confidence"], labels=json.loads(r["labels"] or "[]"),
                backend=r["backend"], rationale=r["rationale"] or "",
                company=r["company"],
            )

    # --- candidates --------------------------------------------------------
    def upsert_candidate(self, cand: Candidate) -> None:
        with self._tx() as c:
            c.execute(
                """INSERT INTO candidates
                   (canonical, company, score, tier, aliases, category_scores,
                    evidence, doc_ids, first_seen, last_seen)
                   VALUES (?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(canonical) DO UPDATE SET
                     company=excluded.company, score=excluded.score,
                     tier=excluded.tier, aliases=excluded.aliases,
                     category_scores=excluded.category_scores,
                     evidence=excluded.evidence, doc_ids=excluded.doc_ids,
                     last_seen=excluded.last_seen""",
                (cand.canonical, cand.company, cand.score, cand.tier,
                 json.dumps(cand.aliases), json.dumps(cand.category_scores),
                 json.dumps(cand.evidence), json.dumps(cand.doc_ids),
                 cand.first_seen, cand.last_seen),
            )

    def top_candidates(self, limit: int = 20, min_score: int = 0) -> List[Candidate]:
        rows = self._conn.execute(
            "SELECT * FROM candidates WHERE score>=? ORDER BY score DESC LIMIT ?",
            (min_score, limit),
        )
        out: List[Candidate] = []
        for r in rows:
            out.append(Candidate(
                company=r["company"], score=r["score"], tier=r["tier"],
                canonical=r["canonical"], aliases=json.loads(r["aliases"] or "[]"),
                category_scores=json.loads(r["category_scores"] or "{}"),
                evidence=json.loads(r["evidence"] or "[]"),
                doc_ids=json.loads(r["doc_ids"] or "[]"),
                first_seen=r["first_seen"], last_seen=r["last_seen"],
            ))
        return out

    # --- job_state ---------------------------------------------------------
    def set_state(self, stage: str, status: str, detail: str = "") -> None:
        from ..models import _now
        with self._tx() as c:
            c.execute(
                """INSERT INTO job_state (stage, status, updated_at, detail)
                   VALUES (?,?,?,?)
                   ON CONFLICT(stage) DO UPDATE SET
                     status=excluded.status, updated_at=excluded.updated_at,
                     detail=excluded.detail""",
                (stage, status, _now(), detail),
            )

    def get_state(self, stage: str) -> Optional[Dict[str, str]]:
        r = self._conn.execute(
            "SELECT * FROM job_state WHERE stage=?", (stage,)
        ).fetchone()
        return dict(r) if r else None

    def all_state(self) -> List[Dict[str, str]]:
        rows = self._conn.execute("SELECT * FROM job_state ORDER BY stage")
        return [dict(r) for r in rows]

    def counts(self) -> Dict[str, int]:
        def n(sql: str) -> int:
            return self._conn.execute(sql).fetchone()[0]
        return {
            "raw_docs": n("SELECT COUNT(*) FROM raw_docs"),
            "prefiltered": n("SELECT COUNT(*) FROM prefiltered"),
            "survivors": n("SELECT COUNT(*) FROM prefiltered WHERE passed=1"),
            "relevant": n("SELECT COUNT(*) FROM classifications WHERE relevant=1"),
            "candidates": n("SELECT COUNT(*) FROM candidates"),
        }

    def reset(self) -> None:
        with self._tx() as c:
            for t in ("raw_docs", "prefiltered", "classifications",
                      "candidates", "job_state"):
                c.execute(f"DELETE FROM {t}")
