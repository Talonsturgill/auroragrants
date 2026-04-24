"""Eval harness routes.

POST /evals/gate — the pre-surface evaluation gate every draft must
pass before it is shown to a user. The Next.js API layer calls this
AFTER the WCE loop returns a draft, and merges the returned scores
into the `drafts` row.

GET /evals/drift/{tenant_id} — rolling drift scorecard. Wired in Phase 5.

See /docs/06-eval-harness.md for the spec and /docs/07-prompts.md for
the judge prompts.
"""

from __future__ import annotations

import logging
from typing import Any

from anthropic import AsyncAnthropic
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.evals import EvalResult, run_eval_gate

log = logging.getLogger(__name__)
router = APIRouter()


class CitationIn(BaseModel):
    """Inline citation attached to a sentence in the draft."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1)
    chunk_id: str | None = None
    document_id: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    excerpt: str | None = None
    section_heading: str | None = None


class ChunkIn(BaseModel):
    """A retrieved chunk used by the Writer. Same shape as a citation."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    chunk_id: str | None = None
    document_id: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    excerpt: str | None = None
    content: str | None = None
    section_heading: str | None = None


class RubricItemIn(BaseModel):
    """One rubric item from the funder graph."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1)
    label: str | None = None
    weight: float | None = None
    description: str | None = None


class GateRequest(BaseModel):
    """Inputs for POST /evals/gate."""

    model_config = ConfigDict(extra="forbid")

    draft_content: str = Field(min_length=1)
    citations: list[CitationIn] = Field(default_factory=list)
    retrieved_chunks: list[ChunkIn] = Field(default_factory=list)
    rubric: list[RubricItemIn] = Field(default_factory=list)
    funder_name: str = Field(min_length=1)
    word_count_min: int | None = None
    word_count_max: int | None = None
    known_programs: list[str] = Field(default_factory=list)


def _anthropic_client(request: Request) -> AsyncAnthropic:
    """Return the shared AsyncAnthropic client, or 503 when absent."""
    client = getattr(request.app.state, "anthropic", None)
    if client is None:
        raise HTTPException(status_code=503, detail="evals_not_configured")
    return client  # type: ignore[no-any-return]


def _to_dict_list(items: list[Any]) -> list[dict[str, Any]]:
    """Convert a list of pydantic models to plain dicts for the gate."""
    out: list[dict[str, Any]] = []
    for item in items:
        if hasattr(item, "model_dump"):
            out.append(item.model_dump(exclude_none=False))
        elif isinstance(item, dict):
            out.append(item)
    return out


@router.post("/gate", response_model=EvalResult)
async def run_gate(req: GateRequest, request: Request) -> EvalResult:
    """Run the pre-surface eval gate against a draft.

    Tenant-scoped: the middleware attaches `tenant_id` to request.state
    and 401s anything without a valid bearer token. We do not otherwise
    persist anything here; the gate is a pure function over inputs, and
    the caller merges the returned scores into `drafts.eval_scores`.
    """
    mw_tenant_id: str | None = getattr(request.state, "tenant_id", None)
    if not mw_tenant_id:
        raise HTTPException(status_code=401, detail="missing_tenant")

    client = _anthropic_client(request)

    result = await run_eval_gate(
        draft_content=req.draft_content,
        citations=_to_dict_list(req.citations),
        retrieved_chunks=_to_dict_list(req.retrieved_chunks),
        rubric=_to_dict_list(req.rubric),
        funder_name=req.funder_name,
        word_count_min=req.word_count_min,
        word_count_max=req.word_count_max,
        anthropic_client=client,
        known_programs=list(req.known_programs),
    )

    log.info(
        "evals.gate.route_complete",
        extra={
            "funder_name": req.funder_name,
            "passed": result.passed,
            "reason_count": len(result.reasons),
        },
    )
    return result


@router.get("/drift/{tenant_id}")
async def drift(request: Request, tenant_id: str) -> dict[str, object]:
    raise HTTPException(status_code=501, detail="Implement in Phase 5")
