"""Skeletons for real, public-signal sources.

These are intentionally NOT implemented. They mark the seams where live
ingestion plugs in, and they document the scope boundary: every planned source
reads *published, public* material. None of them log into, probe, scan, or
otherwise touch a third party's running systems.

To implement one, fill in fetch() to yield RawDocs and add its dependency to
requirements.txt (see the 'real sources' extras).
"""

from __future__ import annotations

from typing import Iterator

from ..models import RawDoc
from .base import Source


class JobBoardSource(Source):
    """Public job postings (careers pages / aggregator APIs).

    Real impl: page through a job-board API or sitemap, map each posting to a
    RawDoc(company=..., text=job description). Respect robots.txt and rate
    limits. Public listings only.
    """

    name = "jobboard"

    def __init__(self, query: str = "ai agent", **kwargs: object) -> None:
        self.query = query
        self.kwargs = kwargs

    def fetch(self) -> Iterator[RawDoc]:
        raise NotImplementedError(
            "JobBoardSource is a skeleton. Wire up a public job-board API/sitemap "
            "and yield RawDocs. See requirements.txt [real] extras."
        )


class CommonCrawlSource(Source):
    """Company/product pages harvested from Common Crawl.

    Real impl: query the CC index for candidate hosts, pull the archived HTML
    (already-public crawl data — we never fetch the live site), extract text,
    yield RawDocs. This reads an existing public archive; it is not scanning.
    """

    name = "commoncrawl"

    def __init__(self, index: str = "CC-MAIN-latest", url_pattern: str = "*") -> None:
        self.index = index
        self.url_pattern = url_pattern

    def fetch(self) -> Iterator[RawDoc]:
        raise NotImplementedError(
            "CommonCrawlSource is a skeleton. Query the CC index and read archived "
            "WARC records; yield RawDocs from extracted page text."
        )
