"""Zero-dependency smoke tests for the AgentScope funnel.

Runs under the stdlib: `python -m unittest discover -s tests`.
Uses a temp SQLite file so it never touches a real store.
"""

from __future__ import annotations

import os
import tempfile
import unittest

from agentscope.classify.classifier import KeywordClassifier, get_classifier
from agentscope.config import DEFAULT_CONFIG
from agentscope.models import RawDoc
from agentscope.pipeline.jobs import JobRunner
from agentscope.pipeline.prefilter import prefilter
from agentscope.sources.demo import DemoSource
from agentscope.store.db import Store


class TempStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.remove(self.path)
        self.store = Store(self.path)

    def tearDown(self) -> None:
        self.store.close()
        if os.path.exists(self.path):
            os.remove(self.path)


class PrefilterTests(unittest.TestCase):
    def test_strong_doc_passes(self) -> None:
        doc = RawDoc(source="t", url="u1", title="AI Agent Engineer",
                     text="We run autonomous agents in production; guardrails matter.")
        pf = prefilter(doc)
        self.assertTrue(pf.passed)
        self.assertGreaterEqual(pf.agent_hits(), 1)

    def test_irrelevant_doc_dropped(self) -> None:
        doc = RawDoc(source="t", url="u2", title="Bakery Menu",
                     text="Fresh sourdough and cinnamon rolls daily.")
        self.assertFalse(prefilter(doc).passed)

    def test_agent_mention_without_second_signal_dropped(self) -> None:
        # A single agent_tech hit and no other signal -> below the total floor.
        doc = RawDoc(source="t", url="u3", title="Blog",
                     text="We use langchain for a weekend prototype.")
        pf = prefilter(doc)
        self.assertEqual(pf.agent_hits(), 1)
        self.assertEqual(pf.total_hits, 1)
        self.assertFalse(pf.passed)  # needs >= 2 total hits


class ClassifierTests(unittest.TestCase):
    def test_keyword_classifier_flags_prospect(self) -> None:
        doc = RawDoc(source="t", url="u", title="ML Engineer",
                     text="Own our agentic platform in production; fix hallucinations "
                          "with guardrails and an evaluation harness.")
        cl = KeywordClassifier().classify(doc)
        self.assertTrue(cl.relevant)
        self.assertIn("agent_tech", cl.labels)
        self.assertIn("pain", cl.labels)
        self.assertGreater(cl.confidence, DEFAULT_CONFIG.thresholds.classify_min_confidence)

    def test_factory_unknown_backend_raises(self) -> None:
        with self.assertRaises(ValueError):
            get_classifier("nope")


class EndToEndTests(TempStoreTest):
    def test_full_funnel_produces_ranked_candidates(self) -> None:
        runner = JobRunner(self.store, DemoSource())
        self.assertTrue(runner.run())
        counts = self.store.counts()
        self.assertEqual(counts["raw_docs"], 20)
        # Funnel must narrow: fewer survivors than ingested, some candidates.
        self.assertLess(counts["survivors"], counts["raw_docs"])
        self.assertGreater(counts["candidates"], 0)

        top = self.store.top_candidates(limit=100)
        self.assertTrue(top)
        # Scores must be within range and sorted descending.
        scores = [c.score for c in top]
        self.assertEqual(scores, sorted(scores, reverse=True))
        for c in top:
            self.assertGreaterEqual(c.score, 0)
            self.assertLessEqual(c.score, 100)
        # The strongest fixture (agent + scale + pain) should top the list.
        self.assertEqual(top[0].tier, "A")

    def test_stop_control_interrupts_run(self) -> None:
        def prog(stage: str, _msg: str) -> None:
            if stage == "ingest":
                runner.request_stop()
        runner = JobRunner(self.store, DemoSource(), progress=prog)
        self.assertFalse(runner.run())          # interrupted
        counts = self.store.counts()
        self.assertEqual(counts["raw_docs"], 20)   # ingest finished
        self.assertEqual(counts["survivors"], 0)   # prefilter never ran

    def test_partial_stage_run(self) -> None:
        runner = JobRunner(self.store, DemoSource())
        runner.run(stages=["ingest", "prefilter"])
        counts = self.store.counts()
        self.assertEqual(counts["raw_docs"], 20)
        self.assertEqual(counts["relevant"], 0)     # classify not run
        self.assertEqual(counts["candidates"], 0)


if __name__ == "__main__":
    unittest.main()
