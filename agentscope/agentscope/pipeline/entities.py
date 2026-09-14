"""Company-entity resolution.

The same company shows up under different surface forms across public sources:
a GitHub owner login (``tessellate-ai``), a careers-page name (``Tessellate AI``),
a legal name (``Nimbus Robotics, Inc.``). Before scoring we collapse these to a
single canonical key so their signals aggregate into one candidate instead of
several weak duplicates.

The resolution here is deliberately deterministic and dependency-free:
separator + punctuation normalisation plus trailing legal-suffix stripping.
It is intentionally conservative (it will *not* merge two genuinely different
companies); fuzzier matching can layer on later without changing callers.
"""

from __future__ import annotations

import re
from typing import Iterable, List

# Trailing tokens that are legal/organisational noise, not identity. Stripped
# only when they appear at the END of the name so we never eat a real word
# (e.g. "Company" in "Company Cabs" stays; "Cabs Company" loses "company").
LEGAL_SUFFIXES = {
    "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation",
    "co", "company", "gmbh", "ag", "plc", "sa", "bv", "pty", "srl", "oy",
    "holdings", "holding", "group",
}

_PUNCT = re.compile(r"[^a-z0-9]+")


def normalize_company(name: str | None) -> str:
    """Canonical key for a company name. Empty string for no name.

    ``"tessellate-ai"`` and ``"Tessellate AI"`` both -> ``"tessellate ai"``;
    ``"Nimbus Robotics, Inc."`` -> ``"nimbus robotics"``.
    """
    if not name:
        return ""
    # Lowercase; turn any run of non-alphanumerics (hyphens, underscores,
    # commas, dots, slashes, whitespace) into single spaces.
    tokens = _PUNCT.sub(" ", name.lower()).split()
    # Strip trailing legal-suffix tokens (possibly several: "foo co ltd").
    while len(tokens) > 1 and tokens[-1] in LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def choose_display(names: Iterable[str]) -> str:
    """Pick the most human-friendly surface form from a set of aliases.

    Prefers more words, then proper mixed casing over all-caps/all-lower, then
    length. So {"tessellate-ai", "Tessellate AI"} -> "Tessellate AI" and
    {"acme", "ACME Corp", "Acme Widgets"} -> "Acme Widgets".
    """
    candidates = [n for n in names if n and n.strip()]
    if not candidates:
        return ""

    def key(n: str) -> tuple:
        words = len(n.split())
        proper = 1 if (any(c.isupper() for c in n) and any(c.islower() for c in n)) else 0
        return (words, proper, len(n))

    return max(candidates, key=key)


def group_by_entity(items: Iterable, name_of) -> dict:
    """Group ``items`` by canonical company key.

    ``name_of(item)`` returns the raw company name for an item. Returns
    ``{canonical: [items]}`` skipping items whose name normalises to empty.
    """
    groups: dict = {}
    for it in items:
        canonical = normalize_company(name_of(it))
        if not canonical:
            continue
        groups.setdefault(canonical, []).append(it)
    return groups
