"""
Eval harness unit tests.

Pure-function tests require no LLM credentials and run offline.
All six tests must pass for the >= 90% golden-set gate to clear in CI.
"""

from __future__ import annotations

from starter.evals.harness import (
    _check_hallucinated_entities,
    _check_readability,
    _check_word_count,
)


def test_word_count_block() -> None:
    """Draft at 150% of the max word limit must fail the word count check."""
    content = " ".join(["word"] * 150)
    count, ok = _check_word_count(content, word_max=100, word_min=None)
    assert count == 150
    assert not ok


def test_word_count_ok() -> None:
    """Draft at exactly the max word limit must pass."""
    content = " ".join(["word"] * 100)
    count, ok = _check_word_count(content, word_max=100, word_min=None)
    assert count == 100
    assert ok


def test_word_count_below_min_block() -> None:
    """Draft below the minimum word limit must fail."""
    content = " ".join(["word"] * 40)
    _count, ok = _check_word_count(content, word_max=None, word_min=50)
    assert not ok


def test_hallucinated_cfda_block() -> None:
    """A CFDA number not in the known-entities set is a hallucination."""
    content = "This award is governed by CFDA 99.999 requirements."
    hallucinated = _check_hallucinated_entities(content, known_entities=set())
    assert len(hallucinated) > 0


def test_known_entity_not_hallucinated() -> None:
    """A CFDA number that appears in known_entities is not flagged."""
    content = "This award is governed by CFDA 99.999 requirements."
    hallucinated = _check_hallucinated_entities(
        content, known_entities={"CFDA 99.999"}
    )
    assert len(hallucinated) == 0


def test_readability_returns_numeric_grade() -> None:
    """_check_readability must return a non-negative float for any input."""
    content = (
        "The organization has implemented comprehensive financial controls "
        "and compliance monitoring procedures to ensure accountability across "
        "all federal grant programs administered during the reporting period."
    )
    grade = _check_readability(content)
    assert isinstance(grade, float)
    assert grade >= 0
