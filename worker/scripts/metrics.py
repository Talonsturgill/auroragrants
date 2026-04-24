"""
Pure scoring functions for the parser bake-off.

These are intentionally I/O free so they can be unit-tested without
touching disk, the network, or any parser library. The orchestrator in
`parser_bakeoff.py` is the only module that performs I/O.

Metrics
-------
table_f1(predicted, expected)
    Detection-level F1 at the page granularity. A predicted table is a
    true positive when it appears on the same page as an expected table.
    Row/column counts are used only as a tie-breaker when the same page
    appears multiple times in both lists.

heading_accuracy(predicted, expected)
    Two numbers packaged as an `HeadingAccuracy`. `exact` is the fraction
    of expected headings that appear (case-insensitive, whitespace
    collapsed) in the predicted list. `level_within_one` is the fraction
    that match AND whose heading level is within one of the expected
    level. The scorer tolerates extra predicted headings, so this is
    recall, not precision.

token_efficiency(markdown, expected_length)
    Ratio of characters in the parser markdown to the expected length.
    A ratio near 1.0 is ideal. Values below 0.5 suggest the parser
    dropped content. Values above 2.0 suggest it duplicated or leaked
    binary noise into the text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TypedDict


class TableDescriptor(TypedDict, total=False):
    """A detected or expected table. Only `page` is required."""

    page: int
    n_rows: int
    n_cols: int
    has_header: bool
    topic: str


class HeadingDescriptor(TypedDict, total=False):
    """A heading as produced by a parser. Only `text` is required."""

    text: str
    level: int


@dataclass(frozen=True)
class F1Score:
    """Precision, recall, and F1 packaged together."""

    precision: float
    recall: float
    f1: float
    true_positives: int
    false_positives: int
    false_negatives: int


@dataclass(frozen=True)
class HeadingAccuracy:
    """Exact-match and level-within-one recall for headings."""

    exact: float
    level_within_one: float
    matched: int
    total: int


_WHITESPACE_RE = re.compile(r"\s+")


def _normalize_heading(text: str) -> str:
    """Lowercase, strip, and collapse whitespace for heading matching."""
    return _WHITESPACE_RE.sub(" ", text).strip().lower()


def table_f1(
    predicted: list[TableDescriptor],
    expected: list[TableDescriptor],
) -> F1Score:
    """
    Detection-level F1 for tables.

    A predicted table matches an expected table when they share a page.
    Each expected table can match at most one predicted table and vice
    versa. When multiple tables share a page, we pair them greedily in
    input order.

    Returns an `F1Score`. F1 is 1.0 when both lists are empty.
    """
    if not predicted and not expected:
        return F1Score(1.0, 1.0, 1.0, 0, 0, 0)

    predicted_by_page: dict[int, list[int]] = {}
    for i, t in enumerate(predicted):
        page = int(t.get("page", -1))
        predicted_by_page.setdefault(page, []).append(i)

    matched_predicted: set[int] = set()
    true_positives = 0
    for exp in expected:
        page = int(exp.get("page", -1))
        candidates = predicted_by_page.get(page, [])
        for idx in candidates:
            if idx not in matched_predicted:
                matched_predicted.add(idx)
                true_positives += 1
                break

    false_positives = len(predicted) - true_positives
    false_negatives = len(expected) - true_positives

    precision = true_positives / len(predicted) if predicted else 0.0
    recall = true_positives / len(expected) if expected else 0.0
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)

    return F1Score(
        precision=precision,
        recall=recall,
        f1=f1,
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
    )


def heading_accuracy(
    predicted: list[HeadingDescriptor],
    expected: list[HeadingDescriptor],
) -> HeadingAccuracy:
    """
    Recall of expected headings with and without level tolerance.

    Expected headings are matched case-insensitively with whitespace
    collapsed. Each expected heading matches at most one predicted
    heading so duplicated headings in the parser output do not inflate
    the score.

    Returns a `HeadingAccuracy`. Both fractions are 1.0 when `expected`
    is empty.
    """
    if not expected:
        return HeadingAccuracy(1.0, 1.0, 0, 0)

    predicted_keys: list[tuple[str, int]] = []
    for h in predicted:
        text = h.get("text", "")
        level = int(h.get("level", 0))
        predicted_keys.append((_normalize_heading(text), level))

    used: set[int] = set()
    matched = 0
    matched_within_one = 0
    for exp in expected:
        exp_text = _normalize_heading(exp.get("text", ""))
        exp_level = int(exp.get("level", 0))
        best_idx: int | None = None
        best_level_gap: int | None = None
        for i, (p_text, p_level) in enumerate(predicted_keys):
            if i in used:
                continue
            if p_text != exp_text:
                continue
            gap = abs(p_level - exp_level)
            if best_level_gap is None or gap < best_level_gap:
                best_idx = i
                best_level_gap = gap
        if best_idx is not None and best_level_gap is not None:
            used.add(best_idx)
            matched += 1
            if best_level_gap <= 1:
                matched_within_one += 1

    total = len(expected)
    return HeadingAccuracy(
        exact=matched / total,
        level_within_one=matched_within_one / total,
        matched=matched,
        total=total,
    )


def token_efficiency(markdown: str, expected_length: int) -> float:
    """
    Ratio of markdown characters to expected characters.

    Returns 0.0 when `expected_length <= 0`. Otherwise returns
    `len(markdown) / expected_length`. The orchestrator interprets the
    result: values close to 1.0 are ideal, small values indicate content
    loss, and large values indicate duplication or noise.
    """
    if expected_length <= 0:
        return 0.0
    return len(markdown) / float(expected_length)
