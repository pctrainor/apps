"""GitHub public-repository source.

Reads *public* signal only: the GitHub search API plus public repo READMEs. It
never touches private data and never probes a running system. Implemented on
the standard library (urllib) so the core stays dependency-free; pass a token
(or set GITHUB_TOKEN) to lift the low unauthenticated rate limit.

    src = GitHubSource(query="agent framework in:readme", max_results=30)
    for doc in src.fetch():
        ...

The HTTP-free mapping lives in `github_repo_to_doc` so it can be unit-tested
against fixture JSON without a network call.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterator, List, Optional

from ..models import RawDoc
from .base import Source

API = "https://api.github.com"


def github_repo_to_doc(item: Dict, readme: str = "") -> RawDoc:
    """Map one repository search result (+ optional README) to a RawDoc.

    The owner login becomes the company (entity resolution normalises it, so
    ``tessellate-ai`` merges with ``Tessellate AI`` from other sources).
    """
    owner = str((item.get("owner") or {}).get("login") or "")
    full_name = str(item.get("full_name") or owner or "unknown")
    description = str(item.get("description") or "")
    topics = " ".join(item.get("topics") or [])
    text = "\n".join(p for p in (description, topics, readme) if p)
    return RawDoc(
        source="github",
        url=str(item.get("html_url") or f"https://github.com/{full_name}"),
        title=full_name,
        text=text or full_name,
        company=owner or None,
        meta={
            "full_name": full_name,
            "stars": str(item.get("stargazers_count", 0)),
            "language": str(item.get("language") or ""),
        },
    )


class RateLimited(RuntimeError):
    """Raised (and handled internally) when GitHub returns a rate-limit error."""


class GitHubSource(Source):
    name = "github"

    def __init__(
        self,
        query: str = "ai agent framework in:name,description,readme",
        token: Optional[str] = None,
        max_results: int = 30,
        per_page: int = 30,
        fetch_readme: bool = True,
        timeout: int = 20,
    ) -> None:
        self.query = query
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.max_results = max_results
        self.per_page = min(per_page, 100)
        self.fetch_readme = fetch_readme
        self.timeout = timeout

    # --- HTTP --------------------------------------------------------------
    def _headers(self, accept: str) -> Dict[str, str]:
        h = {
            "Accept": accept,
            "User-Agent": "agentscope",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _get(self, url: str, accept: str) -> Optional[bytes]:
        req = urllib.request.Request(url, headers=self._headers(accept))
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None  # e.g. repo has no README
            if exc.code in (403, 429) and exc.headers.get("X-RateLimit-Remaining") == "0":
                raise RateLimited(
                    "GitHub rate limit hit; set GITHUB_TOKEN to raise it."
                ) from exc
            raise RuntimeError(f"GitHub API {exc.code} for {url}: {exc.reason}") from exc

    def _search_page(self, page: int) -> List[Dict]:
        params = urllib.parse.urlencode({
            "q": self.query, "sort": "stars", "order": "desc",
            "per_page": self.per_page, "page": page,
        })
        body = self._get(f"{API}/search/repositories?{params}",
                         "application/vnd.github+json")
        if not body:
            return []
        return json.loads(body.decode()).get("items", [])

    def _readme(self, full_name: str) -> str:
        body = self._get(f"{API}/repos/{full_name}/readme",
                         "application/vnd.github.raw")
        return body.decode("utf-8", "replace")[:8000] if body else ""

    # --- Source ------------------------------------------------------------
    def fetch(self) -> Iterator[RawDoc]:
        fetched, page = 0, 1
        while fetched < self.max_results:
            try:
                items = self._search_page(page)
            except RateLimited:
                break  # stop gracefully; caller keeps whatever was yielded
            if not items:
                break
            for item in items:
                if fetched >= self.max_results:
                    break
                readme = ""
                if self.fetch_readme:
                    try:
                        readme = self._readme(str(item.get("full_name") or ""))
                    except (RateLimited, RuntimeError):
                        readme = ""  # description alone is still useful signal
                yield github_repo_to_doc(item, readme)
                fetched += 1
            if len(items) < self.per_page:
                break  # last page
            page += 1
