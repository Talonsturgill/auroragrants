"""Extract route.

POST /extract/requirements — run the Phase 3 Extractor against a parsed
document's chunk set and return the structured ReportingRequirements JSON.

Flow:
  1. Look up the document. 404 if missing.
  2. Check `documents.tenant_id == request.state.tenant_id`. 403 otherwise.
  3. Load chunks via `document_chunks`, concatenate `content` in
     `chunk_index` order. 409 if zero chunks.
  4. Call the Extractor.
  5. Return the extractor envelope with status 200, even when
     `schema_valid=False`. The caller decides policy.
"""

from __future__ import annotations

import logging
from typing import Any

from anthropic import AsyncAnthropic
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.extract import extract_reporting_requirements

log = logging.getLogger(__name__)
router = APIRouter()


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)


class ExtractResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirements: dict[str, Any]
    attempts: int
    schema_valid: bool
    schema_errors: list[str] | None = None
    tokens_in: int
    tokens_out: int


def _anthropic_client(request: Request) -> AsyncAnthropic:
    """Return the shared AsyncAnthropic client, or construct one on demand.

    Tests monkey-patch `request.app.state.anthropic` to inject a fake
    client. Production wiring happens on startup.
    """
    client = getattr(request.app.state, "anthropic", None)
    if client is None:
        raise HTTPException(status_code=503, detail="extractor_not_configured")
    return client  # type: ignore[no-any-return]


def _supabase(request: Request) -> Any:
    """Return the shared Supabase client.

    Tests monkey-patch `request.app.state.supabase`. Production wiring
    happens on startup.
    """
    sb = getattr(request.app.state, "supabase", None)
    if sb is None:
        raise HTTPException(status_code=503, detail="supabase_not_configured")
    return sb


def _fetch_document(sb: Any, document_id: str) -> dict[str, Any] | None:
    """Fetch a single document row. Returns None if not found."""
    res = sb.table("documents").select("id, tenant_id").eq("id", document_id).execute()
    rows: list[dict[str, Any]] = list(res.data or [])
    if not rows:
        return None
    return rows[0]


def _fetch_chunks_text(sb: Any, document_id: str) -> str:
    """Fetch and concatenate `content` across chunks in `chunk_index` order."""
    res = (
        sb.table("document_chunks")
        .select("chunk_index, content")
        .eq("document_id", document_id)
        .order("chunk_index")
        .execute()
    )
    rows: list[dict[str, Any]] = list(res.data or [])
    parts = [str(r.get("content", "")) for r in rows]
    # Double newline keeps section boundaries readable for the LLM.
    return "\n\n".join(p for p in parts if p)


@router.post("/requirements", response_model=ExtractResponse)
async def extract_requirements(
    req: ExtractRequest,
    request: Request,
) -> ExtractResponse:
    mw_tenant_id: str | None = getattr(request.state, "tenant_id", None)
    if not mw_tenant_id:
        # Defensive: middleware would normally reject earlier. Surface 401
        # rather than leak which documents exist.
        raise HTTPException(status_code=401, detail="missing_tenant")

    sb = _supabase(request)

    document = _fetch_document(sb, req.document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document_not_found")

    doc_tenant = document.get("tenant_id")
    if doc_tenant != mw_tenant_id:
        # Surface 403 regardless of whether the document has a NULL tenant
        # (funder-scoped) — the extractor is tenant-scoped only in v1.
        raise HTTPException(status_code=403, detail="tenant_mismatch")

    parsed_text = _fetch_chunks_text(sb, req.document_id)
    if not parsed_text:
        raise HTTPException(status_code=409, detail="document_not_parsed")

    client = _anthropic_client(request)
    result = await extract_reporting_requirements(parsed_text, client)

    log.info(
        "extract.requirements.complete",
        extra={
            "document_id": req.document_id,
            "attempts": result.attempts,
            "schema_valid": result.schema_valid,
            "tokens_in": result.tokens_in,
            "tokens_out": result.tokens_out,
        },
    )

    return ExtractResponse(
        requirements=result.requirements,
        attempts=result.attempts,
        schema_valid=result.schema_valid,
        schema_errors=result.schema_errors,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )
