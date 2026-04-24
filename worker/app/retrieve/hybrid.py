"""Hybrid retrieval: BM25 + vector similarity + Cohere rerank.

Production version of `starter/rag/retriever.py`. Same scoring weights, same
RRF, same Cohere rerank step. Refactored to be testable and importable:
  - `HybridRetriever.retrieve` takes a tenant_id and returns
    `list[RetrievedChunk]` (Pydantic model from retrieve.models).
  - Every SQL call is preceded by `set_current_tenant(tenant_id)` RPC. Tests
    assert this via mock call-order.
  - Works with `halfvec(3072)` in the `embeddings` table. The pgvector
    `<=>` operator is overloaded for both `vector` and `halfvec`, so a
    plain float[] on the right side with `::halfvec(3072)` cast works.
    Verified via mocked SQL literal inspection in tests.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import cohere
from openai import AsyncOpenAI
from supabase import Client

from app.retrieve.models import RetrievedChunk

log = logging.getLogger(__name__)

BM25_WEIGHT = 0.4
VECTOR_WEIGHT = 0.6
RRF_K = 60
CANDIDATES_PER_METHOD = 20
RERANK_TO = 5
EMBED_MODEL = "text-embedding-3-large"
RERANK_MODEL = "rerank-english-v3.0"


@dataclass
class _Row:
    """Mutable working row shared across BM25 and vector merges."""

    data: dict[str, Any]


class HybridRetriever:
    def __init__(
        self,
        supabase: Client,
        cohere_client: cohere.Client,
        openai_client: AsyncOpenAI,
    ) -> None:
        self.sb = supabase
        self.co = cohere_client
        self.oa = openai_client

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        *,
        tenant_id: str,
        query: str,
        funder_id: str | None = None,
        k: int = RERANK_TO,
    ) -> list[RetrievedChunk]:
        # Run BM25 and query-embedding in parallel.
        query_emb_task = asyncio.create_task(self._embed(query))
        bm25_task = asyncio.create_task(
            self._bm25(tenant_id, query, funder_id, CANDIDATES_PER_METHOD)
        )

        query_emb = await query_emb_task
        vector_rows = await self._vector(tenant_id, query_emb, funder_id, CANDIDATES_PER_METHOD)
        bm25_rows = await bm25_task

        fused = self._rrf(bm25_rows, vector_rows)
        reranked = await self._rerank(query, fused, top_n=k)

        return [
            RetrievedChunk(
                chunk_id=str(r["id"]),
                document_id=str(r["document_id"]),
                content=str(r.get("content") or ""),
                page_start=int(r.get("page_start") or 0),
                page_end=int(r.get("page_end") or 0),
                section_heading=(str(r["section_heading"]) if r.get("section_heading") else None),
                content_type=str(r.get("content_type") or "prose"),
                source=("funder" if r.get("source") == "funder" else "tenant"),
                bm25_score=float(r.get("bm25_score") or 0.0),
                vector_score=float(r.get("vector_score") or 0.0),
                rrf_score=float(r.get("rrf_score") or 0.0),
                rerank_score=float(r.get("rerank_score") or 0.0),
                citation_id=i,
            )
            for i, r in enumerate(reranked, start=1)
        ]

    # ------------------------------------------------------------------
    # Sub-steps
    # ------------------------------------------------------------------

    async def _embed(self, text: str) -> list[float]:
        r = await self.oa.embeddings.create(model=EMBED_MODEL, input=text)
        return list(r.data[0].embedding)

    def _set_tenant(self, tenant_id: str) -> None:
        """Set `app.current_tenant`. Tests assert this is called before each
        SQL path.
        """
        self.sb.rpc("set_current_tenant", {"tenant_id": tenant_id}).execute()

    async def _bm25(
        self,
        tenant_id: str,
        query: str,
        funder_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """BM25-ish via Postgres tsvector + ts_rank_cd."""
        self._set_tenant(tenant_id)
        sql = """
        with q as (select plainto_tsquery('english', %(query)s) as q)
        select
            dc.id, dc.document_id, dc.content, dc.page_start, dc.page_end,
            dc.section_heading, dc.content_type,
            ts_rank_cd(to_tsvector('english', dc.content), q.q) as score,
            case when dc.tenant_id is null then 'funder' else 'tenant' end as source
        from document_chunks dc, q
        where to_tsvector('english', dc.content) @@ q.q
          and (dc.tenant_id = %(tenant_id)s
               or (dc.tenant_id is null and dc.funder_id = %(funder_id)s))
        order by score desc
        limit %(limit)s
        """
        params = {
            "query": query,
            "tenant_id": tenant_id,
            "funder_id": funder_id,
            "limit": limit,
        }
        res = self.sb.rpc("exec_sql", {"sql": sql, "params": params}).execute()
        return list(res.data or [])

    async def _vector(
        self,
        tenant_id: str,
        query_embedding: list[float],
        funder_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """pgvector cosine on the `halfvec(3072)` embedding column.

        The `<=>` operator is overloaded for both `vector` and `halfvec`, so
        casting the bound parameter with `::halfvec(3072)` works even though
        the table uses halfvec. A 1 - distance gives a similarity score in
        [0, 1] (higher is better).
        """
        self._set_tenant(tenant_id)
        sql = """
        select
            dc.id, dc.document_id, dc.content, dc.page_start, dc.page_end,
            dc.section_heading, dc.content_type,
            1 - (e.embedding <=> %(query_emb)s::halfvec(3072)) as score,
            case when dc.tenant_id is null then 'funder' else 'tenant' end as source
        from embeddings e
        join document_chunks dc on dc.id = e.document_chunk_id
        where (dc.tenant_id = %(tenant_id)s
               or (dc.tenant_id is null and dc.funder_id = %(funder_id)s))
        order by e.embedding <=> %(query_emb)s::halfvec(3072)
        limit %(limit)s
        """
        params = {
            "query_emb": query_embedding,
            "tenant_id": tenant_id,
            "funder_id": funder_id,
            "limit": limit,
        }
        res = self.sb.rpc("exec_sql", {"sql": sql, "params": params}).execute()
        return list(res.data or [])

    # ------------------------------------------------------------------
    # Fusion + rerank
    # ------------------------------------------------------------------

    @staticmethod
    def _rrf(
        bm25_rows: list[dict[str, Any]], vector_rows: list[dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """Reciprocal rank fusion across two ranked lists.

        Keys are chunk ids. Each value dict carries:
          - the original row fields (content, page_start, etc.)
          - bm25_score, vector_score (raw scores from each path)
          - rrf_score (fused, weighted)
        """
        fused: dict[str, dict[str, Any]] = {}

        for rank, row in enumerate(bm25_rows, start=1):
            cid = str(row["id"])
            fused.setdefault(cid, {**row, "bm25_score": 0.0, "vector_score": 0.0})
            fused[cid]["bm25_score"] = float(row.get("score") or 0.0)
            fused[cid]["_rrf_bm25"] = BM25_WEIGHT / (RRF_K + rank)

        for rank, row in enumerate(vector_rows, start=1):
            cid = str(row["id"])
            fused.setdefault(cid, {**row, "bm25_score": 0.0, "vector_score": 0.0})
            fused[cid]["vector_score"] = float(row.get("score") or 0.0)
            fused[cid]["_rrf_vector"] = VECTOR_WEIGHT / (RRF_K + rank)

        for row in fused.values():
            bm25_c = float(row.get("_rrf_bm25") or 0.0)
            vec_c = float(row.get("_rrf_vector") or 0.0)
            row["rrf_score"] = bm25_c + vec_c

        return fused

    async def _rerank(
        self,
        query: str,
        fused: dict[str, dict[str, Any]],
        top_n: int,
    ) -> list[dict[str, Any]]:
        if not fused:
            return []

        ids = list(fused.keys())
        docs = [str(fused[cid].get("content") or "") for cid in ids]

        rr = self.co.rerank(
            query=query,
            documents=docs,
            top_n=min(top_n, len(docs)),
            model=RERANK_MODEL,
        )

        out: list[dict[str, Any]] = []
        for r in rr.results:
            cid = ids[r.index]
            row = dict(fused[cid])
            row["rerank_score"] = float(r.relevance_score)
            out.append(row)
        return out
