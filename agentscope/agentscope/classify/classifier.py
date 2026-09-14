"""Stage 4: classify prefilter survivors.

Every backend returns the same `Classification`, so the funnel is agnostic to
which one runs. Cost climbs left to right; pick the cheapest that meets your
precision bar:

  KeywordClassifier  - free, deterministic, no deps. Good default + baseline.
  OllamaClassifier   - local LLM via Ollama HTTP. No API cost, needs Ollama.
  ApiClassifier      - hosted LLM (e.g. Anthropic/Bedrock). Best quality, $$.

The Ollama and API backends lazy-import their clients and fall back cleanly so
that importing this module (and running the demo) never requires them.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import List, Optional

from ..config import Config, DEFAULT_CONFIG
from ..models import Classification, RawDoc


class Classifier(ABC):
    backend: str = "base"

    @abstractmethod
    def classify(self, doc: RawDoc) -> Classification: ...


class KeywordClassifier(Classifier):
    """Deterministic classifier driven by the config vocabulary.

    Relevance and confidence come from how many categories the doc lights up
    and how strongly. This is free and makes a solid baseline the LLM backends
    have to beat.
    """

    backend = "keyword"

    def __init__(self, config: Config = DEFAULT_CONFIG) -> None:
        self.config = config

    def classify(self, doc: RawDoc) -> Classification:
        text = f"{doc.title}\n{doc.text}".lower()
        labels: List[str] = []
        category_hits = 0
        agent = pain = 0
        for cat, phrases in self.config.signals.items():
            matched = [p for p in phrases if p in text]
            if matched:
                labels.append(cat)
                category_hits += 1
                if cat == "agent_tech":
                    agent = len(matched)
                elif cat == "pain":
                    pain = len(matched)

        # Confidence: needs agent tech to be relevant at all; pain + breadth
        # across categories raise confidence (that's our qualified prospect).
        if agent == 0:
            confidence = 0.15
        else:
            confidence = min(
                1.0,
                0.4 + 0.12 * category_hits + 0.08 * min(agent, 3) + 0.1 * min(pain, 3),
            )
        relevant = confidence >= self.config.thresholds.classify_min_confidence
        rationale = (
            f"agent_tech hits={agent}, pain hits={pain}, "
            f"categories={category_hits} -> conf={confidence:.2f}"
        )
        return Classification(
            doc_id=doc.doc_id, relevant=relevant, confidence=round(confidence, 3),
            labels=labels, backend=self.backend, rationale=rationale,
            company=doc.company,
        )


_LLM_INSTRUCTIONS = (
    "You classify whether a public document indicates a company is deploying "
    "AI agents at meaningful scale and would benefit from agent-testing / "
    "AI-safety services. Respond with STRICT JSON: "
    '{"relevant": bool, "confidence": 0..1, "labels": [str], "rationale": str}. '
    "Labels may include: agent_tech, scale, hiring, pain."
)


def _build_prompt(doc: RawDoc) -> str:
    return (
        f"{_LLM_INSTRUCTIONS}\n\n"
        f"TITLE: {doc.title}\nCOMPANY: {doc.company or 'unknown'}\n"
        f"TEXT:\n{doc.text[:4000]}\n\nJSON:"
    )


def _parse_llm_json(raw: str, doc: RawDoc, backend: str) -> Classification:
    try:
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start : end + 1])
    except Exception:
        # Unparseable model output -> treat as low-confidence, not a crash.
        return Classification(
            doc_id=doc.doc_id, relevant=False, confidence=0.0, labels=[],
            backend=backend, rationale=f"unparseable model output: {raw[:120]!r}",
            company=doc.company,
        )
    return Classification(
        doc_id=doc.doc_id,
        relevant=bool(data.get("relevant", False)),
        confidence=float(data.get("confidence", 0.0)),
        labels=list(data.get("labels", [])),
        backend=backend,
        rationale=str(data.get("rationale", "")),
        company=doc.company,
    )


class OllamaClassifier(Classifier):
    """Local LLM via an Ollama server (default http://localhost:11434)."""

    backend = "ollama"

    def __init__(self, model: str = "llama3", host: str = "http://localhost:11434",
                 config: Config = DEFAULT_CONFIG) -> None:
        self.model = model
        self.host = host.rstrip("/")
        self.config = config
        self.backend = f"ollama:{model}"

    def classify(self, doc: RawDoc) -> Classification:
        import urllib.request  # stdlib; no extra dep

        payload = json.dumps({
            "model": self.model,
            "prompt": _build_prompt(doc),
            "stream": False,
            "format": "json",
        }).encode()
        req = urllib.request.Request(
            f"{self.host}/api/generate", data=payload,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode())
            return _parse_llm_json(body.get("response", ""), doc, self.backend)
        except Exception as exc:  # server down / model missing -> caller can fall back
            raise RuntimeError(f"Ollama request failed: {exc}") from exc


class ApiClassifier(Classifier):
    """Hosted LLM backend (Anthropic-style). Requires the SDK + an API key.

    Kept as a thin, clearly-marked seam; not exercised by the demo. Swap the
    client for a Bedrock runtime call to move this to AWS without touching the
    rest of the pipeline.
    """

    backend = "api"

    def __init__(self, model: str = "claude-haiku-4-5-20251001",
                 config: Config = DEFAULT_CONFIG) -> None:
        self.model = model
        self.config = config
        self.backend = f"api:{model}"

    def classify(self, doc: RawDoc) -> Classification:
        try:
            import anthropic  # optional dep, see requirements [api]
        except ImportError as exc:
            raise RuntimeError(
                "ApiClassifier needs the 'anthropic' package (pip install anthropic)."
            ) from exc
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model=self.model,
            max_tokens=300,
            messages=[{"role": "user", "content": _build_prompt(doc)}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content)
        return _parse_llm_json(text, doc, self.backend)


_BACKENDS = {
    "keyword": KeywordClassifier,
    "ollama": OllamaClassifier,
    "api": ApiClassifier,
}


def get_classifier(name: str = "keyword", **kwargs: object) -> Classifier:
    """Factory: `get_classifier("keyword")`, `("ollama", model="llama3")`, ..."""
    try:
        cls = _BACKENDS[name]
    except KeyError:
        raise ValueError(
            f"unknown classifier {name!r}; choose from {sorted(_BACKENDS)}"
        )
    return cls(**kwargs)  # type: ignore[arg-type]
