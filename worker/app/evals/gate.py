"""Orchestrate the five eval checks concurrently and return one verdict.

The gate is the final gate before a draft is surfaced. If any of the
five checks fails, `passed` is False and the caller must not show the
draft to a user. The caller should either regenerate (for deterministic
failures like hallucinations or word count) or surface with a
red-flag banner (for borderline rubric or readability results), per
the policy in /docs/06-eval-harness.md.

All five checks run concurrently via asyncio.gather so the wall-clock
latency of the gate is dominated by the slower of the two LLM judges.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from anthropic import AsyncAnthropic
from pydantic import BaseModel, ConfigDict, Field

from app.evals.factuality import FactualityResult, SentenceResult, run_factuality_check
from app.evals.hallucinations import HallucinationResult, check_hallucinations
from app.evals.readability import ReadabilityResult, check_readability
from app.evals.rubric import RubricItemScore, RubricResult, run_rubric_check
from app.evals.thresholds import (
    FACTUALITY_PER_SENTENCE_THRESHOLD,
    FACTUALITY_PROPORTION_THRESHOLD,
    HALLUCINATION_THRESHOLD,
    READABILITY_THRESHOLD,
    RUBRIC_THRESHOLD,
    WORD_COUNT_MAX_RATIO,
    WORD_COUNT_MIN_RATIO,
)
from app.evals.wordcount import WordCountResult, check_word_count

log = logging.getLogger(__name__)


class SentenceScore(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sentence_index: int
    cited_chunk_id: str | None
    support_score: float
    has_citation: bool
    reason: str


class FactualityScores(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proportion_passing: float = Field(ge=0.0, le=1.0)
    mean_score: float = Field(ge=0.0, le=1.0)
    per_sentence_threshold: float = FACTUALITY_PER_SENTENCE_THRESHOLD
    proportion_threshold: float = FACTUALITY_PROPORTION_THRESHOLD
    sentences: list[SentenceScore] = Field(default_factory=list)
    passed: bool
    reason: str | None = None


class RubricItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str
    score: float = Field(ge=0.0, le=2.0)
    weight: float = Field(ge=0.0, le=1.0)
    justification: str


class RubricScores(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[RubricItem] = Field(default_factory=list)
    normalized_score: float = Field(ge=0.0, le=1.0)
    overall_score_10: float = Field(ge=0.0, le=10.0)
    threshold: float = RUBRIC_THRESHOLD
    passed: bool
    reason: str | None = None


class HallucinationScores(BaseModel):
    model_config = ConfigDict(extra="forbid")
    total_mentions: int = Field(ge=0)
    grounded: list[str] = Field(default_factory=list)
    hallucinated: list[str] = Field(default_factory=list)
    score: float = Field(ge=0.0, le=1.0)
    threshold: float = HALLUCINATION_THRESHOLD
    passed: bool
    reason: str | None = None


class ReadabilityScores(BaseModel):
    model_config = ConfigDict(extra="forbid")
    flesch_reading_ease: float
    threshold: float = READABILITY_THRESHOLD
    passed: bool
    reason: str | None = None


class WordCountScores(BaseModel):
    model_config = ConfigDict(extra="forbid")
    word_count: int = Field(ge=0)
    word_count_min: int | None = None
    word_count_max: int | None = None
    ratio_vs_min: float | None = None
    ratio_vs_max: float | None = None
    min_ratio_threshold: float = WORD_COUNT_MIN_RATIO
    max_ratio_threshold: float = WORD_COUNT_MAX_RATIO
    passed: bool
    reason: str | None = None


class EvalScores(BaseModel):
    """Container for all five score dimensions."""

    model_config = ConfigDict(extra="forbid")

    factuality: FactualityScores
    rubric: RubricScores
    hallucinations: HallucinationScores
    readability: ReadabilityScores
    word_count: WordCountScores


class EvalResult(BaseModel):
    """Unified gate result. `passed` is the conjunction of the five checks."""

    model_config = ConfigDict(extra="forbid")

    passed: bool
    reasons: list[str] = Field(default_factory=list)
    scores: EvalScores
    funder_name: str


def _factuality_to_model(result: FactualityResult) -> FactualityScores:
    return FactualityScores(
        proportion_passing=result.proportion_passing,
        mean_score=result.mean_score,
        per_sentence_threshold=result.per_sentence_threshold,
        proportion_threshold=result.proportion_threshold,
        sentences=[_sentence_to_model(s) for s in result.sentences],
        passed=result.passed,
        reason=result.reason,
    )


def _sentence_to_model(s: SentenceResult) -> SentenceScore:
    return SentenceScore(
        sentence_index=s.sentence_index,
        cited_chunk_id=s.cited_chunk_id,
        support_score=s.support_score,
        has_citation=s.has_citation,
        reason=s.reason,
    )


def _rubric_to_model(result: RubricResult) -> RubricScores:
    return RubricScores(
        items=[_rubric_item_to_model(i) for i in result.items],
        normalized_score=result.normalized_score,
        overall_score_10=result.overall_score_10,
        threshold=result.threshold,
        passed=result.passed,
        reason=result.reason,
    )


def _rubric_item_to_model(i: RubricItemScore) -> RubricItem:
    return RubricItem(
        item_id=i.item_id,
        score=i.score,
        weight=i.weight,
        justification=i.justification,
    )


def _hallucinations_to_model(result: HallucinationResult) -> HallucinationScores:
    return HallucinationScores(
        total_mentions=result.total_mentions,
        grounded=list(result.grounded),
        hallucinated=list(result.hallucinated),
        score=result.score,
        passed=result.passed,
        reason=result.reason,
    )


def _readability_to_model(result: ReadabilityResult) -> ReadabilityScores:
    return ReadabilityScores(
        flesch_reading_ease=result.flesch_reading_ease,
        threshold=result.threshold,
        passed=result.passed,
        reason=result.reason,
    )


def _word_count_to_model(result: WordCountResult) -> WordCountScores:
    return WordCountScores(
        word_count=result.word_count,
        word_count_min=result.word_count_min,
        word_count_max=result.word_count_max,
        ratio_vs_min=result.ratio_vs_min,
        ratio_vs_max=result.ratio_vs_max,
        passed=result.passed,
        reason=result.reason,
    )


async def run_eval_gate(
    draft_content: str,
    citations: list[dict[str, Any]],
    retrieved_chunks: list[dict[str, Any]],
    rubric: list[dict[str, Any]],
    funder_name: str,
    word_count_min: int | None,
    word_count_max: int | None,
    anthropic_client: AsyncAnthropic,
    known_programs: list[str] | None = None,
) -> EvalResult:
    """Run every check and return a unified verdict.

    `known_programs` defaults to an empty list. Callers typically load it
    from the funder graph (/docs/04-funder-graph.md) and merge with the
    tenant's `awards.program_name` values before calling.

    Logging never contains draft text, chunk excerpts, rubric details,
    or LLM response text. Only summary counts and pass/fail booleans.
    """
    programs = known_programs or []

    async def _factuality() -> FactualityResult:
        return await run_factuality_check(draft_content, citations, anthropic_client)

    async def _rubric() -> RubricResult:
        return await run_rubric_check(draft_content, rubric, anthropic_client)

    async def _halluc() -> HallucinationResult:
        return check_hallucinations(draft_content, programs, retrieved_chunks)

    async def _read() -> ReadabilityResult:
        return check_readability(draft_content)

    async def _wc() -> WordCountResult:
        return check_word_count(draft_content, word_count_min, word_count_max)

    factuality, rubric_res, halluc, read, wc = await asyncio.gather(
        _factuality(), _rubric(), _halluc(), _read(), _wc()
    )

    scores = EvalScores(
        factuality=_factuality_to_model(factuality),
        rubric=_rubric_to_model(rubric_res),
        hallucinations=_hallucinations_to_model(halluc),
        readability=_readability_to_model(read),
        word_count=_word_count_to_model(wc),
    )

    reasons: list[str] = []
    if not scores.factuality.passed and scores.factuality.reason:
        reasons.append(f"factuality: {scores.factuality.reason}")
    if not scores.rubric.passed and scores.rubric.reason:
        reasons.append(f"rubric: {scores.rubric.reason}")
    if not scores.hallucinations.passed and scores.hallucinations.reason:
        reasons.append(f"hallucinations: {scores.hallucinations.reason}")
    if not scores.readability.passed and scores.readability.reason:
        reasons.append(f"readability: {scores.readability.reason}")
    if not scores.word_count.passed and scores.word_count.reason:
        reasons.append(f"word_count: {scores.word_count.reason}")

    passed = all(
        (
            scores.factuality.passed,
            scores.rubric.passed,
            scores.hallucinations.passed,
            scores.readability.passed,
            scores.word_count.passed,
        )
    )

    log.info(
        "evals.gate.complete",
        extra={
            "funder_name": funder_name,
            "passed": passed,
            "factuality_passed": scores.factuality.passed,
            "rubric_passed": scores.rubric.passed,
            "hallucinations_passed": scores.hallucinations.passed,
            "readability_passed": scores.readability.passed,
            "word_count_passed": scores.word_count.passed,
            "fail_reason_count": len(reasons),
        },
    )

    return EvalResult(
        passed=passed,
        reasons=reasons,
        scores=scores,
        funder_name=funder_name,
    )
