"""Offline tests for the GitHub source: mapping and fetch loop (no network)."""

from __future__ import annotations

import unittest
from typing import Dict, List

from agentscope.sources.github import GitHubSource, github_repo_to_doc

_REPO = {
    "full_name": "tessellate-ai/agents",
    "html_url": "https://github.com/tessellate-ai/agents",
    "description": "Multi-agent framework with tool calling.",
    "topics": ["ai", "agents", "llm"],
    "language": "Python",
    "stargazers_count": 1234,
    "owner": {"login": "tessellate-ai"},
}


class MappingTests(unittest.TestCase):
    def test_repo_to_doc(self) -> None:
        doc = github_repo_to_doc(_REPO, readme="Install and run the agent.")
        self.assertEqual(doc.source, "github")
        self.assertEqual(doc.company, "tessellate-ai")     # owner login
        self.assertEqual(doc.title, "tessellate-ai/agents")
        self.assertEqual(doc.url, "https://github.com/tessellate-ai/agents")
        self.assertIn("Multi-agent framework", doc.text)   # description
        self.assertIn("llm", doc.text)                     # topics
        self.assertIn("Install and run", doc.text)         # readme
        self.assertEqual(doc.meta["stars"], "1234")
        self.assertEqual(doc.meta["language"], "Python")

    def test_missing_fields_are_safe(self) -> None:
        doc = github_repo_to_doc({"full_name": "x/y"})
        self.assertEqual(doc.title, "x/y")
        self.assertTrue(doc.text)  # falls back to full_name, never empty


class FetchLoopTests(unittest.TestCase):
    def test_fetch_paginates_and_caps(self) -> None:
        # Stub the HTTP layer: two pages of repos, empty README.
        def repo(i: int) -> Dict:
            return dict(_REPO, full_name=f"o{i}/r{i}", owner={"login": f"o{i}"},
                        html_url=f"https://github.com/o{i}/r{i}")

        pages: Dict[int, List[Dict]] = {
            1: [repo(i) for i in range(30)],
            2: [repo(i) for i in range(30, 45)],
        }

        class FakeGitHub(GitHubSource):
            def _search_page(self, page: int) -> List[Dict]:
                return pages.get(page, [])

            def _readme(self, full_name: str) -> str:
                return ""

        src = FakeGitHub(max_results=40, per_page=30)
        docs = list(src.fetch())
        self.assertEqual(len(docs), 40)                 # capped at max_results
        self.assertEqual(docs[0].company, "o0")
        self.assertEqual(len({d.doc_id for d in docs}), 40)  # all distinct


if __name__ == "__main__":
    unittest.main()
