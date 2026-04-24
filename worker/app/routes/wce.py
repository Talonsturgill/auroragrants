"""Writer-Critic-Editor routes.

POST /wce/draft-field — run the WCE loop on a single report field.

The route is tenant-scoped. Middleware extracts the tenant_id from the
signed JWT and stashes it on `request.state`. The handler retrieves the
top-5 chunks via the HybridRetriever configured on
`request.app.state.retriever`, then runs the WCE loop against the
AsyncAnthropic client on `request.app.state.anthropic`. Both attachments
are injected at startup in production and monkey-patched in tests.

Agent B adds the eval-harness gate after the loop returns. Until then the
response surfaces the loop's own `surface_decision`.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from anthropic import AsyncAnthropic
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.retrieve.models import RetrievedChunk
from app.wce import run_wce_loop
from app.wce.loop import trace_dict

log = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request + response schemas
# ---------------------------------------------------------------------------


class _FieldMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    field_type: str
    word_count_max: int | None = None
    word_count_min: int | None = None
    description: str | None = None


class _FunderMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str


class _RubricItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    weight: float
    description: str | None = None


class _OrgContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    ein: str | None = None
    programs: list[dict[str, Any]] = Field(default_factory=list)
    prior_outcomes: list[dict[str, Any]] = Field(default_factory=list)


class DraftFieldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_field_id: str = Field(min_length=1)
    field: _FieldMeta
    funder: _FunderMeta
    rubric: list[_RubricItem]
    org_context: _OrgContext
    retrieval_query: str = Field(min_length=1)
    high_stakes: bool = False


class _CitationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    document_id: str
    chunk_id: str
    page_start: int
    page_end: int
    excerpt: str
    section_heading: str | None = None


class _DraftOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str
    citations: list[_CitationOut]
    word_count: int
    uncovered_claims: list[str]


class _CritiqueOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rubric_scores: dict[str, Any]
    overall_score: float
    fixes: list[dict[str, Any]]
    ready_to_surface: bool


class DraftFieldResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft: _DraftOut
    critique: _CritiqueOut
    iterations: int
    tokens_in: int
    tokens_out: int
    cost_cents: int
    surface_decision: str
    model_writer: str
    model_critic: str
    model_editor: str
    wce_trace: dict[str, Any]


# ---------------------------------------------------------------------------
# Dependency lookups
# ---------------------------------------------------------------------------


def _anthropic_client(request: Request) -> AsyncAnthropic:
    """Return the shared AsyncAnthropic client from app state."""
    client = getattr(request.app.state, "anthropic", None)
    if client is None:
        raise HTTPException(status_code=503, detail="anthropic_not_configured")
    return client  # type: ignore[no-any-return]


def _retriever(request: Request) -> Any:
    """Return the shared HybridRetriever from app state."""
    retriever = getattr(request.app.state, "retriever", None)
    if retriever is None:
        raise HTTPException(status_code=503, detail="retriever_not_configured")
    return retriever


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/draft-field", response_model=DraftFieldResponse)
async def draft_field(req: DraftFieldRequest, request: Request) -> DraftFieldResponse:
    mw_tenant_id: str | None = getattr(request.state, "tenant_id", None)
    if not mw_tenant_id:
        raise HTTPException(status_code=401, detail="missing_tenant")

    retriever = _retriever(request)
    client = _anthropic_client(request)

    chunks: list[RetrievedChunk] = await retriever.retrieve(
        tenant_id=mw_tenant_id,
        query=req.retrieval_query,
        funder_id=req.funder.id,
        k=5,
    )

    result = await run_wce_loop(
        client=client,
        chunks=chunks,
        funder=req.funder.model_dump(),
        rubric=[item.model_dump() for item in req.rubric],
        field_meta=req.field.model_dump(),
        org_context=req.org_context.model_dump(),
        high_stakes=req.high_stakes,
    )

    # Hook for Agent B: run the eval harness here against the surfaced
    # draft and merge `eval_scores` into the response. Until then the
    # loop's own Critic decision drives `surface_decision`.
    # eval_scores = await run_eval_harness(result.draft, req.rubric, chunks)

    log.info(
        "wce.draft_field.complete",
        extra={
            "report_field_id": req.report_field_id,
            "funder_id": req.funder.id,
            "iterations": result.final_iteration,
            "overall_score": result.critique.overall_score,
            "surface_decision": result.surface_decision,
            "tokens_in": result.total_tokens_in,
            "tokens_out": result.total_tokens_out,
            "cost_cents": result.total_cost_cents,
            "high_stakes": req.high_stakes,
        },
    )

    return DraftFieldResponse(
        draft=_DraftOut(
            content=result.draft.content,
            citations=[_CitationOut(**c) for c in result.draft.citations],
            word_count=result.draft.word_count,
            uncovered_claims=result.draft.uncovered_claims,
        ),
        critique=_CritiqueOut(**asdict(result.critique)),
        iterations=result.final_iteration,
        tokens_in=result.total_tokens_in,
        tokens_out=result.total_tokens_out,
        cost_cents=result.total_cost_cents,
        surface_decision=result.surface_decision,
        model_writer=result.model_writer,
        model_critic=result.model_critic,
        model_editor=result.model_editor,
        wce_trace=trace_dict(result),
    )
