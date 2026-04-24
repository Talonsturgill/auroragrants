"""Retrieve route.

POST /retrieve — hybrid BM25 + vector + Cohere rerank. Returns
RetrievedChunk[] with citation metadata ready for the WCE Writer.

See `/starter/rag/retriever.py` for the reference implementation and
`/worker/app/retrieve/hybrid.py` for the production version.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request

from app.retrieve.models import RetrieveRequest, RetrieveResponse

log = logging.getLogger(__name__)
router = APIRouter()


@router.post("", response_model=RetrieveResponse)
async def retrieve(req: RetrieveRequest, request: Request) -> RetrieveResponse:
    mw_tenant_id: str | None = getattr(request.state, "tenant_id", None)
    if mw_tenant_id and req.tenant_id != mw_tenant_id:
        raise HTTPException(status_code=403, detail="tenant_mismatch")

    retriever = getattr(request.app.state, "retriever", None)
    if retriever is None:
        raise HTTPException(status_code=503, detail="retriever_not_configured")

    started = time.perf_counter()
    chunks = await retriever.retrieve(
        tenant_id=req.tenant_id,
        query=req.query,
        funder_id=req.funder_id,
        k=req.k,
    )
    return RetrieveResponse(
        chunks=chunks,
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
