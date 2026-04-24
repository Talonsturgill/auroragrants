"""Readability check using `textstat.flesch_reading_ease`.

Flesch Reading Ease is 0-100 where higher means easier to read:
  90-100  very easy (5th grader)
  60-70   plain English (8th-9th grader)
  30-50   difficult (college)
  0-30    very confusing

Our threshold is 40 which corresponds to college-level readable prose.
Grant narratives tend to cluster in 30-60. Below 40 we block and
regenerate with a readability hint in the Writer prompt.

We strip inline [n] citation markers before scoring so citation density
does not artificially depress readability.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import textstat

from app.evals.thresholds import READABILITY_THRESHOLD

_CITATION_RE = re.compile(r"\[\d+\]")


@dataclass(frozen=True)
class ReadabilityResult:
    """Breakdown of the readability check."""

    flesch_reading_ease: float
    threshold: float
    passed: bool
    reason: str | None


def compute_flesch(content: str) -> float:
    """Return `textstat.flesch_reading_ease` for the citation-stripped text.

    Empty or whitespace-only input returns 0.0 rather than raising, so
    the gate handles degenerate drafts uniformly through the normal
    fail-closed path.
    """
    stripped = _CITATION_RE.sub("", content).strip()
    if not stripped:
        return 0.0
    return float(textstat.flesch_reading_ease(stripped))


def check_readability(content: str) -> ReadabilityResult:
    """Run the readability check and return a full breakdown."""
    score = compute_flesch(content)
    passed = score >= READABILITY_THRESHOLD
    reason = (
        None
        if passed
        else f"flesch_reading_ease {score:.1f} below threshold {READABILITY_THRESHOLD:.1f}"
    )
    return ReadabilityResult(
        flesch_reading_ease=score,
        threshold=READABILITY_THRESHOLD,
        passed=passed,
        reason=reason,
    )
