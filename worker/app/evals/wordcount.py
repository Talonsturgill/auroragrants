"""Deterministic word-count compliance check.

The check strips inline citation markers like `[1]` or `[12]` before
counting so citation density never inflates the count. A draft passes
when `word_count / word_count_max` is within [0.95, 1.05]. Lower-bound
enforcement against `word_count_min` is the same tolerance band.

Either bound may be None, in which case that side is not enforced.
Both bounds absent means the check always passes with ratio 1.0.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.evals.thresholds import WORD_COUNT_MAX_RATIO, WORD_COUNT_MIN_RATIO

_CITATION_RE = re.compile(r"\[\d+\]")
_WORD_RE = re.compile(r"\b\w+\b")


@dataclass(frozen=True)
class WordCountResult:
    """Breakdown of the word-count check.

    `passed` is True when both (a) there is no max cap or the ratio is
    within tolerance and (b) there is no min floor or the ratio is within
    tolerance. `ratio_vs_max` is word_count / word_count_max when a max
    exists, else None. Same for `ratio_vs_min`.
    """

    word_count: int
    word_count_min: int | None
    word_count_max: int | None
    ratio_vs_max: float | None
    ratio_vs_min: float | None
    passed: bool
    reason: str | None


def count_words(content: str) -> int:
    """Count words in a draft, ignoring inline [n] citation markers.

    Uses a simple word-boundary regex rather than `str.split()` so that
    punctuation does not inflate the count and so tokens like `two-year`
    become two words matching the grant-review convention used by every
    funder portal in our golden set.
    """
    stripped = _CITATION_RE.sub("", content)
    return len(_WORD_RE.findall(stripped))


def check_word_count(
    content: str,
    word_count_min: int | None,
    word_count_max: int | None,
) -> WordCountResult:
    """Run the word-count check and return a full breakdown."""
    count = count_words(content)

    ratio_max: float | None = None
    ratio_min: float | None = None
    reason: str | None = None
    passed = True

    if word_count_max is not None and word_count_max > 0:
        ratio_max = count / word_count_max
        if ratio_max < WORD_COUNT_MIN_RATIO:
            passed = False
            reason = (
                f"word_count {count} is below {WORD_COUNT_MIN_RATIO:.2f} of "
                f"word_count_max {word_count_max}"
            )
        elif ratio_max > WORD_COUNT_MAX_RATIO:
            passed = False
            reason = (
                f"word_count {count} exceeds {WORD_COUNT_MAX_RATIO:.2f} of "
                f"word_count_max {word_count_max}"
            )

    if passed and word_count_min is not None and word_count_min > 0:
        ratio_min = count / word_count_min
        if ratio_min < WORD_COUNT_MIN_RATIO:
            passed = False
            reason = (
                f"word_count {count} is below {WORD_COUNT_MIN_RATIO:.2f} of "
                f"word_count_min {word_count_min}"
            )
    elif word_count_min is not None and word_count_min > 0:
        # Always compute the ratio for reporting even when the max check failed.
        ratio_min = count / word_count_min

    return WordCountResult(
        word_count=count,
        word_count_min=word_count_min,
        word_count_max=word_count_max,
        ratio_vs_max=ratio_max,
        ratio_vs_min=ratio_min,
        passed=passed,
        reason=reason,
    )
