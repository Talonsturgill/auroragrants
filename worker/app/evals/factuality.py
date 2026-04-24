"""Factuality LLM judge.

For each sentence in the draft, ask Claude Sonnet whether the cited
chunk supports it. Returns a per-sentence support score in [0, 1] and
an aggregate score equal to the proportion of sentences whose score
meets `FACTUALITY_PER_SENTENCE_THRESHOLD`.

A sentence without a citation token is scored 0 (no support). A
sentence citing an unknown chunk id is also scored 0. Only sentences
with at least one resolvable citation are sent to the LLM judge.

Logging never contains draft text, chunk excerpts, or the raw LLM
response. We log counts, attempt numbers, and short error slices only.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from anthropic import AsyncAnthropic

from app.evals.prompts import FACTUALITY_PROMPT
from app.evals.thresholds import (
    FACTUALITY_PER_SENTENCE_THRESHOLD,
    FACTUALITY_PROPORTION_THRESHOLD,
)

log = logging.getLogger(__name__)

_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS = 3000
_TEMPERATURE = 0.0
_ERR_SLICE = 200

# Split on sentence-final punctuation followed by whitespace. Not
# perfect English but robust enough for grant narratives, which
# overwhelmingly use periods.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
# Citation tokens like [1], [12]. Only the first digit group per token.
_CITATION = re.compile(r"\[(\d+)\]")


@dataclass
class SentenceResult:
    """Per-sentence score detail for logging and UI display."""

    sentence_index: int
    cited_chunk_id: str | None
    support_score: float
    has_citation: bool
    reason: str


@dataclass
class FactualityResult:
    """Aggregate factuality result."""

    sentences: list[SentenceResult] = field(default_factory=list)
    per_sentence_threshold: float = FACTUALITY_PER_SENTENCE_THRESHOLD
    proportion_threshold: float = FACTUALITY_PROPORTION_THRESHOLD
    proportion_passing: float = 0.0
    mean_score: float = 0.0
    passed: bool = False
    reason: str | None = None


def split_sentences(content: str) -> list[str]:
    """Split a draft into non-empty, trimmed sentences."""
    return [s.strip() for s in _SENTENCE_SPLIT.split(content) if s.strip()]


def _first_citation_id(sentence: str) -> str | None:
    """Return the first `[n]` citation id as a string, else None."""
    match = _CITATION.search(sentence)
    return match.group(1) if match else None


def _citation_excerpt(citations: list[dict[str, Any]], cite_id: str) -> str | None:
    """Resolve a citation id to the chunk excerpt, if present.

    Citations are shaped `{"id": "[1]", "chunk_id": ..., "excerpt": ...}`.
    The id can appear either as `"[1]"` or `"1"` depending on the caller,
    so we normalize by stripping the brackets.
    """
    target = cite_id.strip().strip("[]")
    for c in citations:
        raw_id = c.get("id", "")
        if not isinstance(raw_id, str):
            continue
        normalized = raw_id.strip().strip("[]")
        if normalized == target:
            excerpt = c.get("excerpt") or c.get("content")
            return excerpt if isinstance(excerpt, str) else None
    return None


def _strip_fence(text: str) -> str:
    """Strip an optional ```json fence before JSON parsing."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped


def _response_text(response: Any) -> str:
    """Pull the first text block out of an Anthropic Messages response."""
    content = getattr(response, "content", None) or []
    for block in content:
        block_type = getattr(block, "type", None) or (
            block.get("type") if isinstance(block, dict) else None
        )
        if block_type == "text":
            text = getattr(block, "text", None)
            if text is None and isinstance(block, dict):
                text = block.get("text")
            if isinstance(text, str):
                return text
    return ""


async def run_factuality_check(
    draft_content: str,
    citations: list[dict[str, Any]],
    anthropic_client: AsyncAnthropic,
) -> FactualityResult:
    """Score each sentence in the draft and aggregate to a proportion.

    Sentences without citations are scored 0 automatically and never
    reach the LLM. Sentences whose citation id does not resolve to a
    known chunk are also scored 0 without an LLM call.
    """
    sentences = split_sentences(draft_content)
    if not sentences:
        return FactualityResult(
            sentences=[],
            proportion_passing=0.0,
            mean_score=0.0,
            passed=False,
            reason="no sentences in draft",
        )

    # Build per-sentence pair list for the LLM. Sentences without a
    # resolvable citation are handled locally.
    pairs: list[dict[str, Any]] = []
    sentence_meta: list[dict[str, Any]] = []
    for idx, sentence in enumerate(sentences):
        cite_id = _first_citation_id(sentence)
        if cite_id is None:
            sentence_meta.append(
                {
                    "sentence_index": idx,
                    "cited_chunk_id": None,
                    "has_citation": False,
                    "llm_eligible": False,
                }
            )
            continue
        excerpt = _citation_excerpt(citations, cite_id)
        if not excerpt:
            sentence_meta.append(
                {
                    "sentence_index": idx,
                    "cited_chunk_id": cite_id,
                    "has_citation": True,
                    "llm_eligible": False,
                }
            )
            continue
        sentence_meta.append(
            {
                "sentence_index": idx,
                "cited_chunk_id": cite_id,
                "has_citation": True,
                "llm_eligible": True,
            }
        )
        pairs.append(
            {
                "sentence_index": idx,
                "sentence": sentence,
                "cited_chunk_id": cite_id,
                "chunk_excerpt": excerpt,
            }
        )

    llm_scores: dict[int, tuple[float, str]] = {}
    if pairs:
        llm_scores = await _call_factuality_judge(pairs, anthropic_client)

    details: list[SentenceResult] = []
    passing = 0
    score_sum = 0.0
    for meta in sentence_meta:
        idx = meta["sentence_index"]
        if not meta["llm_eligible"]:
            reason = (
                "sentence has no citation"
                if not meta["has_citation"]
                else f"cited chunk id {meta['cited_chunk_id']} not in citations"
            )
            details.append(
                SentenceResult(
                    sentence_index=idx,
                    cited_chunk_id=meta["cited_chunk_id"],
                    support_score=0.0,
                    has_citation=bool(meta["has_citation"]),
                    reason=reason,
                )
            )
            continue
        score, reason = llm_scores.get(idx, (0.0, "no llm result"))
        score = max(0.0, min(1.0, score))
        score_sum += score
        if score >= FACTUALITY_PER_SENTENCE_THRESHOLD:
            passing += 1
        details.append(
            SentenceResult(
                sentence_index=idx,
                cited_chunk_id=meta["cited_chunk_id"],
                support_score=score,
                has_citation=True,
                reason=reason,
            )
        )

    total = len(sentences)
    # Count every sentence toward the proportion so an uncited sentence
    # drags the score down. This matches the spec: "90% of sentences
    # have support_score >= 0.9".
    for meta in sentence_meta:
        if meta["llm_eligible"]:
            continue
        # non-eligible sentence already appended with 0.0
    proportion = passing / total if total else 0.0
    mean_score = score_sum / total if total else 0.0
    passed = proportion >= FACTUALITY_PROPORTION_THRESHOLD
    reason = (
        None
        if passed
        else f"only {passing}/{total} sentences met support threshold {FACTUALITY_PER_SENTENCE_THRESHOLD:.2f}"
    )
    return FactualityResult(
        sentences=details,
        proportion_passing=proportion,
        mean_score=mean_score,
        passed=passed,
        reason=reason,
    )


async def _call_factuality_judge(
    pairs: list[dict[str, Any]],
    anthropic_client: AsyncAnthropic,
) -> dict[int, tuple[float, str]]:
    """Call the LLM judge and return {sentence_index: (score, reason)}."""
    user_body = FACTUALITY_PROMPT.user_template.replace(
        "{sentence_chunk_pairs_json}", json.dumps(pairs, ensure_ascii=False)
    )

    try:
        response = await anthropic_client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            system=FACTUALITY_PROMPT.system,
            messages=[{"role": "user", "content": user_body}],
        )
    except Exception as exc:
        log.warning(
            "evals.factuality.call_failed",
            extra={
                "error_type": type(exc).__name__,
                "error_slice": str(exc)[:_ERR_SLICE],
                "pair_count": len(pairs),
            },
        )
        raise

    text = _response_text(response)
    try:
        payload = json.loads(_strip_fence(text))
    except json.JSONDecodeError:
        log.warning(
            "evals.factuality.bad_json",
            extra={"pair_count": len(pairs), "text_len": len(text)},
        )
        return {}

    results = payload.get("results") or []
    out: dict[int, tuple[float, str]] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item.get("sentence_index"))
        except (TypeError, ValueError):
            continue
        try:
            score = float(item.get("support_score", 0.0))
        except (TypeError, ValueError):
            score = 0.0
        reason = item.get("reason") or ""
        if not isinstance(reason, str):
            reason = str(reason)
        out[idx] = (score, reason)

    log.info(
        "evals.factuality.complete",
        extra={
            "pair_count": len(pairs),
            "results_count": len(out),
        },
    )
    return out
