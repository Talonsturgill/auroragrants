"""Stress tests for the Writer-Critic-Editor loop (worker/app/wce/loop.py).

Tests exercise:
  - MAX_ITER=5 cap: best-scoring draft is returned, not the last one.
  - Fluctuating Critic scores (7.5 -> 9.0 -> 7.0): surface decisions follow best.
  - high_stakes=True routes Critic to claude-opus-4-6.
  - trace_dict structure: iterations list, surface_decision, model keys.
  - All iterations score below 6.0: surface_decision="block".
  - High-severity fix blocks clean "surface" even above score threshold.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.retrieve.models import RetrievedChunk
from app.wce.loop import (
    MODEL_CRITIC_HIGH_STAKES,
    MODEL_CRITIC_STANDARD,
    _CRITIC_PROMPT,
    _EDITOR_PROMPT,
    _WRITER_PROMPT,
    trace_dict,
    run_wce_loop,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_chunk(citation_id: int = 1) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=f"chunk-{citation_id}",
        document_id="doc-1",
        content="Elders served in the Yukon region.",
        page_start=1,
        page_end=1,
        section_heading="Outcomes",
        content_type="narrative",
        source="tenant",
        bm25_score=0.5,
        vector_score=0.5,
        rrf_score=0.5,
        rerank_score=0.8,
        citation_id=citation_id,
    )


def _writer_response(content: str = "Draft text [1].", word_count: int = 3) -> Any:
    """Fake Anthropic response for the writer step."""
    payload = json.dumps(
        {
            "draft_content": content,
            "word_count": word_count,
            "citations": [{"id": 1, "page": 1, "excerpt": "Elders served"}],
            "uncovered_claims": [],
        }
    )
    resp = MagicMock()
    resp.content = [MagicMock(type="text", text=payload)]
    resp.usage = MagicMock(input_tokens=100, output_tokens=50)
    return resp


def _critic_response(
    overall_score: float,
    ready: bool = False,
    fixes: list[dict] | None = None,
) -> Any:
    """Fake Anthropic response for the critic step."""
    payload = json.dumps(
        {
            "rubric_scores": {"impact": {"score": overall_score / 10, "max": 1.0}},
            "overall_score": overall_score,
            "fixes": fixes or [],
            "ready_to_surface": ready,
        }
    )
    resp = MagicMock()
    resp.content = [MagicMock(type="text", text=payload)]
    resp.usage = MagicMock(input_tokens=80, output_tokens=40)
    return resp


def _editor_response(content: str = "Improved draft [1].") -> Any:
    """Fake Anthropic response for the editor step."""
    payload = json.dumps(
        {
            "revised_content": content,
            "word_count": len(content.split()),
            "citations": None,
        }
    )
    resp = MagicMock()
    resp.content = [MagicMock(type="text", text=payload)]
    resp.usage = MagicMock(input_tokens=90, output_tokens=60)
    return resp


# Detect which role a call belongs to using a unique substring from each
# system prompt.  The prompts are loaded from worker/prompts/*.md at import
# time so we read the first 40 chars of each once.
_WRITER_SYS_PREFIX = _WRITER_PROMPT.system[:40]
_CRITIC_SYS_PREFIX = _CRITIC_PROMPT.system[:40]
_EDITOR_SYS_PREFIX = _EDITOR_PROMPT.system[:40]


def _is_writer(system: str) -> bool:
    return system.startswith(_WRITER_SYS_PREFIX)


def _is_critic(system: str) -> bool:
    return system.startswith(_CRITIC_SYS_PREFIX)


def _is_editor(system: str) -> bool:
    return system.startswith(_EDITOR_SYS_PREFIX)


FUNDER = {"name": "Rasmuson Foundation"}
RUBRIC = [{"id": "impact", "label": "Community impact", "weight": 1.0}]
FIELD_META = {
    "label": "Program Summary",
    "field_type": "narrative",
    "word_count_max": 500,
    "word_count_min": 100,
}
ORG_CONTEXT = {
    "tenant_id": "t-1",
    "name": "Test Nonprofit",
    "org_type": "501c3",
    "ein": "12-3",
}


# ---------------------------------------------------------------------------
# Test 1: MAX_ITER=5 cap returns best-scoring draft, not the last one.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_max_iter_returns_best_scoring_draft_not_last():
    """When the loop hits the 5-iteration cap, it must return the draft that
    received the highest Critic score, not the final iteration's draft.

    Sequence of Critic scores: 6.5, 9.0, 7.0, 6.0, 5.5
    Best score is 9.0 at iteration 2, so surface_decision must be "surface"
    (score >= 8.0, no high-severity fixes).
    """
    scores = [6.5, 9.0, 7.0, 6.0, 5.5]
    critic_call = {"n": 0}

    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        if _is_writer(system):
            return _writer_response("Initial draft [1].")
        if _is_critic(system):
            idx = critic_call["n"]
            critic_call["n"] += 1
            # Never set ready_to_surface so the loop always continues.
            return _critic_response(scores[idx], ready=False)
        # editor
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    chunks = [_make_chunk(1)]
    result = await run_wce_loop(
        client=client,
        chunks=chunks,
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
        high_stakes=False,
    )

    # Best score was 9.0 (iteration 2), so surface_decision must be "surface".
    assert result.surface_decision == "surface", (
        f"expected 'surface' but got '{result.surface_decision}'"
    )
    assert result.critique.overall_score == 9.0, (
        f"expected best score 9.0, got {result.critique.overall_score}"
    )
    # Exactly 5 critic calls were made.
    assert critic_call["n"] == 5


# ---------------------------------------------------------------------------
# Test 2a: Fluctuating scores: ready_to_surface at iteration 2 (score 9.0).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fluctuating_scores_exits_on_ready_to_surface():
    """Scores 7.5 -> 9.0 (ready=True) -> loop exits early.

    Iteration 2 signals ready_to_surface with score 9.0, so the loop exits
    and returns surface_decision="surface".
    """
    scores = [7.5, 9.0, 7.0]
    ready_flags = [False, True, False]
    critic_call = {"n": 0}

    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        if _is_writer(system):
            return _writer_response("Initial [1].")
        if _is_critic(system):
            idx = critic_call["n"]
            critic_call["n"] += 1
            return _critic_response(scores[idx], ready=ready_flags[idx])
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
        high_stakes=False,
    )

    # Loop exits at iteration 2 (ready_to_surface=True, score=9.0).
    assert result.surface_decision == "surface"
    assert result.critique.overall_score == 9.0
    # Only 2 critic calls were made.
    assert critic_call["n"] == 2


# ---------------------------------------------------------------------------
# Test 2b: Fluctuating scores all below 8.0: best picked at cap.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fluctuating_scores_all_below_surface_threshold():
    """Scores 7.5 -> 6.0 -> 7.0 -> 6.5 -> 6.8, none hit 8.0, none ready.

    With 5 iterations cap, best=7.5 -> surface_with_flag.
    """
    scores = [7.5, 6.0, 7.0, 6.5, 6.8]
    critic_call = {"n": 0}

    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        if _is_writer(system):
            return _writer_response()
        if _is_critic(system):
            idx = critic_call["n"]
            critic_call["n"] += 1
            return _critic_response(scores[idx], ready=False)
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
        high_stakes=False,
    )

    assert result.surface_decision == "surface_with_flag", (
        f"expected 'surface_with_flag' but got '{result.surface_decision}'"
    )
    assert result.critique.overall_score == 7.5


# ---------------------------------------------------------------------------
# Test 3: high_stakes=True routes Critic to claude-opus-4-6.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_high_stakes_uses_opus_for_critic():
    """When high_stakes=True the Critic call must use MODEL_CRITIC_HIGH_STAKES."""
    recorded_models: list[str] = []

    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        model = kwargs.get("model", "")
        if _is_writer(system):
            return _writer_response()
        if _is_critic(system):
            recorded_models.append(model)
            return _critic_response(9.0, ready=True)
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
        high_stakes=True,
    )

    assert result.model_critic == MODEL_CRITIC_HIGH_STAKES
    assert len(recorded_models) >= 1
    assert all(m == MODEL_CRITIC_HIGH_STAKES for m in recorded_models), (
        f"Expected all critic calls to use {MODEL_CRITIC_HIGH_STAKES}, got {recorded_models}"
    )


@pytest.mark.asyncio
async def test_low_stakes_uses_sonnet_for_critic():
    """high_stakes=False should use MODEL_CRITIC_STANDARD."""
    recorded_models: list[str] = []

    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        model = kwargs.get("model", "")
        if _is_writer(system):
            return _writer_response()
        if _is_critic(system):
            recorded_models.append(model)
            return _critic_response(9.0, ready=True)
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
        high_stakes=False,
    )

    assert result.model_critic == MODEL_CRITIC_STANDARD
    assert all(m == MODEL_CRITIC_STANDARD for m in recorded_models)


# ---------------------------------------------------------------------------
# Test 4: trace_dict has correct structure.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trace_dict_structure():
    """trace_dict must include: iterations list, surface_decision, model keys,
    final_iteration, total_tokens_in, total_tokens_out, total_cost_cents,
    and prompt_versions.
    """
    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        if _is_writer(system):
            return _writer_response()
        if _is_critic(system):
            return _critic_response(8.5, ready=True)
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
    )

    td = trace_dict(result)

    # Required top-level keys.
    assert "iterations" in td, "trace_dict missing 'iterations'"
    assert "surface_decision" in td, "trace_dict missing 'surface_decision'"
    assert "model_writer" in td
    assert "model_critic" in td
    assert "model_editor" in td
    assert "final_iteration" in td
    assert "total_tokens_in" in td
    assert "total_tokens_out" in td
    assert "total_cost_cents" in td
    assert "prompt_versions" in td

    # iterations is a list.
    assert isinstance(td["iterations"], list)

    # Each iteration trace has the required fields.
    for it in td["iterations"]:
        assert "iteration" in it
        assert "overall_score" in it
        assert "ready_to_surface" in it
        assert "model_critic" in it
        assert "duration_ms" in it

    # surface_decision is one of the valid values.
    assert td["surface_decision"] in ("surface", "surface_with_flag", "block")


# ---------------------------------------------------------------------------
# Test 5: All iterations below 6.0 -> surface_decision="block".
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_below_6_scores_block():
    """When every Critic score is below 6.0, surface_decision must be 'block'."""
    scores = [5.5, 4.0, 3.0, 5.0, 4.5]
    critic_call = {"n": 0}

    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        if _is_writer(system):
            return _writer_response()
        if _is_critic(system):
            idx = critic_call["n"]
            critic_call["n"] += 1
            return _critic_response(scores[idx], ready=False)
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
    )

    assert result.surface_decision == "block", (
        f"expected 'block' but got '{result.surface_decision}'"
    )
    # Best score is 5.5 (first iteration).
    assert result.critique.overall_score == 5.5


# ---------------------------------------------------------------------------
# Test 6: High-severity fix blocks "surface" even if score >= 8.0.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_high_severity_fix_forces_surface_with_flag():
    """A fix with severity='high' prevents a clean 'surface' even when the
    overall_score is above SURFACE_THRESHOLD (8.0). The decision should be
    'surface_with_flag' as long as score >= 6.0.
    """
    async def fake_create(**kwargs: Any) -> Any:
        system = kwargs.get("system", "")
        if _is_writer(system):
            return _writer_response()
        if _is_critic(system):
            # Score 8.5 but with a high-severity fix.
            return _critic_response(
                8.5,
                ready=True,
                fixes=[{"severity": "high", "note": "missing citation"}],
            )
        return _editor_response()

    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=fake_create)

    result = await run_wce_loop(
        client=client,
        chunks=[_make_chunk()],
        funder=FUNDER,
        rubric=RUBRIC,
        field_meta=FIELD_META,
        org_context=ORG_CONTEXT,
    )

    # Score is 8.5 but has a high-severity fix, so it should NOT be "surface".
    assert result.surface_decision == "surface_with_flag", (
        f"expected 'surface_with_flag' got '{result.surface_decision}'"
    )
