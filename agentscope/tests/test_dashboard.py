"""Tests for the crawl dataset source, funnel over it, and dashboard render."""

from __future__ import annotations

import os
import tempfile
import unittest

from agentscope.pipeline.jobs import JobRunner
from agentscope.report.dashboard import render
from agentscope.sources.dataset import GitHubDatasetSource
from agentscope.store.db import Store

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CRAWL = os.path.join(_ROOT, "demo_data", "github_crawl.json")


class DatasetSourceTests(unittest.TestCase):
    def test_reads_crawl_snapshot(self) -> None:
        src = GitHubDatasetSource(_CRAWL)
        docs = list(src.fetch())
        self.assertGreater(len(docs), 20)
        self.assertTrue(all(d.source == "github" for d in docs))
        self.assertTrue(all(d.company for d in docs))
        meta = src.metadata()
        self.assertIn("crawled_at", meta)
        self.assertIn("queries", meta)


class FunnelOverCrawlTests(unittest.TestCase):
    def setUp(self) -> None:
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd); os.remove(self.path)
        self.store = Store(self.path)
        JobRunner(self.store, GitHubDatasetSource(_CRAWL)).run()

    def tearDown(self) -> None:
        self.store.close()
        if os.path.exists(self.path):
            os.remove(self.path)

    def test_funnel_narrows_and_culls_noise(self) -> None:
        counts = self.store.counts()
        self.assertGreater(counts["raw_docs"], counts["survivors"])  # prefilter culls
        self.assertGreater(counts["candidates"], 0)
        companies = {c.company for c in self.store.top_candidates(limit=1000)}
        # Pure-inference repos carry no agent signal and must be dropped.
        self.assertNotIn("ggml-org", companies)      # llama.cpp
        self.assertNotIn("vllm-project", companies)   # vllm
        # A real agent framework org should survive and be scored.
        self.assertIn("microsoft", companies)

    def test_scores_in_range_and_sorted(self) -> None:
        cands = self.store.top_candidates(limit=1000)
        scores = [c.score for c in cands]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0 <= s <= 100 for s in scores))


class RenderTests(unittest.TestCase):
    def _sample(self):
        candidates = [{
            "company": "microsoft", "score": 37, "tier": "C",
            "category_scores": {"agent_tech": 1.0, "pain": 0.0, "scale": 0.0, "hiring": 0.0},
            "aliases": ["microsoft"], "stars": 60983, "language": "Python",
            "evidence": [{"url": "https://github.com/microsoft/autogen", "name": "microsoft/autogen"}],
        }]
        counts = {"raw_docs": 33, "prefiltered": 33, "survivors": 18, "relevant": 18, "candidates": 15}
        tiers = {"C": 10, "watch": 5}
        culled = [{"title": "ggml-org/llama.cpp", "reason": "no agent-tech signal"}]
        meta = {"crawled_at": "2026-09-14", "source": "github_search", "queries": ["a", "b"]}
        return candidates, counts, tiers, culled, meta

    def test_standalone_is_full_document(self) -> None:
        html_doc = render(*self._sample(), mode="standalone")
        self.assertTrue(html_doc.lstrip().lower().startswith("<!doctype html>"))
        self.assertIn("microsoft/autogen", html_doc)
        self.assertIn("37", html_doc)
        self.assertIn("ggml-org/llama.cpp", html_doc)   # culled shown

    def test_artifact_mode_has_no_html_wrapper(self) -> None:
        html_frag = render(*self._sample(), mode="artifact")
        self.assertTrue(html_frag.lstrip().startswith("<title>"))
        self.assertNotIn("<html", html_frag.lower())
        self.assertNotIn("<body", html_frag.lower())


if __name__ == "__main__":
    unittest.main()
