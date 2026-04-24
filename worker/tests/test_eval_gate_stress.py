"""Stress tests for the eval gate (worker/app/evals/gate.py).

Tests cover:
  - All 5 checks fail simultaneously: passed=False, 5 failure reasons.
  - Word count exactly at min/max boundary (should pass).
  - Word count 1 word over max (should fail).
  - Hallucination regex catches a program name not in known_programs.
  - Factuality check scores 0.88 mean_score (below 0.9 threshold => fail).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.evals.gate import run_eval_gate
from app.evals.hallucinations import check_hallucinations, _extract_mentions
from app.evals.wordcount import check_word_count, count_words
from app.evals.thresholds import (
    FACTUALITY_PROPORTION_THRESHOLD,
    HALLUCINATION_THRESHOLD,
    WORD_COUNT_MAX_RATIO,
    WORD_COUNT_MIN_RATIO,
)


# ---------------------------------------------------------------------------
# Helper: build a minimal Anthropic client whose responses can be controlled.
# ---------------------------------------------------------------------------


def _text_block(text: str) -> Any:
    b = MagicMock()
    b.type = "text"
    b.text = text
    return b


def _llm_response(text: str) -> Any:
    resp = MagicMock()
    resp.content = [_text_block(text)]
    resp.usage = MagicMock(input_tokens=100, output_tokens=50)
    return resp


def _factuality_response(pairs: list[dict], score: float = 1.0) -> str:
    """Return a JSON string simulating the factuality judge output.

    Every pair gets `support_score=score` and a generic reason.
    """
    results = [
        {
            "sentence_index": p["sentence_index"],
            "support_score": score,
            "reason": "supported" if score >= 0.9 else "weak support",
        }
        for p in pairs
    ]
    return json.dumps({"results": results})


def _rubric_response(overall_score_0_to_2: float, rubric: list[dict]) -> str:
    """Simulate the rubric judge output, scoring each item the same."""
    scores = {
        item["id"]: {"score": overall_score_0_to_2, "justification": "ok"}
        for item in rubric
    }
    return json.dumps({"scores": scores})


SIMPLE_RUBRIC = [{"id": "impact", "label": "Community impact", "weight": 1.0}]
FUNDER = "Rasmuson Foundation"


def _make_client(factuality_score: float = 1.0, rubric_score_0_2: float = 2.0) -> Any:
    """Return a fake Anthropic client that returns configurable LLM judgements.

    The factuality check sends pairs JSON; the rubric check sends the draft
    + rubric. We distinguish by checking for 'sentence_chunk_pairs_json' in
    the user message body.
    """
    async def create(**kwargs: Any) -> Any:
        messages = kwargs.get("messages", [])
        user_content = messages[0].get("content", "") if messages else ""
        if "sentence_chunk_pairs_json" in user_content:
            # Factuality judge.
            pairs_str = user_content.split("sentence_chunk_pairs_json")[1]
            # Just produce one result per line so parsing succeeds.
            try:
                pairs_raw = pairs_str.strip().lstrip('"').lstrip(":")
                pairs = json.loads(pairs_raw.split("\n")[0])
            except Exception:
                pairs = []
            return _llm_response(_factuality_response(pairs, score=factuality_score))
        # Rubric judge.
        return _llm_response(_rubric_response(rubric_score_0_2, SIMPLE_RUBRIC))

    client = MagicMock()
    client.messages.create = AsyncMock(side_effect=create)
    return client


# ---------------------------------------------------------------------------
# Test 1: All 5 checks fail simultaneously.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_five_checks_fail():
    """Construct a draft that fails every check and verify:
      - passed=False
      - reasons list has exactly 5 entries (one per check).
    """
    # Draft deliberately designed to fail all checks:
    #   - Too many words vs max of 10 (word count fail: ratio > 1.05)
    #   - Below readability threshold (very dense, but we force a short doc)
    #   - Hallucination: "Unknown Legacy Grant" not in known_programs or chunks
    #   - Factuality: mocked to 0.0 support
    #   - Rubric: mocked to score 0.0

    # 12 words -> ratio 1.2 vs max=10 (fails word count, ratio > 1.05)
    draft = (
        "The Unknown Legacy Grant supported work across many areas this year period."
    )
    # That's 13 words. With max=10, ratio=1.3 > 1.05 -> word count fails.
    # "Unknown Legacy Grant" is not in known_programs -> hallucination fails.
    # Factuality judge returns 0.0 -> fails.
    # Rubric judge returns 0.0 -> fails.
    # Readability: very short sentence, flesch score may vary; we enforce
    # word_count_min=300 to guarantee a word-count failure, and use a
    # near-empty body for readability failure.

    # Simpler approach: use word_count_max=5 so 13-word draft fails.
    # For readability: pass a very complex sentence.
    # For factuality: return 0.0 support.
    # For rubric: return 0.0 score.
    # For hallucination: "Unknown Legacy Grant" is the offender.

    long_draft = (
        "The Unknown Legacy Grant administered by our organization provided "
        "substantial programmatic support [1]."
    )
    # That is ~14 words. Max is 5. Ratio = 2.8 -> word count fails.
    # "Unknown Legacy Grant" -> hallucination fails (not in known_programs).
    # Factuality -> 0.0 support -> fails.
    # Rubric -> 0.0 score -> fails.
    # Readability: short sentence likely scores fine, but we can't easily
    # force it to fail without a huge word count. Instead we also restrict
    # word_count_min=300 to add a min-count failure (still one word_count check).

    # Actually the gate only produces one word_count reason, not two.
    # Let's also force readability to fail by using a very convoluted sentence.
    # A more reliable approach: monkey-patch check_readability for this test.

    from app.evals import gate as gate_module
    from app.evals.readability import ReadabilityResult
    from app.evals.thresholds import READABILITY_THRESHOLD

    original_check_readability = gate_module.check_readability

    def _failing_readability(content: str) -> ReadabilityResult:  # type: ignore[override]
        return ReadabilityResult(
            flesch_reading_ease=10.0,
            threshold=READABILITY_THRESHOLD,
            passed=False,
            reason="flesch_reading_ease 10.0 below threshold 40.0",
        )

    gate_module.check_readability = _failing_readability  # type: ignore[attr-defined]

    try:
        client = _make_client(factuality_score=0.0, rubric_score_0_2=0.0)
        result = await run_eval_gate(
            draft_content=long_draft,
            citations=[{"id": "[1]", "chunk_id": "c1", "excerpt": "support text"}],
            retrieved_chunks=[{"content": "some chunk text"}],
            rubric=SIMPLE_RUBRIC,
            funder_name=FUNDER,
            word_count_min=None,
            word_count_max=5,   # 14-word draft vs max 5 -> fails
            anthropic_client=client,
            known_programs=[],  # "Unknown Legacy Grant" not known -> hallucination
        )
    finally:
        gate_module.check_readability = original_check_readability  # type: ignore[attr-defined]

    assert not result.passed, "All-fail scenario must have passed=False"
    # Each failing check contributes one reason.
    assert len(result.reasons) == 5, (
        f"Expected 5 failure reasons, got {len(result.reasons)}: {result.reasons}"
    )
    # Verify each check name appears in the reasons.
    reason_text = " ".join(result.reasons)
    for check in ("factuality", "rubric", "hallucinations", "readability", "word_count"):
        assert check in reason_text, f"Missing reason for check '{check}'"


# ---------------------------------------------------------------------------
# Test 2: Word count exactly at boundary (should pass).
# ---------------------------------------------------------------------------


def test_word_count_exactly_at_max_boundary_passes():
    """Word count == word_count_max means ratio == 1.0, which is within [0.95, 1.05]."""
    # 10 words exactly.
    content = "The program served elders across the Nome service area effectively."
    count = count_words(content)
    result = check_word_count(content, word_count_min=None, word_count_max=count)
    assert result.passed, (
        f"Expected pass when word_count == word_count_max, ratio={result.ratio_vs_max}"
    )
    assert result.ratio_vs_max == pytest.approx(1.0)


def test_word_count_exactly_at_min_boundary_passes():
    """Word count == word_count_min means ratio == 1.0, within tolerance."""
    content = "Elders received services in Nome this year under the grant award."
    count = count_words(content)
    result = check_word_count(content, word_count_min=count, word_count_max=None)
    assert result.passed, (
        f"Expected pass when word_count == word_count_min, ratio={result.ratio_vs_min}"
    )


def test_word_count_at_max_ratio_boundary_passes():
    """Word count at exactly WORD_COUNT_MAX_RATIO * max should pass (boundary inclusive).

    WORD_COUNT_MAX_RATIO is 1.05. If max=100 and count=105, ratio=1.05 which
    is NOT > 1.05 so the check passes (strict > comparison in the code).
    """
    # Build a draft of exactly 105 words.
    word = "grant"
    content = " ".join([word] * 105)
    result = check_word_count(content, word_count_min=None, word_count_max=100)
    # ratio = 1.05; the code checks `ratio_max > WORD_COUNT_MAX_RATIO` which is
    # 1.05 > 1.05 => False, so the draft passes.
    assert result.passed, (
        f"Expected pass at ratio=1.05 (boundary), got passed={result.passed}, ratio={result.ratio_vs_max}"
    )


# ---------------------------------------------------------------------------
# Test 3: Word count 1 word over max should fail.
# ---------------------------------------------------------------------------


def test_word_count_one_word_over_max_fails():
    """A draft exactly 1 word over word_count_max must fail the word-count check.

    With max=100, count=106 -> ratio=1.06 > 1.05 -> fail.
    """
    word = "grant"
    content = " ".join([word] * 106)
    result = check_word_count(content, word_count_min=None, word_count_max=100)
    assert not result.passed, (
        f"Expected fail when word_count (106) > 1.05 * max (100), "
        f"got passed={result.passed}, ratio={result.ratio_vs_max}"
    )
    assert result.reason is not None
    assert "exceeds" in result.reason


# ---------------------------------------------------------------------------
# Test 4: Hallucination regex catches a known-bad program name.
# ---------------------------------------------------------------------------


def test_hallucination_regex_catches_unknown_program():
    """A program-like mention not in known_programs or retrieved chunks is
    flagged as a hallucination.
    """
    draft = "Our organization received the Aurora Legacy Grant this year."
    # "Aurora Legacy Grant" matches _PROGRAM_RE (capitalized multi-word + "Grant").
    result = check_hallucinations(
        content=draft,
        known_programs=["Rasmuson Tier 1 Grant"],
        retrieved_chunks=[{"content": "nothing about aurora"}],
    )
    assert not result.passed, "Should fail: 'Aurora Legacy Grant' is not in known_programs"
    assert "Aurora Legacy Grant" in result.hallucinated


def test_hallucination_passes_when_program_in_known_list():
    """A program mention that IS in known_programs should be grounded."""
    draft = "The Rasmuson Tier 1 Grant supported the program."
    result = check_hallucinations(
        content=draft,
        known_programs=["Rasmuson Tier 1 Grant"],
        retrieved_chunks=[],
    )
    assert result.passed, "Should pass: 'Rasmuson Tier 1 Grant' is known"
    assert len(result.hallucinated) == 0


def test_hallucination_passes_when_program_in_chunk():
    """A program mention that appears in a retrieved chunk should be grounded."""
    draft = "We received the Yukon Elder Fund this cycle."
    result = check_hallucinations(
        content=draft,
        known_programs=[],
        retrieved_chunks=[{"content": "The Yukon Elder Fund supports communities."}],
    )
    assert result.passed, "Should pass: 'Yukon Elder Fund' appears in chunks"


def test_hallucination_regex_extracts_multi_word_programs():
    """Verify the regex extracts multi-word program names correctly."""
    draft = "The Rural Wellness Initiative Program funded the work."
    mentions = _extract_mentions(draft)
    assert len(mentions) >= 1
    assert any("Rural" in m for m in mentions)


# ---------------------------------------------------------------------------
# Test 5: Factuality check scores 0.88 mean (below 0.9 threshold => fail).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_factuality_below_threshold_fails():
    """Factuality judge returning support_score=0.88 for all sentences must fail
    the gate because proportion_passing will be 0 (0.88 < per-sentence threshold
    of 0.9) which is below the proportion threshold of 0.9.
    """
    from app.evals.factuality import run_factuality_check

    # One sentence with a valid citation.
    draft = "The program served 142 elders in Nome [1]."
    citations = [
        {
            "id": "[1]",
            "chunk_id": "c1",
            "excerpt": "142 elders were served in the Nome region.",
        }
    ]

    # Score 0.88 is below per-sentence threshold of 0.9 => sentence does not pass.
    # => proportion_passing = 0 / 1 = 0.0 < 0.9 => factuality fails.
    async def create(**kwargs: Any) -> Any:
        # One sentence in the draft -> sentence_index=0. Score is 0.88.
        return _llm_response(json.dumps({"results": [
            {"sentence_index": 0, "support_score": 0.88, "reason": "partial support"},
        ]}))

    client = MagicMock()
    client.messages.create = AsyncMock(side_effect=create)

    result = await run_factuality_check(draft, citations, client)

    assert not result.passed, (
        f"Expected factuality to fail at score 0.88 (< 0.9 per-sentence threshold), "
        f"got passed={result.passed}, proportion={result.proportion_passing}"
    )
    assert result.proportion_passing < FACTUALITY_PROPORTION_THRESHOLD


@pytest.mark.asyncio
async def test_factuality_at_threshold_passes():
    """Factuality with support_score=0.9 (exactly at per-sentence threshold)
    should pass for all sentences => proportion_passing=1.0 >= 0.9.

    The mock always returns sentence_index=0 because our draft has exactly
    one sentence that will be submitted to the LLM judge.
    """
    from app.evals.factuality import run_factuality_check

    draft = "The program served 142 elders in Nome [1]."
    citations = [
        {
            "id": "[1]",
            "chunk_id": "c1",
            "excerpt": "142 elders were served in the Nome region.",
        }
    ]

    async def create(**kwargs: Any) -> Any:
        # Always return score=0.9 for sentence_index=0.
        return _llm_response(json.dumps({"results": [
            {"sentence_index": 0, "support_score": 0.9, "reason": "fully supported"},
        ]}))

    client = MagicMock()
    client.messages.create = AsyncMock(side_effect=create)

    result = await run_factuality_check(draft, citations, client)

    assert result.passed, (
        f"Expected factuality to pass at score 0.9 (== per-sentence threshold), "
        f"got passed={result.passed}, proportion={result.proportion_passing}"
    )
