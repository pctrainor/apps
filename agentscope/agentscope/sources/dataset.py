"""Replayable source over a saved GitHub crawl.

Reads a JSON snapshot produced from the GitHub search API (see
`demo_data/github_crawl.json`) and yields the same RawDocs the live
`GitHubSource` would, using the shared `github_repo_to_doc` mapping. This lets
the pipeline (and the dashboard) run end-to-end over *real* crawled data with
zero network — useful for reproducible demos and offline development.
"""

from __future__ import annotations

import json
from typing import Iterator

from ..models import RawDoc
from .base import Source
from .github import github_repo_to_doc


class GitHubDatasetSource(Source):
    name = "github"

    def __init__(self, path: str) -> None:
        self.path = path

    def fetch(self) -> Iterator[RawDoc]:
        with open(self.path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        items = data.get("items", data) if isinstance(data, dict) else data
        for item in items:
            yield github_repo_to_doc(item)

    def metadata(self) -> dict:
        """Provenance for the crawl (crawled_at, queries, source)."""
        with open(self.path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k != "items"}
        return {}
