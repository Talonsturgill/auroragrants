"""Hallucinated-program check.

Scan the draft for capitalized phrases that look like grant program
names (matching the pattern `<Capitalized Phrase> (Program|Initiative|
Award|Grant|Fund)`). For each hit, resolve it against two allowlists:

  1. The funder graph's `known_programs` list (passed in as a fixture
     loaded from /docs/04-funder-graph.md).
  2. The chunks retrieved for the draft (any mention of the program in
     any retrieved chunk counts as grounded).

A mention that appears in neither list is a hallucination. The score
is 1.0 when there are zero hallucinations. Otherwise the score is
`1 - (hallucinated / total)`, which lets the caller see the failure
magnitude even though any non-zero hallucination fails the gate.

This check is deterministic. It does not call an LLM.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Matches "Capitalized Phrase" followed by one of the program keywords.
# The capture group 0 is the full span including the keyword so callers
# can present the exact text to reviewers.
#
# The pattern permits 1-6 capitalized words to avoid matching phrases
# like "The Program" (which is single-cap-word and usually a generic
# reference) while catching multi-word names like "Rural Wellness
# Initiative" and "Rasmuson Legacy Grant".
_PROGRAM_RE = re.compile(
    r"\b(?:[A-Z][A-Za-z0-9]*(?:\s+|-)){1,6}(?:Program|Initiative|Award|Grant|Fund)\b"
)


@dataclass(frozen=True)
class HallucinationResult:
    """Breakdown of the hallucinated-program check.

    `hallucinated` is the list of distinct unresolved mentions. `grounded`
    is the list of distinct mentions that resolved against the allowlists.
    `score` is 1.0 when `hallucinated` is empty, otherwise
    `1 - len(hallucinated) / total`.
    """

    total_mentions: int
    grounded: list[str] = field(default_factory=list)
    hallucinated: list[str] = field(default_factory=list)
    score: float = 1.0
    passed: bool = True
    reason: str | None = None


def _extract_mentions(content: str) -> list[str]:
    """Return distinct program-like mentions in original order."""
    seen: set[str] = set()
    ordered: list[str] = []
    for match in _PROGRAM_RE.finditer(content):
        mention = " ".join(match.group(0).split())
        key = mention.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(mention)
    return ordered


def _mention_grounded(
    mention: str, known_programs: list[str], chunk_haystack: str
) -> bool:
    """Return True when `mention` resolves against a known program or chunk.

    Matching is case-insensitive and substring-based in both directions so
    that "Rasmuson Legacy Grant" resolves against a known program called
    "Rasmuson Legacy" and a chunk that happens to name "Rasmuson Legacy
    Grant Program" satisfies a draft mention of "Rasmuson Legacy Grant".
    """
    needle = mention.casefold()
    if any(
        needle in kp.casefold() or kp.casefold() in needle
        for kp in known_programs
        if kp
    ):
        return True
    return needle in chunk_haystack


def _chunk_haystack(chunks: list[dict[str, object]]) -> str:
    """Concatenate chunk excerpts into a single casefolded haystack.

    We tolerate either `excerpt` or `content` keys on the chunk dicts so
    callers can pass either the citation-shaped dicts from the WCE
    response or the raw retrieved chunks.
    """
    parts: list[str] = []
    for c in chunks:
        text = c.get("excerpt") or c.get("content") or ""
        if isinstance(text, str) and text:
            parts.append(text.casefold())
    return "\n".join(parts)


def check_hallucinations(
    content: str,
    known_programs: list[str],
    retrieved_chunks: list[dict[str, object]],
) -> HallucinationResult:
    """Run the hallucination check and return a full breakdown."""
    mentions = _extract_mentions(content)
    haystack = _chunk_haystack(retrieved_chunks)

    grounded: list[str] = []
    hallucinated: list[str] = []
    for m in mentions:
        if _mention_grounded(m, known_programs, haystack):
            grounded.append(m)
        else:
            hallucinated.append(m)

    total = len(mentions)
    if total == 0:
        score = 1.0
    else:
        score = 1.0 - (len(hallucinated) / total)

    passed = len(hallucinated) == 0
    reason = (
        None
        if passed
        else f"hallucinated program mentions: {hallucinated}"
    )

    return HallucinationResult(
        total_mentions=total,
        grounded=grounded,
        hallucinated=hallucinated,
        score=score,
        passed=passed,
        reason=reason,
    )
