"""Tests for company-entity resolution and its effect on scoring."""

from __future__ import annotations

import os
import tempfile
import unittest

from agentscope.pipeline.entities import (
    choose_display, group_by_entity, normalize_company,
)
from agentscope.pipeline.jobs import JobRunner
from agentscope.sources.demo import DemoSource
from agentscope.store.db import Store


class NormalizeTests(unittest.TestCase):
    def test_separator_forms_collapse(self) -> None:
        self.assertEqual(normalize_company("tessellate-ai"),
                         normalize_company("Tessellate AI"))
        self.assertEqual(normalize_company("tessellate_ai"), "tessellate ai")

    def test_legal_suffixes_stripped(self) -> None:
        self.assertEqual(normalize_company("Nimbus Robotics, Inc."), "nimbus robotics")
        self.assertEqual(normalize_company("Foo Co Ltd"), "foo")

    def test_suffix_word_not_at_end_is_kept(self) -> None:
        self.assertEqual(normalize_company("Company Cabs"), "company cabs")

    def test_empty(self) -> None:
        self.assertEqual(normalize_company(None), "")
        self.assertEqual(normalize_company(""), "")


class DisplayTests(unittest.TestCase):
    def test_prefers_proper_name(self) -> None:
        self.assertEqual(choose_display(["tessellate-ai", "Tessellate AI"]),
                         "Tessellate AI")
        self.assertEqual(choose_display(["acme", "ACME Corp", "Acme Widgets"]),
                         "Acme Widgets")

    def test_group_by_entity(self) -> None:
        names = ["Acme Inc", "acme", "Other Co"]
        groups = group_by_entity(names, name_of=lambda x: x)
        self.assertEqual(sorted(groups), ["acme", "other"])
        self.assertEqual(len(groups["acme"]), 2)


class MergeInPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd); os.remove(self.path)
        self.store = Store(self.path)

    def tearDown(self) -> None:
        self.store.close()
        if os.path.exists(self.path):
            os.remove(self.path)

    def test_surface_forms_merge_into_one_candidate(self) -> None:
        # The demo corpus has the same company as "tessellate-ai" (github owner)
        # and "Tessellate AI" (job post). They must resolve to one candidate.
        JobRunner(self.store, DemoSource()).run()
        matches = [c for c in self.store.top_candidates(limit=100)
                   if c.canonical == "tessellate ai"]
        self.assertEqual(len(matches), 1, "surface forms should merge")
        cand = matches[0]
        self.assertEqual(cand.company, "Tessellate AI")           # display
        self.assertEqual(len(cand.doc_ids), 2)                    # both docs
        self.assertIn("tessellate-ai", cand.aliases)
        self.assertIn("Tessellate AI", cand.aliases)


if __name__ == "__main__":
    unittest.main()
