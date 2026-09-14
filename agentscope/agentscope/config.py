"""Central configuration for AgentScope.

Everything tunable about the funnel lives here: the signal vocabulary the
prefilter and keyword classifier key off, the scoring weights, and the
thresholds that gate each stage. Keeping it in one place means the pipeline
can be re-tuned without touching pipeline code, and makes it obvious that we
only ever look at *public* signal (job posts, repos, company/product pages,
funding notes, Common Crawl). Nothing here probes, scans, or tests anyone's
systems.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


# ---------------------------------------------------------------------------
# Signal vocabulary
# ---------------------------------------------------------------------------
# Each category is a bucket of lowercased phrases we search for in document
# text. Categories are scored independently and combined with the weights
# below, so a company that only *builds* agents scores differently from one
# that is visibly *struggling to make them reliable* (our best prospects).

SIGNALS: Dict[str, List[str]] = {
    # They are actually building / deploying agents.
    "agent_tech": [
        "ai agent", "ai agents", "autonomous agent", "agentic", "agent framework",
        "multi-agent", "multi agent", "llm agent", "tool-calling", "tool calling",
        "function calling", "langchain", "langgraph", "llamaindex", "autogen",
        "crewai", "semantic kernel", "openai assistants", "bedrock agents",
        "vertex ai agent", "agent orchestration", "retrieval augmented",
        "rag pipeline", "agent workflow", "copilot", "ai copilot",
    ],
    # They are running it for real, at scale.
    "scale": [
        "in production", "at scale", "production traffic", "millions of requests",
        "high throughput", "enterprise customers", "24/7", "sla", "five nines",
        "low latency", "distributed system", "kubernetes", "production-grade",
        "mission critical", "customer facing",
    ],
    # They are investing (hiring for it) — a leading indicator.
    "hiring": [
        "ai engineer", "ml engineer", "machine learning engineer", "llm engineer",
        "applied ai", "applied scientist", "agent engineer", "prompt engineer",
        "we are hiring", "we're hiring", "join our team", "looking for",
    ],
    # They feel the pain we solve: reliability / safety / evaluation of agents.
    # High weight — this is what qualifies a lead, not just identifies one.
    "pain": [
        "hallucination", "hallucinations", "guardrails", "evaluation harness",
        "model evaluation", "evals", "red team", "red-teaming", "reliability",
        "trust and safety", "ai safety", "alignment", "prompt injection",
        "jailbreak", "observability", "monitoring", "regression testing",
        "quality assurance", "human in the loop", "human-in-the-loop",
        "non-deterministic", "flaky", "test harness",
    ],
}


@dataclass(frozen=True)
class ScoringConfig:
    """Weights and saturation points for turning signal hits into a score."""

    # Relative importance of each category. Summed weights need not be 1.0;
    # the final score is normalised against the max achievable.
    weights: Dict[str, float] = field(
        default_factory=lambda: {
            "agent_tech": 0.35,
            "pain": 0.30,
            "scale": 0.20,
            "hiring": 0.15,
        }
    )
    # How many distinct hits in a category count as "fully saturated" (1.0).
    # Beyond this, more hits do not raise the sub-score — avoids keyword spam.
    saturation: Dict[str, int] = field(
        default_factory=lambda: {
            "agent_tech": 4,
            "pain": 3,
            "scale": 3,
            "hiring": 2,
        }
    )
    # Score (0-100) cut-offs for prospect tiers.
    tier_a: int = 70
    tier_b: int = 45
    tier_c: int = 25


@dataclass(frozen=True)
class ThresholdConfig:
    """Gates between funnel stages."""

    # Prefilter: a doc must reference agent tech at least this many times AND
    # clear the total-hit floor to survive. This is the cheap ~95% cull.
    prefilter_min_agent_hits: int = 1
    prefilter_min_total_hits: int = 2
    # Classification: minimum confidence for a doc to be treated as relevant.
    classify_min_confidence: float = 0.4


@dataclass(frozen=True)
class Config:
    signals: Dict[str, List[str]] = field(default_factory=lambda: SIGNALS)
    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    thresholds: ThresholdConfig = field(default_factory=ThresholdConfig)
    db_path: str = "agentscope.db"


# A ready-to-use default; callers may build their own Config to override.
DEFAULT_CONFIG = Config()


def all_signal_phrases(signals: Dict[str, List[str]] | None = None) -> List[str]:
    """Flat list of every phrase across all categories (deduplicated)."""
    signals = signals or SIGNALS
    seen: List[str] = []
    for phrases in signals.values():
        for p in phrases:
            if p not in seen:
                seen.append(p)
    return seen
