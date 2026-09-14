"""Source interface.

A Source turns some public corpus into a stream of RawDocs. Implementations
must only touch *public* signal — published job posts, public repositories,
company/product pages, funding announcements, Common Crawl. Nothing here may
probe, scan, log into, or test a third party's live systems.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterator

from ..models import RawDoc


class Source(ABC):
    name: str = "source"

    @abstractmethod
    def fetch(self) -> Iterator[RawDoc]:
        """Yield RawDocs. Should be lazy/streaming for large corpora."""
        raise NotImplementedError
