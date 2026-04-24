"""Ingest routes.

POST /ingest/document — chunk an already-parsed document, embed each chunk,
insert into `document_chunks` and `embeddings`, and mark the parent document
as indexed. See /docs/05-build-plan.md Phase 2 for the spec.

The request flow is fail-closed:
  1. Set tenant context.
  2. Chunk markdown.
  3. Insert chunks.
  4. Embed chunks. On failure, compensating-delete the chunks we inserted.
  5. Insert embeddings. On failure, compensating-delete the chunks.
  6. Mark the document indexed.
  7. In finally, clear tenant context.

Auth: the TenantContextMiddleware has already validated the JWT and set
`request.state.tenant_id`. This route additionally accepts an explicit
`tenant_id` in the body for worker-to-worker ingestion jobs (the parser
worker calls us after parsing a funder document and pins tenant_id=None with
a funder_id). The body tenant_id must match `request.state.tenant_id` when
the latter is present, otherwise we 403.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from app.ingest import Chunker, Embedder, IngestStorage

log = logging.getLogger(__name__)
router = APIRouter()


class ParsedPage(BaseModel):
    page_number: int
    text_start_offset: int | None = None
    text_end_offset: int | None = None


class ParsedDocument(BaseModel):
    """Minimal subset of the ParserResult shape the chunker needs."""

    markdown: str
    pages: list[ParsedPage] = Field(default_factory=list)
    # headings, tables, page_count are tolerated but unused for chunking.
    headings: list[dict[str, Any]] = Field(default_factory=list)
    tables: list[dict[str, Any]] = Field(default_factory=list)
    page_count: int | None = None


class IngestRequest(BaseModel):
    document_id: str
    tenant_id: str | None = None
    funder_id: str | None = None
    parsed: ParsedDocument

    @model_validator(mode="after")
    def _one_owner(self) -> IngestRequest:
        if not self.tenant_id and not self.funder_id:
            raise ValueError("either tenant_id or funder_id is required")
        return self


class IngestResponse(BaseModel):
    document_id: str
    chunks_inserted: int
    embeddings_inserted: int
    duration_ms: int


def _dependencies(request: Request) -> tuple[Chunker, Embedder, IngestStorage]:
    """Pull the shared dependencies off app state, or construct fresh ones.

    Tests monkey-patch `request.app.state.chunker / embedder / storage` to
    inject mocks. Production wiring happens on app startup; if a dependency
    is missing, the route raises 503 rather than half-working.
    """
    state = request.app.state
    try:
        return state.chunker, state.embedder, state.storage
    except AttributeError as exc:  # pragma: no cover — prod wiring missing
        raise HTTPException(status_code=503, detail="ingest_dependencies_not_configured") from exc


@router.post("/document", response_model=IngestResponse)
async def ingest_document(req: IngestRequest, request: Request) -> IngestResponse:
    # Enforce that the request tenant matches the middleware-set tenant when
    # both are present. Funder-scoped ingests (tenant_id=None + funder_id set)
    # are worker-to-worker and trust the middleware tenant as the caller.
    mw_tenant_id: str | None = getattr(request.state, "tenant_id", None)
    if req.tenant_id and mw_tenant_id and req.tenant_id != mw_tenant_id:
        raise HTTPException(status_code=403, detail="tenant_mismatch")

    chunker, embedder, storage = _dependencies(request)

    # Tenant context is per-request. Always wrap in try/finally so we clear
    # it even if chunking or embedding raises.
    storage.set_tenant(req.tenant_id)
    started = time.perf_counter()
    inserted_chunk_ids: list[str] = []
    try:
        pages_dict = [p.model_dump() for p in req.parsed.pages]
        chunks = chunker.chunk(req.parsed.markdown, pages=pages_dict)
        if not chunks:
            log.info(
                "ingest.document.empty",
                extra={"document_id": req.document_id},
            )
            return IngestResponse(
                document_id=req.document_id,
                chunks_inserted=0,
                embeddings_inserted=0,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

        inserted_chunk_ids = storage.insert_chunks(
            tenant_id=req.tenant_id,
            funder_id=req.funder_id,
            document_id=req.document_id,
            chunks=chunks,
        )

        texts = [c.content for c in chunks]
        try:
            emb = await embedder.embed(texts)
        except Exception:
            # Compensating delete on embed failure.
            storage.delete_chunks(inserted_chunk_ids)
            raise

        try:
            embeddings_inserted = storage.insert_embeddings(
                tenant_id=req.tenant_id,
                funder_id=req.funder_id,
                chunk_ids=inserted_chunk_ids,
                vectors=emb.vectors,
                model=emb.model,
            )
        except Exception:
            storage.delete_chunks(inserted_chunk_ids)
            raise

        storage.mark_document_indexed(req.document_id)

        return IngestResponse(
            document_id=req.document_id,
            chunks_inserted=len(inserted_chunk_ids),
            embeddings_inserted=embeddings_inserted,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
    finally:
        storage.clear_tenant()
