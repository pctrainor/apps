"""Tests for the domain hyperlink graph and structural analysis."""

from __future__ import annotations

import os
import unittest

from agentscope.graph.webgraph import WebGraph

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_WG = os.path.join(_ROOT, "demo_data", "webgraph")


class LoadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.g = WebGraph.load(
            os.path.join(_WG, "vertices.txt"),
            os.path.join(_WG, "edges.txt"),
            os.path.join(_WG, "labels.txt"),
        )

    def test_loads_nodes_edges_labels(self) -> None:
        self.assertEqual(self.g.order(), 27)
        self.assertGreater(self.g.size(), 50)
        self.assertEqual(self.g.labels["github.com"], "hub")
        self.assertEqual(self.g.labels["sierra.ai"], "agent_company")

    def test_directed_edges(self) -> None:
        # sierra.ai -> openai.com exists; the reverse does not.
        self.assertIn("openai.com", self.g.neighbors("sierra.ai", "out"))
        self.assertNotIn("sierra.ai", self.g.neighbors("openai.com", "out"))
        self.assertIn("sierra.ai", self.g.neighbors("openai.com", "in"))


class PageRankTests(unittest.TestCase):
    def setUp(self) -> None:
        self.g = WebGraph.load(os.path.join(_WG, "vertices.txt"),
                               os.path.join(_WG, "edges.txt"))

    def test_pagerank_is_a_distribution(self) -> None:
        pr = self.g.pagerank()
        self.assertAlmostEqual(sum(pr.values()), 1.0, places=4)
        self.assertTrue(all(v >= 0 for v in pr.values()))

    def test_hub_ranks_first(self) -> None:
        top = self.g.top(3, by="pagerank")
        self.assertEqual(top[0][0], "github.com")  # most linked-to

    def test_in_degree_ranking(self) -> None:
        top = dict(self.g.top(27, by="in_degree"))
        self.assertEqual(top["github.com"], float(self.g.in_degree("github.com")))


class DiscoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.g = WebGraph.load(os.path.join(_WG, "vertices.txt"),
                               os.path.join(_WG, "edges.txt"),
                               os.path.join(_WG, "labels.txt"))

    def test_similar_surfaces_peer_company(self) -> None:
        results = self.g.similar_to(["sierra.ai", "cognition.ai"], k=10)
        domains = [d for d, _ in results]
        self.assertIn("decagon.ai", domains)          # a peer agent company
        self.assertNotIn("sierra.ai", domains)         # seeds excluded
        self.assertNotIn("cognition.ai", domains)

    def test_scores_descending(self) -> None:
        results = self.g.similar_to(["sierra.ai"], k=10)
        scores = [s for _, s in results]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_empty_seeds(self) -> None:
        self.assertEqual(self.g.similar_to(["nonexistent.example"], k=5), [])

    def test_shared_targets(self) -> None:
        shared = self.g.shared_targets("sierra.ai", "decagon.ai")
        self.assertIn("openai.com", shared)


if __name__ == "__main__":
    unittest.main()


class MapRenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.g = WebGraph.load(os.path.join(_WG, "vertices.txt"),
                               os.path.join(_WG, "edges.txt"),
                               os.path.join(_WG, "labels.txt"))

    def test_render_modes(self) -> None:
        from agentscope.report.graphmap import render
        pr = self.g.pagerank()
        disc = self.g.similar_to(["sierra.ai"], k=5)
        standalone = render(self.g, pr, ["sierra.ai"], disc, mode="standalone")
        self.assertTrue(standalone.lstrip().lower().startswith("<!doctype html>"))
        self.assertIn("<svg", standalone)
        self.assertIn("github.com", standalone)
        artifact = render(self.g, pr, ["sierra.ai"], disc, mode="artifact")
        self.assertTrue(artifact.lstrip().startswith("<title>"))
        self.assertNotIn("<html", artifact.lower())
