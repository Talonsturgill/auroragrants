"""Unit tests for worker/scripts/metrics.py."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "worker" / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from metrics import (  # noqa: E402
    HeadingAccuracy,
    HeadingDescriptor,
    TableDescriptor,
    heading_accuracy,
    table_f1,
    token_efficiency,
)

# ---- table_f1 -------------------------------------------------------------


def test_table_f1_empty_inputs_are_perfect() -> None:
    score = table_f1([], [])
    assert score.f1 == 1.0
    assert score.precision == 1.0
    assert score.recall == 1.0
    assert score.true_positives == 0


def test_table_f1_perfect_match() -> None:
    expected: list[TableDescriptor] = [
        TableDescriptor(page=3, n_rows=4, n_cols=2, has_header=True),
        TableDescriptor(page=7, n_rows=5, n_cols=3, has_header=True),
    ]
    predicted: list[TableDescriptor] = [
        TableDescriptor(page=7, n_rows=5, n_cols=3),
        TableDescriptor(page=3, n_rows=4, n_cols=2),
    ]
    score = table_f1(predicted, expected)
    assert score.f1 == pytest.approx(1.0)
    assert score.true_positives == 2
    assert score.false_positives == 0
    assert score.false_negatives == 0


def test_table_f1_partial_match() -> None:
    expected: list[TableDescriptor] = [
        TableDescriptor(page=1),
        TableDescriptor(page=2),
        TableDescriptor(page=3),
    ]
    predicted: list[TableDescriptor] = [
        TableDescriptor(page=1),
        TableDescriptor(page=99),
    ]
    score = table_f1(predicted, expected)
    assert score.true_positives == 1
    assert score.false_positives == 1
    assert score.false_negatives == 2
    assert score.precision == pytest.approx(0.5)
    assert score.recall == pytest.approx(1 / 3)
    assert score.f1 == pytest.approx(2 * 0.5 * (1 / 3) / (0.5 + 1 / 3))


def test_table_f1_predicted_empty_when_expected_has_tables() -> None:
    score = table_f1([], [TableDescriptor(page=1), TableDescriptor(page=2)])
    assert score.f1 == 0.0
    assert score.precision == 0.0
    assert score.recall == 0.0
    assert score.false_negatives == 2


def test_table_f1_extra_predictions_on_same_page_count_once() -> None:
    expected: list[TableDescriptor] = [TableDescriptor(page=5)]
    predicted: list[TableDescriptor] = [
        TableDescriptor(page=5),
        TableDescriptor(page=5),
        TableDescriptor(page=5),
    ]
    score = table_f1(predicted, expected)
    assert score.true_positives == 1
    assert score.false_positives == 2
    assert score.false_negatives == 0


def test_table_f1_multiple_tables_same_page() -> None:
    expected: list[TableDescriptor] = [
        TableDescriptor(page=4),
        TableDescriptor(page=4),
    ]
    predicted: list[TableDescriptor] = [
        TableDescriptor(page=4),
        TableDescriptor(page=4),
    ]
    score = table_f1(predicted, expected)
    assert score.f1 == pytest.approx(1.0)
    assert score.true_positives == 2


# ---- heading_accuracy -----------------------------------------------------


def test_heading_accuracy_empty_expected_is_perfect() -> None:
    score = heading_accuracy([HeadingDescriptor(text="Anything", level=1)], [])
    assert score == HeadingAccuracy(1.0, 1.0, 0, 0)


def test_heading_accuracy_perfect_match() -> None:
    expected = [
        HeadingDescriptor(text="Eligibility", level=1),
        HeadingDescriptor(text="Reporting Requirements", level=2),
    ]
    predicted = [
        HeadingDescriptor(text="Eligibility", level=1),
        HeadingDescriptor(text="Reporting Requirements", level=2),
    ]
    score = heading_accuracy(predicted, expected)
    assert score.exact == 1.0
    assert score.level_within_one == 1.0
    assert score.matched == 2


def test_heading_accuracy_case_and_whitespace_normalized() -> None:
    expected = [HeadingDescriptor(text="Eligibility", level=1)]
    predicted = [HeadingDescriptor(text="  ELIGIBILITY  ", level=1)]
    score = heading_accuracy(predicted, expected)
    assert score.exact == 1.0


def test_heading_accuracy_partial_match_counts_recall_not_precision() -> None:
    expected = [
        HeadingDescriptor(text="A", level=1),
        HeadingDescriptor(text="B", level=1),
        HeadingDescriptor(text="C", level=1),
    ]
    # Extra headings in predicted do not hurt recall.
    predicted = [
        HeadingDescriptor(text="A", level=1),
        HeadingDescriptor(text="C", level=1),
        HeadingDescriptor(text="Z", level=1),
        HeadingDescriptor(text="Y", level=1),
    ]
    score = heading_accuracy(predicted, expected)
    assert score.exact == pytest.approx(2 / 3)


def test_heading_accuracy_level_tolerance() -> None:
    expected = [HeadingDescriptor(text="Eligibility", level=2)]
    # Matching text with level off by 1 still counts as within-one.
    predicted = [HeadingDescriptor(text="Eligibility", level=3)]
    score = heading_accuracy(predicted, expected)
    assert score.exact == 1.0
    assert score.level_within_one == 1.0


def test_heading_accuracy_level_out_of_tolerance() -> None:
    expected = [HeadingDescriptor(text="Eligibility", level=1)]
    # Off by 3, still exact-text match but not within-one.
    predicted = [HeadingDescriptor(text="Eligibility", level=4)]
    score = heading_accuracy(predicted, expected)
    assert score.exact == 1.0
    assert score.level_within_one == 0.0


def test_heading_accuracy_size_mismatched_lists() -> None:
    expected = [
        HeadingDescriptor(text="A", level=1),
        HeadingDescriptor(text="B", level=1),
    ]
    predicted: list[HeadingDescriptor] = []
    score = heading_accuracy(predicted, expected)
    assert score.exact == 0.0
    assert score.matched == 0
    assert score.total == 2


def test_heading_accuracy_unicode_text() -> None:
    expected = [
        HeadingDescriptor(text="Cañon Community Impact", level=1),
        HeadingDescriptor(text="Iñupiaq Language Programs", level=2),
    ]
    predicted = [
        HeadingDescriptor(text="CAÑON community impact", level=1),
        HeadingDescriptor(text="Iñupiaq Language Programs", level=2),
    ]
    score = heading_accuracy(predicted, expected)
    assert score.exact == 1.0
    assert score.level_within_one == 1.0


def test_heading_accuracy_duplicate_predicted_does_not_double_count() -> None:
    expected = [
        HeadingDescriptor(text="Eligibility", level=1),
        HeadingDescriptor(text="Eligibility", level=1),
    ]
    # Only one predicted heading should satisfy only one expected entry.
    predicted = [HeadingDescriptor(text="Eligibility", level=1)]
    score = heading_accuracy(predicted, expected)
    assert score.matched == 1
    assert score.exact == 0.5


# ---- token_efficiency -----------------------------------------------------


def test_token_efficiency_happy_path() -> None:
    assert token_efficiency("a" * 100, 100) == pytest.approx(1.0)
    assert token_efficiency("a" * 50, 100) == pytest.approx(0.5)
    assert token_efficiency("a" * 200, 100) == pytest.approx(2.0)


def test_token_efficiency_zero_expected_length_returns_zero() -> None:
    assert token_efficiency("hello", 0) == 0.0
    assert token_efficiency("hello", -5) == 0.0


def test_token_efficiency_empty_markdown() -> None:
    assert token_efficiency("", 100) == 0.0
