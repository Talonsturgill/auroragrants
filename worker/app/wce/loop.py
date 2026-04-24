"""Writer-Critic-Editor loop.

Ported from /starter/wce/loop.py. The loop:
  1. Writer drafts the field given retrieved chunks, funder rubric, org context.
  2. Critic scores the draft and returns structured fixes.
  3. If Critic says ready_to_surface, exit.
  4. Otherwise, Editor applies fixes and we go back to step 2.
  5. Max iterations: 5. If not ready after 5, surface the best draft with a flag.

Model routing follows /docs/01-architecture.md:
  - Writer and Editor: Claude Sonnet 4.6
  - Critic: Sonnet 4.6 by default. Opus 4.6 when the caller marks the
    draft high_stakes.

Surface decision thresholds:
  - overall_score >= 8.0 AND no "high" severity fixes -> "surface"
  - overall_score >= 6.0 -> "surface_with_flag"
  - otherwise -> "block"

We never log the draft content, prompt body, or raw Anthropic response.
Only coarse metadata: iteration count, token counts, overall_score, and
a short error slice on exception.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from anthropic import AsyncAnthropic

from app.retrieve.models import RetrievedChunk

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (surface thresholds, iteration cap, models, token budgets).
# ---------------------------------------------------------------------------

MAX_ITERATIONS = 5
SURFACE_THRESHOLD = 8.0
FLAG_THRESHOLD = 6.0

MODEL_WRITER = "claude-sonnet-4-6"
MODEL_CRITIC_STANDARD = "claude-sonnet-4-6"
MODEL_CRITIC_HIGH_STAKES = "claude-opus-4-6"
MODEL_EDITOR = "claude-sonnet-4-6"

_WRITER_MAX_TOKENS = 4096
_CRITIC_MAX_TOKENS = 2048
_EDITOR_MAX_TOKENS = 4096

_WRITER_TEMPERATURE = 0.2
_CRITIC_TEMPERATURE = 0.0
_EDITOR_TEMPERATURE = 0.2

# Error-message slice to log without leaking prompt or response content.
_ERR_SLICE = 200

# Prompt file roots resolved relative to the repo root. The worker lives at
# <repo>/worker/app/wce/; the prompt files live at <repo>/worker/prompts/.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_PROMPTS_DIR = _REPO_ROOT / "worker" / "prompts"

# Per-million-token prices for cost accounting. Updated out of band via env.
_PRICES_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-6": (15.00, 75.00),
    "claude-haiku-4-6": (1.00, 5.00),
}


# ---------------------------------------------------------------------------
# Envelopes (return shapes)
# ---------------------------------------------------------------------------


@dataclass
class Draft:
    content: str
    citations: list[dict[str, Any]]
    word_count: int
    uncovered_claims: list[str] = field(default_factory=list)


@dataclass
class Critique:
    rubric_scores: dict[str, Any]
    overall_score: float
    fixes: list[dict[str, Any]]
    ready_to_surface: bool


@dataclass
class IterationTrace:
    iteration: int
    writer_tokens_in: int
    writer_tokens_out: int
    critic_tokens_in: int
    critic_tokens_out: int
    editor_tokens_in: int
    editor_tokens_out: int
    overall_score: float
    ready_to_surface: bool
    model_writer: str
    model_critic: str
    model_editor: str
    duration_ms: int


@dataclass
class WCEResult:
    draft: Draft
    critique: Critique
    iterations: list[IterationTrace]
    total_tokens_in: int
    total_tokens_out: int
    total_cost_cents: int
    final_iteration: int
    surface_decision: str  # "surface" | "surface_with_flag" | "block"
    model_writer: str
    model_critic: str
    model_editor: str


# ---------------------------------------------------------------------------
# Prompt loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PromptParts:
    system: str
    user_template: str


def _load_prompt(name: str) -> _PromptParts:
    """Parse /worker/prompts/<name>.md into system + user sections.

    Each prompt file carries a YAML frontmatter block delimited by `---`,
    then a `# System` section, then a `# User` section. We split on the
    top-level headings. Raises RuntimeError if the file is malformed so
    a bad prompt is caught at import time rather than in a request.
    """
    path = _PROMPTS_DIR / f"{name}.md"
    raw = path.read_text(encoding="utf-8")
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) == 3:
            raw = parts[2].lstrip()
    match = re.search(r"(?ms)^# System\s*\n(.*?)\n# User\s*\n(.*)$", raw)
    if not match:
        raise RuntimeError(f"{name} prompt file is malformed: missing System/User headings")
    return _PromptParts(system=match.group(1).strip(), user_template=match.group(2).strip())


# Cache prompts at import time so a malformed prompt fails fast and each
# request avoids redundant filesystem reads.
_WRITER_PROMPT = _load_prompt("writer")
_CRITIC_PROMPT = _load_prompt("critic")
_EDITOR_PROMPT = _load_prompt("editor")


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


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


def _usage_tokens(response: Any) -> tuple[int, int]:
    """Read input/output token counts from the response usage object."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return (0, 0)
    tokens_in = getattr(usage, "input_tokens", 0) or 0
    tokens_out = getattr(usage, "output_tokens", 0) or 0
    if isinstance(usage, dict):
        tokens_in = usage.get("input_tokens", tokens_in) or 0
        tokens_out = usage.get("output_tokens", tokens_out) or 0
    return int(tokens_in), int(tokens_out)


def _extract_json(text: str) -> dict[str, Any]:
    """Parse the model response as JSON. Tolerates a ```json fence."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        loaded: Any = json.loads(stripped)
    except json.JSONDecodeError:
        return {}
    if not isinstance(loaded, dict):
        return {}
    return loaded


def _estimate_cost_cents(model: str, tokens_in: int, tokens_out: int) -> int:
    """Cents of spend for a call. Unknown models fall back to Sonnet prices."""
    pin, pout = _PRICES_USD_PER_MTOK.get(model, _PRICES_USD_PER_MTOK["claude-sonnet-4-6"])
    dollars = (tokens_in / 1_000_000.0) * pin + (tokens_out / 1_000_000.0) * pout
    return int(round(dollars * 100))


def _chunks_for_prompt(chunks: list[RetrievedChunk]) -> list[dict[str, Any]]:
    """Render RetrievedChunk records as prompt-friendly dicts."""
    return [
        {
            "id": f"[{c.citation_id}]",
            "chunk_id": c.chunk_id,
            "document_id": c.document_id,
            "page_start": c.page_start,
            "page_end": c.page_end,
            "section": c.section_heading,
            "content_type": c.content_type,
            "source": c.source,
            "content": c.content,
        }
        for c in chunks
    ]


def _citation_envelope(
    chunks: list[RetrievedChunk], writer_citations: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Project Writer-emitted citations back into the canonical envelope.

    The wire contract requires each citation to carry id, document_id,
    chunk_id, page_start, page_end, excerpt, and section_heading. The
    Writer may only emit {id, page, excerpt} per the prompt template, so
    we join those to the retrieved chunk set on citation id.
    """
    by_id: dict[str, RetrievedChunk] = {f"[{c.citation_id}]": c for c in chunks}
    by_id.update({str(c.citation_id): c for c in chunks})

    out: list[dict[str, Any]] = []
    for item in writer_citations:
        raw_id = item.get("id")
        marker = f"[{raw_id}]" if isinstance(raw_id, int) else str(raw_id or "")
        chunk = by_id.get(marker) or by_id.get(str(raw_id).strip("[]"))
        if chunk is None:
            # Keep whatever the Writer said rather than drop the citation;
            # the evals harness will flag it.
            out.append(
                {
                    "id": marker or str(raw_id),
                    "document_id": item.get("document_id", ""),
                    "chunk_id": item.get("chunk_id", ""),
                    "page_start": int(item.get("page") or 0),
                    "page_end": int(item.get("page") or 0),
                    "excerpt": str(item.get("excerpt", "")),
                    "section_heading": item.get("section"),
                }
            )
            continue
        out.append(
            {
                "id": f"[{chunk.citation_id}]",
                "document_id": chunk.document_id,
                "chunk_id": chunk.chunk_id,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "excerpt": str(item.get("excerpt") or chunk.content[:240]),
                "section_heading": chunk.section_heading,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Anthropic call helpers
# ---------------------------------------------------------------------------


async def _call_anthropic(
    client: AsyncAnthropic,
    *,
    role: str,
    model: str,
    system: str,
    user_body: str,
    max_tokens: int,
    temperature: float,
) -> Any:
    """One Anthropic round trip. Centralised so exceptions are logged without
    leaking system or user content. The caller re-raises so the route layer
    can convert to a 5xx response.
    """
    try:
        return await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[{"role": "user", "content": user_body}],
        )
    except Exception as exc:
        log.warning(
            "wce.call_failed",
            extra={
                "role": role,
                "model": model,
                "error_type": type(exc).__name__,
                "error_slice": str(exc)[:_ERR_SLICE],
            },
        )
        raise


def _render(template: str, values: dict[str, str]) -> str:
    """Plain placeholder substitution for `{key}` tokens. Never f-string."""
    out = template
    for key, value in values.items():
        out = out.replace("{" + key + "}", value)
    return out


# ---------------------------------------------------------------------------
# Writer / Critic / Editor steps
# ---------------------------------------------------------------------------


async def _writer_step(
    client: AsyncAnthropic,
    *,
    funder: dict[str, Any],
    rubric: list[dict[str, Any]],
    field_meta: dict[str, Any],
    org_context: dict[str, Any],
    chunks: list[RetrievedChunk],
) -> tuple[Draft, int, int]:
    user = _render(
        _WRITER_PROMPT.user_template,
        {
            "funder_name": str(funder.get("name", "")),
            "rubric_json": json.dumps(rubric),
            "field_label": str(field_meta.get("label", "")),
            "field_type": str(field_meta.get("field_type", "")),
            "word_count_max": json.dumps(field_meta.get("word_count_max")),
            "word_count_min": json.dumps(field_meta.get("word_count_min")),
            "retrieved_chunks_json": json.dumps(_chunks_for_prompt(chunks)),
            "org_context_json": json.dumps(org_context),
        },
    )
    resp = await _call_anthropic(
        client,
        role="writer",
        model=MODEL_WRITER,
        system=_WRITER_PROMPT.system,
        user_body=user,
        max_tokens=_WRITER_MAX_TOKENS,
        temperature=_WRITER_TEMPERATURE,
    )
    parsed = _extract_json(_response_text(resp))
    content = str(parsed.get("draft_content", ""))
    word_count = parsed.get("word_count")
    if not isinstance(word_count, int):
        word_count = len(content.split())
    citations = parsed.get("citations") or []
    if not isinstance(citations, list):
        citations = []
    uncovered = parsed.get("uncovered_claims") or []
    if not isinstance(uncovered, list):
        uncovered = []
    tin, tout = _usage_tokens(resp)
    draft = Draft(
        content=content,
        citations=_citation_envelope(chunks, citations),
        word_count=int(word_count),
        uncovered_claims=[str(c) for c in uncovered],
    )
    return draft, tin, tout


async def _critic_step(
    client: AsyncAnthropic,
    *,
    funder: dict[str, Any],
    rubric: list[dict[str, Any]],
    field_meta: dict[str, Any],
    draft: Draft,
    chunks: list[RetrievedChunk],
    high_stakes: bool,
) -> tuple[Critique, int, int, str]:
    model = MODEL_CRITIC_HIGH_STAKES if high_stakes else MODEL_CRITIC_STANDARD
    user = _render(
        _CRITIC_PROMPT.user_template,
        {
            "funder_name": str(funder.get("name", "")),
            "rubric_json": json.dumps(rubric),
            "field_label": str(field_meta.get("label", "")),
            "word_count_max": json.dumps(field_meta.get("word_count_max")),
            "draft_content": draft.content,
            "citations_json": json.dumps(draft.citations),
            "retrieved_chunks_json": json.dumps(_chunks_for_prompt(chunks)),
        },
    )
    resp = await _call_anthropic(
        client,
        role="critic",
        model=model,
        system=_CRITIC_PROMPT.system,
        user_body=user,
        max_tokens=_CRITIC_MAX_TOKENS,
        temperature=_CRITIC_TEMPERATURE,
    )
    parsed = _extract_json(_response_text(resp))
    rubric_scores = parsed.get("rubric_scores") or {}
    if not isinstance(rubric_scores, dict):
        rubric_scores = {}
    fixes = parsed.get("fixes") or []
    if not isinstance(fixes, list):
        fixes = []
    overall_raw = parsed.get("overall_score", 0.0)
    try:
        overall = float(overall_raw)
    except (TypeError, ValueError):
        overall = 0.0
    ready = bool(parsed.get("ready_to_surface", False))
    tin, tout = _usage_tokens(resp)
    critique = Critique(
        rubric_scores=rubric_scores,
        overall_score=overall,
        fixes=[f for f in fixes if isinstance(f, dict)],
        ready_to_surface=ready,
    )
    return critique, tin, tout, model


async def _editor_step(
    client: AsyncAnthropic,
    *,
    draft: Draft,
    critique: Critique,
    chunks: list[RetrievedChunk],
) -> tuple[Draft, int, int]:
    user = _render(
        _EDITOR_PROMPT.user_template,
        {
            "draft_content": draft.content,
            "fixes_json": json.dumps(critique.fixes),
            "retrieved_chunks_json": json.dumps(_chunks_for_prompt(chunks)),
        },
    )
    resp = await _call_anthropic(
        client,
        role="editor",
        model=MODEL_EDITOR,
        system=_EDITOR_PROMPT.system,
        user_body=user,
        max_tokens=_EDITOR_MAX_TOKENS,
        temperature=_EDITOR_TEMPERATURE,
    )
    parsed = _extract_json(_response_text(resp))
    content = str(parsed.get("revised_content", draft.content))
    word_count = parsed.get("word_count")
    if not isinstance(word_count, int):
        word_count = len(content.split())
    new_citations = parsed.get("citations")
    if isinstance(new_citations, list) and new_citations:
        citations = _citation_envelope(chunks, new_citations)
    else:
        citations = draft.citations
    tin, tout = _usage_tokens(resp)
    revised = Draft(
        content=content,
        citations=citations,
        word_count=int(word_count),
        uncovered_claims=list(draft.uncovered_claims),
    )
    return revised, tin, tout


# ---------------------------------------------------------------------------
# Surface decision
# ---------------------------------------------------------------------------


def _surface_decision(critique: Critique) -> str:
    """Decide whether to surface the draft. Severity-high fixes always block
    a clean surface, even if the overall score is above threshold.
    """
    has_high = any(
        isinstance(fix, dict) and fix.get("severity") == "high" for fix in critique.fixes
    )
    if critique.overall_score >= SURFACE_THRESHOLD and not has_high:
        return "surface"
    if critique.overall_score >= FLAG_THRESHOLD:
        return "surface_with_flag"
    return "block"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def run_wce_loop(
    *,
    client: AsyncAnthropic,
    chunks: list[RetrievedChunk],
    funder: dict[str, Any],
    rubric: list[dict[str, Any]],
    field_meta: dict[str, Any],
    org_context: dict[str, Any],
    high_stakes: bool = False,
) -> WCEResult:
    """Run the Writer-Critic-Editor loop.

    The caller supplies the retrieved chunks. Tests inject a fake client
    and synthetic chunks so this function does no network or database work.

    The loop tracks the highest-scoring iteration and returns that draft
    and critique if no iteration reaches ready_to_surface inside the cap.
    """
    iterations: list[IterationTrace] = []
    total_in = 0
    total_out = 0
    total_cents = 0

    t_writer = time.perf_counter()
    draft, wi, wo = await _writer_step(
        client,
        funder=funder,
        rubric=rubric,
        field_meta=field_meta,
        org_context=org_context,
        chunks=chunks,
    )
    total_in += wi
    total_out += wo
    total_cents += _estimate_cost_cents(MODEL_WRITER, wi, wo)

    best_draft: Draft = draft
    best_critique: Critique | None = None
    best_score: float = -1.0
    critic_model_used: str = MODEL_CRITIC_HIGH_STAKES if high_stakes else MODEL_CRITIC_STANDARD

    for i in range(1, MAX_ITERATIONS + 1):
        iter_started = time.perf_counter()
        critique, ci, co, critic_model = await _critic_step(
            client,
            funder=funder,
            rubric=rubric,
            field_meta=field_meta,
            draft=draft,
            chunks=chunks,
            high_stakes=high_stakes,
        )
        total_in += ci
        total_out += co
        total_cents += _estimate_cost_cents(critic_model, ci, co)
        critic_model_used = critic_model

        if critique.overall_score > best_score:
            best_score = critique.overall_score
            best_draft = draft
            best_critique = critique

        if critique.ready_to_surface or i == MAX_ITERATIONS:
            iterations.append(
                IterationTrace(
                    iteration=i,
                    writer_tokens_in=(wi if i == 1 else 0),
                    writer_tokens_out=(wo if i == 1 else 0),
                    critic_tokens_in=ci,
                    critic_tokens_out=co,
                    editor_tokens_in=0,
                    editor_tokens_out=0,
                    overall_score=critique.overall_score,
                    ready_to_surface=critique.ready_to_surface,
                    model_writer=MODEL_WRITER,
                    model_critic=critic_model,
                    model_editor=MODEL_EDITOR,
                    duration_ms=int((time.perf_counter() - iter_started) * 1000),
                )
            )
            break

        draft, ei, eo = await _editor_step(
            client,
            draft=draft,
            critique=critique,
            chunks=chunks,
        )
        total_in += ei
        total_out += eo
        total_cents += _estimate_cost_cents(MODEL_EDITOR, ei, eo)

        iterations.append(
            IterationTrace(
                iteration=i,
                writer_tokens_in=(wi if i == 1 else 0),
                writer_tokens_out=(wo if i == 1 else 0),
                critic_tokens_in=ci,
                critic_tokens_out=co,
                editor_tokens_in=ei,
                editor_tokens_out=eo,
                overall_score=critique.overall_score,
                ready_to_surface=False,
                model_writer=MODEL_WRITER,
                model_critic=critic_model,
                model_editor=MODEL_EDITOR,
                duration_ms=int((time.perf_counter() - iter_started) * 1000),
            )
        )

    # If the loop completed on ready_to_surface, the current draft is the
    # surfaced one. If the cap tripped, `best_draft` holds the highest
    # scored version. `best_critique` is always populated because the loop
    # runs the critic at least once before this point.
    if best_critique is None:
        best_critique = Critique(rubric_scores={}, overall_score=0.0, fixes=[], ready_to_surface=False)

    # Prefer the iteration that was flagged ready_to_surface, otherwise use
    # the best-scoring intermediate draft.
    final_critique: Critique
    final_draft: Draft
    if iterations and iterations[-1].ready_to_surface:
        # `draft` still holds the content the Critic just approved.
        final_draft = draft
        # Need the matching Critique. Since the critic_step just returned
        # `critique` with ready=True, use that.
        final_critique = critique  # type: ignore[has-type]
    else:
        final_draft = best_draft
        final_critique = best_critique

    # Unused but required if starter trace calls cared. Silences ruff/mypy.
    _ = time.perf_counter() - t_writer

    decision = _surface_decision(final_critique)

    log.info(
        "wce.complete",
        extra={
            "iterations": len(iterations),
            "overall_score": final_critique.overall_score,
            "ready_to_surface": final_critique.ready_to_surface,
            "surface_decision": decision,
            "tokens_in": total_in,
            "tokens_out": total_out,
            "high_stakes": high_stakes,
        },
    )

    return WCEResult(
        draft=final_draft,
        critique=final_critique,
        iterations=iterations,
        total_tokens_in=total_in,
        total_tokens_out=total_out,
        total_cost_cents=total_cents,
        final_iteration=len(iterations),
        surface_decision=decision,
        model_writer=MODEL_WRITER,
        model_critic=critic_model_used,
        model_editor=MODEL_EDITOR,
    )


# ---------------------------------------------------------------------------
# Trace serialization
# ---------------------------------------------------------------------------


def trace_dict(result: WCEResult) -> dict[str, Any]:
    """Render the full trace as a JSON-safe dict for storage in
    `drafts.wce_trace`. Callers never mutate the result directly.
    """
    return {
        "iterations": [asdict(i) for i in result.iterations],
        "final_iteration": result.final_iteration,
        "total_tokens_in": result.total_tokens_in,
        "total_tokens_out": result.total_tokens_out,
        "total_cost_cents": result.total_cost_cents,
        "surface_decision": result.surface_decision,
        "model_writer": result.model_writer,
        "model_critic": result.model_critic,
        "model_editor": result.model_editor,
        "prompt_versions": {
            "writer": 1,
            "critic": 1,
            "editor": 1,
        },
    }
