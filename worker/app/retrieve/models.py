"""Pydantic models for the retrieval API.

These are the contract the WCE Writer consumes. Every RetrievedChunk carries
the citation metadata needed to render `[source: doc_id, page, chunk]` in
drafts.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class RetrieveRequest(BaseModel):
    tenant_id: str
    query: str = Field(..., min_length=1)
    funder_id: str | None = None
    k: int = Field(default=5, ge=1, le=50)


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    content: str
    page_start: int
    page_end: int
    section_heading: str | None
    content_type: str
    source: Literal["tenant", "funder"]
    bm25_score: float
    vector_score: float
    rrf_score: float
    rerank_score: float
    citation_id: int


class RetrieveResponse(BaseModel):
    chunks: list[RetrievedChunk]
    duration_ms: int
