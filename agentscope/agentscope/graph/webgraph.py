"""Domain-level hyperlink graph and structural analysis.

Loads a directed domain graph in the Web Data Commons layout — a vertices file
(`id  domain`) and an edges file (`src_id  dst_id`) — so a real WDC host/domain
graph drops in by path. Structure only: nodes are domains and edges are "this
domain links to that one"; no page content is stored.

Everything here is pure standard library so it stays dependency-free. Power
iteration is O(edges) per step, fine for the sample and for graphs up to a few
million edges; for the full WDC graph (billions of edges) use the precomputed
WDC ranks or a compiled graph library and feed the results in.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Tuple


class WebGraph:
    def __init__(self) -> None:
        self.out: Dict[str, set] = defaultdict(set)
        self.inn: Dict[str, set] = defaultdict(set)
        self.nodes: set = set()
        self.labels: Dict[str, str] = {}   # domain -> category (optional)

    # --- construction ------------------------------------------------------
    def add_edge(self, src: str, dst: str) -> None:
        if src == dst:
            return
        self.nodes.add(src); self.nodes.add(dst)
        self.out[src].add(dst); self.inn[dst].add(src)

    @classmethod
    def load(cls, vertices_path: str, edges_path: str,
             labels_path: Optional[str] = None) -> "WebGraph":
        g = cls()
        id_to_domain: Dict[str, str] = {}
        with open(vertices_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                vid, domain = line.split(None, 1)
                id_to_domain[vid] = domain.strip()
                g.nodes.add(domain.strip())
        with open(edges_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                s, d = line.split()[:2]
                if s in id_to_domain and d in id_to_domain:
                    g.add_edge(id_to_domain[s], id_to_domain[d])
        if labels_path:
            with open(labels_path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split(None, 2)
                    if len(parts) >= 3:
                        g.labels[parts[1].strip()] = parts[2].strip()
        return g

    # --- basic structure ---------------------------------------------------
    def order(self) -> int:
        return len(self.nodes)

    def size(self) -> int:
        return sum(len(v) for v in self.out.values())

    def in_degree(self, domain: str) -> int:
        return len(self.inn.get(domain, ()))

    def out_degree(self, domain: str) -> int:
        return len(self.out.get(domain, ()))

    def neighbors(self, domain: str, direction: str = "out") -> List[str]:
        src = self.out if direction == "out" else self.inn
        return sorted(src.get(domain, ()))

    # --- centrality --------------------------------------------------------
    def pagerank(self, damping: float = 0.85, iters: int = 100,
                 tol: float = 1e-9, teleport: Optional[Dict[str, float]] = None
                 ) -> Dict[str, float]:
        """PageRank via power iteration. Pass `teleport` (a distribution over
        nodes) for personalized PageRank; defaults to uniform."""
        nodes = list(self.nodes)
        n = len(nodes)
        if n == 0:
            return {}
        if teleport is None:
            teleport = {v: 1.0 / n for v in nodes}
        pr = {v: teleport.get(v, 0.0) for v in nodes}
        outdeg = {v: len(self.out.get(v, ())) for v in nodes}
        for _ in range(iters):
            dangling = sum(pr[v] for v in nodes if outdeg[v] == 0)
            new = {v: (1.0 - damping) * teleport.get(v, 0.0)
                      + damping * dangling * teleport.get(v, 0.0) for v in nodes}
            for v in nodes:
                if outdeg[v]:
                    share = damping * pr[v] / outdeg[v]
                    for w in self.out[v]:
                        new[w] += share
            diff = sum(abs(new[v] - pr[v]) for v in nodes)
            pr = new
            if diff < tol:
                break
        return pr

    def top(self, n: int = 20, by: str = "pagerank") -> List[Tuple[str, float]]:
        if by == "pagerank":
            scores = self.pagerank()
        elif by == "in_degree":
            scores = {v: float(self.in_degree(v)) for v in self.nodes}
        else:
            raise ValueError(f"unknown ranking {by!r}")
        return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:n]

    # --- discovery ---------------------------------------------------------
    def similar_to(self, seeds: Iterable[str], k: int = 10
                   ) -> List[Tuple[str, float]]:
        """Peer discovery: rank non-seed domains by how much their out-link set
        overlaps the seeds' (cosine over shared targets). Surfaces companies
        that lean on the same stack as the ones you already know — good for
        finding more prospects like your known ones.
        """
        seeds = [s for s in seeds if s in self.nodes]
        if not seeds:
            return []
        seed_set = set(seeds)
        scores: Dict[str, float] = defaultdict(float)
        for cand in self.nodes:
            if cand in seed_set:
                continue
            cand_out = self.out.get(cand, set())
            if not cand_out:
                continue
            total = 0.0
            for s in seeds:
                s_out = self.out.get(s, set())
                if not s_out:
                    continue
                shared = len(cand_out & s_out)
                if shared:
                    total += shared / math.sqrt(len(cand_out) * len(s_out))
            if total > 0:
                scores[cand] = total / len(seeds)
        return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]

    def shared_targets(self, a: str, b: str) -> List[str]:
        return sorted(self.out.get(a, set()) & self.out.get(b, set()))
