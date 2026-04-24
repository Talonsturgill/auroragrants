"""Parse routes.

Three parser endpoints wired to the wrappers in `app/parsers/`:
  - POST /parse/marker       — Marker (primary, model-heavy)
  - POST /parse/pdfplumber   — pdfplumber (text + tables, CPU-only)
  - POST /parse/unstructured — Unstructured (element typing, OCR-capable)

Contract (see `/docs/05-build-plan.md` Phase 2):
  Request body:
    {
      "pdf_url":     "https://supabase-signed-url",
      "document_id": "<uuid>",
      "tenant_id":   "<uuid>"
    }
  Response body: `ParserResult` (see `app/parsers/base.py`).

Downloads are capped at 100 MB. The tenant_id in the JWT (attached to
`request.state.tenant_id` by `TenantContextMiddleware`) MUST match
`tenant_id` in the body. This is redundant with RLS but defends against
a stolen signed URL being replayed against the wrong tenant.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.parsers import ParserResult
from app.parsers.base import ParsedDocument
from app.parsers.markdown import document_to_markdown

router = APIRouter()

# 100 MB cap on downloaded PDFs.
MAX_PDF_BYTES = 100 * 1024 * 1024
# Fetch timeout. NOFOs can be large; a generous timeout avoids false failures.
FETCH_TIMEOUT_SECONDS = 60.0


class ParseRequest(BaseModel):
    """Shared request body for all three parser endpoints."""

    model_config = ConfigDict(extra="forbid")

    pdf_url: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)


@router.post("/marker")
async def parse_marker(request: Request, body: ParseRequest) -> ParserResult:
    """Parse with Marker. Heavy ML models load on first call per process."""
    _assert_tenant_match(request, body)
    pdf_bytes = await _fetch_pdf(body.pdf_url)
    started = time.monotonic()
    # Import here to keep module import cheap and testable.
    from app.parsers import marker as marker_parser

    doc = marker_parser.parse(pdf_bytes)
    return _to_result(body.document_id, "marker", started, doc)


@router.post("/pdfplumber")
async def parse_pdfplumber(request: Request, body: ParseRequest) -> ParserResult:
    """Parse with pdfplumber. CPU-only, safe for CI and always-available."""
    _assert_tenant_match(request, body)
    pdf_bytes = await _fetch_pdf(body.pdf_url)
    started = time.monotonic()
    from app.parsers import pdfplumber as pdfplumber_parser

    doc = pdfplumber_parser.parse(pdf_bytes)
    return _to_result(body.document_id, "pdfplumber", started, doc)


@router.post("/unstructured")
async def parse_unstructured(request: Request, body: ParseRequest) -> ParserResult:
    """Parse with Unstructured. Good fallback for scanned NOFOs."""
    _assert_tenant_match(request, body)
    pdf_bytes = await _fetch_pdf(body.pdf_url)
    started = time.monotonic()
    from app.parsers import unstructured as unstructured_parser

    doc = unstructured_parser.parse(pdf_bytes)
    return _to_result(body.document_id, "unstructured", started, doc)


def _assert_tenant_match(request: Request, body: ParseRequest) -> None:
    """Reject if the JWT tenant does not match the body tenant."""
    jwt_tenant = getattr(request.state, "tenant_id", None)
    if jwt_tenant and jwt_tenant != body.tenant_id:
        raise HTTPException(status_code=403, detail="tenant_mismatch")


async def _fetch_pdf(url: str) -> bytes:
    """Fetch the PDF from a signed URL with a 100 MB cap.

    Returns the raw bytes. Raises 413 if too large, 400 if not a PDF, 502
    if the remote fetch fails for any network reason.
    """
    try:
        async with (
            httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS) as client,
            client.stream("GET", url) as response,
        ):
            if response.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"pdf_fetch_failed: upstream {response.status_code}",
                )
            content_length = response.headers.get("content-length")
            if content_length is not None:
                try:
                    if int(content_length) > MAX_PDF_BYTES:
                        raise HTTPException(status_code=413, detail="pdf_too_large")
                except ValueError:
                    pass
            buffer = bytearray()
            async for chunk in response.aiter_bytes():
                buffer.extend(chunk)
                if len(buffer) > MAX_PDF_BYTES:
                    raise HTTPException(status_code=413, detail="pdf_too_large")
            data = bytes(buffer)
    except HTTPException:
        raise
    except (httpx.HTTPError, httpx.StreamError) as exc:
        raise HTTPException(
            status_code=502, detail=f"pdf_fetch_failed: {type(exc).__name__}"
        ) from exc

    if not _looks_like_pdf(data):
        raise HTTPException(status_code=400, detail="not_a_pdf")
    return data


def _looks_like_pdf(data: bytes) -> bool:
    """Cheap magic-number check: PDF files start with `%PDF-`."""
    return data[:5] == b"%PDF-"


def _to_result(
    document_id: str,
    engine: str,
    started_at: float,
    doc: ParsedDocument,
) -> ParserResult:
    """Wrap a ParsedDocument in a ParserResult with timing info."""
    duration_ms = max(0, int((time.monotonic() - started_at) * 1000))
    markdown = doc.markdown or document_to_markdown(doc)
    return ParserResult(
        document_id=document_id,
        engine=engine,
        duration_ms=duration_ms,
        page_count=doc.page_count,
        markdown=markdown,
        pages=doc.pages,
        tables=doc.tables,
        headings=doc.headings,
    )


def _payload_dump(result: ParserResult) -> dict[str, Any]:
    """Helper kept for future ingestion hand-off (chunker, embedder)."""
    return result.model_dump(mode="json")
