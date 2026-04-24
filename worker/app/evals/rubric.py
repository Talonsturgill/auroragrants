"""Independent rubric adherence LLM judge.

This judge is separate from the WCE loop's Critic. The Critic inside
the loop already scores and gates at 8.0/10. This module re-scores the
final draft against the same rubric items and requires 7.5/10 as a
second opinion.

The rubric is a list of items shaped:
  [{"id": "community_impact", "label": "...", "weight": 0.25,
    "scoring": [{"score": 0, "desc": "..."}, ...]}]

The judge returns `{<item_id>: {"score": 0-2, "justification": "..."}}`.
We compute a weighted score, normalize to 0-10, and compare to the
threshold 7.5. The normalized score lives on the result so callers can
present the breakdown to reviewers.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from anthropic import AsyncAnthropic

from app.evals.prompts import RUBRIC_SCORER_PROMPT
from app.evals.thresholds import RUBRIC_THRESHOLD

log = logging.getLogger(__name__)

_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS = 2000
_TEMPERATURE = 0.0
_ERR_SLICE = 200
_MAX_ITEM_SCORE = 2.0


@dataclass
class RubricItemScore:
    """Per-rubric-item detail."""

    item_id: str
    score: float
    weight: float
    justification: str


@dataclass
class RubricResult:
    """Aggregate rubric adherence result."""

    items: list[RubricItemScore] = field(default_factory=list)
    normalized_score: float = 0.0  # 0.0 - 1.0
    overall_score_10: float = 0.0  # 0.0 - 10.0
    threshold: float = RUBRIC_THRESHOLD
    passed: bool = False
    reason: str | None = None


def _strip_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped


def _response_text(response: Any) -> str:
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


def _normalize_weights(rubric: list[dict[str, Any]]) -> list[float]:
    """Return per-item weights that sum to 1.0.

    If every item has `weight`, we use them as-is (and renormalize if
    they don't already sum to 1.0). If weights are missing, each item
    gets 1/N. Negative or non-numeric weights are coerced to 0.
    """
    if not rubric:
        return []
    weights: list[float] = []
    for item in rubric:
        w = item.get("weight") if isinstance(item, dict) else None
        try:
            wf = float(w) if w is not None else 0.0
        except (TypeError, ValueError):
            wf = 0.0
        if wf < 0:
            wf = 0.0
        weights.append(wf)

    total = sum(weights)
    if total <= 0:
        # Equal weights.
        return [1.0 / len(rubric)] * len(rubric)
    return [w / total for w in weights]


async def run_rubric_check(
    draft_content: str,
    rubric: list[dict[str, Any]],
    anthropic_client: AsyncAnthropic,
) -> RubricResult:
    """Score the draft against `rubric` and aggregate to 0-10."""
    if not rubric:
        # No rubric to score against. Treat as pass but flag in reason.
        return RubricResult(
            items=[],
            normalized_score=1.0,
            overall_score_10=10.0,
            passed=True,
            reason="no rubric supplied",
        )

    weights = _normalize_weights(rubric)
    scores_by_id = await _call_rubric_judge(draft_content, rubric, anthropic_client)

    items: list[RubricItemScore] = []
    weighted_sum = 0.0
    for item, weight in zip(rubric, weights, strict=False):
        rid = item.get("id", "") if isinstance(item, dict) else ""
        hit = scores_by_id.get(rid, {})
        try:
            raw_score = float(hit.get("score", 0.0)) if isinstance(hit, dict) else 0.0
        except (TypeError, ValueError):
            raw_score = 0.0
        raw_score = max(0.0, min(_MAX_ITEM_SCORE, raw_score))
        justification = ""
        if isinstance(hit, dict):
            j = hit.get("justification", "")
            justification = j if isinstance(j, str) else str(j)
        items.append(
            RubricItemScore(
                item_id=rid,
                score=raw_score,
                weight=weight,
                justification=justification,
            )
        )
        weighted_sum += raw_score * weight

    # weighted_sum is in [0, 2] because scores are in [0, 2] and weights sum to 1.
    normalized = weighted_sum / _MAX_ITEM_SCORE  # [0, 1]
    overall_10 = normalized * 10.0
    passed = normalized >= RUBRIC_THRESHOLD
    reason = (
        None
        if passed
        else f"rubric overall_score_10 {overall_10:.2f} below {RUBRIC_THRESHOLD * 10:.2f}"
    )
    return RubricResult(
        items=items,
        normalized_score=normalized,
        overall_score_10=overall_10,
        passed=passed,
        reason=reason,
    )


async def _call_rubric_judge(
    draft_content: str,
    rubric: list[dict[str, Any]],
    anthropic_client: AsyncAnthropic,
) -> dict[str, dict[str, Any]]:
    """Call the LLM judge. Returns `{item_id: {score, justification}}`."""
    user_body = RUBRIC_SCORER_PROMPT.user_template.replace(
        "{rubric_json}", json.dumps(rubric, ensure_ascii=False)
    ).replace("{draft_content}", draft_content)

    try:
        response = await anthropic_client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            system=RUBRIC_SCORER_PROMPT.system,
            messages=[{"role": "user", "content": user_body}],
        )
    except Exception as exc:
        log.warning(
            "evals.rubric.call_failed",
            extra={
                "error_type": type(exc).__name__,
                "error_slice": str(exc)[:_ERR_SLICE],
                "rubric_items": len(rubric),
            },
        )
        raise

    text = _response_text(response)
    try:
        payload = json.loads(_strip_fence(text))
    except json.JSONDecodeError:
        log.warning(
            "evals.rubric.bad_json",
            extra={"rubric_items": len(rubric), "text_len": len(text)},
        )
        return {}

    raw = payload.get("scores") if isinstance(payload, dict) else None
    if not isinstance(raw, dict):
        return {}

    out: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if isinstance(value, dict) and isinstance(key, str):
            out[key] = value

    log.info(
        "evals.rubric.complete",
        extra={"rubric_items": len(rubric), "scored_items": len(out)},
    )
    return out
