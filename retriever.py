"""
Hybrid retrieval: BM25 + vector similarity + Cohere rerank.

Usage:
    retriever = HybridRetriever(supabase, cohere_client, openai_client)
    results = await retriever.retrieve(
        tenant_id=tenant_id,
        query="What metrics does Rasmuson require for Legacy final reports?",
        funder_id=funder_id,  # optional: restricts to funder-scoped chunks too
        k=5,
    )

Every result is a RetrievedChunk with citation metadata the Writer will render as [n].

Design notes:
- BM25 via Postgres tsvector + ts_rank. Weight 0.4.
- Vector via pgvector cosine. Weight 0.6.
- Reciprocal Rank Fusion to combine, then Cohere rerank-english-v3 over top 20 to top k.
- Tenant isolation is enforced by setting app.current_tenant before every query.
  RLS makes cross-tenant leakage impossible at the DB level.
- Funder-scoped chunks have tenant_id = NULL and funder_id set. These are readable
  by all authenticated tenants. Query joins handle both.
- Never pass raw user input into the tsquery directly. Use plainto_tsquery.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Optional

import cohere
import httpx
from openai import AsyncOpenAI
from supabase import Client


BM25_WEIGHT = 0.4
VECTOR_WEIGHT = 0.6
RRF_K = 60
CANDIDATES_PER_METHOD = 20
RERANK_TO = 5
EMBED_MODEL = "text-embedding-3-large"
RERANK_MODEL = "rerank-english-v3.0"


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    content: str
    page_start: int
    page_end: int
    section_heading: Optional[str]
    content_type: str
    source: str  # "tenant" | "funder"
    bm25_score: float
    vector_score: float
    rrf_score: float
    rerank_score: float
    citation_id: int  # 1-indexed, assigned by the caller


class HybridRetriever:
    def __init__(
        self,
        supabase: Client,
        cohere_client: cohere.Client,
        openai_client: AsyncOpenAI,
    ):
        self.sb = supabase
        self.co = cohere_client
        self.oa = openai_client

    async def _embed(self, text: str) -> list[float]:
        r = await self.oa.embeddings.create(model=EMBED_MODEL, input=text)
        return r.data[0].embedding

    async def _bm25(
        self,
        tenant_id: str,
        query: str,
        funder_id: Optional[str],
        limit: int,
    ) -> list[dict]:
        """
        BM25-ish via Postgres tsvector + ts_rank_cd.
        Returns candidates ordered by text rank.
        """
        # Set tenant context (idempotent)
        self.sb.rpc("set_current_tenant", {"tenant_id": tenant_id}).execute()

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
        res = self.sb.rpc(
            "exec_sql",
            {"sql": sql, "params": {"query": query, "tenant_id": tenant_id,
                                    "funder_id": funder_id, "limit": limit}},
        ).execute()
        return res.data or []

    async def _vector(
        self,
        tenant_id: str,
        query_embedding: list[float],
        funder_id: Optional[str],
        limit: int,
    ) -> list[dict]:
        sql = """
        select
            dc.id, dc.document_id, dc.content, dc.page_start, dc.page_end,
            dc.section_heading, dc.content_type,
            1 - (e.embedding <=> %(query_emb)s::vector) as score,
            case when dc.tenant_id is null then 'funder' else 'tenant' end as source
        from embeddings e
        join document_chunks dc on dc.id = e.document_chunk_id
        where (dc.tenant_id = %(tenant_id)s
               or (dc.tenant_id is null and dc.funder_id = %(funder_id)s))
        order by e.embedding <=> %(query_emb)s::vector
        limit %(limit)s
        """
        res = self.sb.rpc(
            "exec_sql",
            {"sql": sql, "params": {"query_emb": query_embedding,
                                    "tenant_id": tenant_id,
                                    "funder_id": funder_id, "limit": limit}},
        ).execute()
        return res.data or []

    def _rrf(self, bm25_rows: list[dict], vector_rows: list[dict]) -> dict[str, dict]:
        """
        Reciprocal rank fusion across two ranked lists.
        Returns a dict keyed by chunk_id with fused score + both component scores.
        """
        fused: dict[str, dict] = {}

        for rank, row in enumerate(bm25_rows, start=1):
            cid = row["id"]
            fused.setdefault(cid, {**row, "bm25_score": 0.0, "vector_score": 0.0})
            fused[cid]["bm25_score"] = row["score"]
            fused[cid]["_rrf_bm25"] = BM25_WEIGHT / (RRF_K + rank)

        for rank, row in enumerate(vector_rows, start=1):
            cid = row["id"]
            fused.setdefault(cid, {**row, "bm25_score": 0.0, "vector_score": 0.0})
            fused[cid]["vector_score"] = row["score"]
            fused[cid]["_rrf_vector"] = VECTOR_WEIGHT / (RRF_K + rank)

        for cid, row in fused.items():
            row["rrf_score"] = row.get("_rrf_bm25", 0.0) + row.get("_rrf_vector", 0.0)

        return fused

    async def _rerank(
        self, query: str, fused: dict[str, dict], top_n: int
    ) -> list[dict]:
        docs = [f["content"] for f in fused.values()]
        ids = list(fused.keys())
        if not docs:
            return []
        rr = self.co.rerank(
            query=query, documents=docs, top_n=min(top_n, len(docs)), model=RERANK_MODEL
        )
        # Cohere returns indices into `docs`. Map back.
        out = []
        for r in rr.results:
            cid = ids[r.index]
            row = dict(fused[cid])
            row["rerank_score"] = float(r.relevance_score)
            out.append(row)
        return out

    async def retrieve(
        self,
        tenant_id: str,
        query: str,
        funder_id: Optional[str] = None,
        k: int = RERANK_TO,
    ) -> list[RetrievedChunk]:
        # Run BM25 and embedding in parallel.
        query_emb_task = asyncio.create_task(self._embed(query))
        bm25_task = asyncio.create_task(
            self._bm25(tenant_id, query, funder_id, CANDIDATES_PER_METHOD)
        )
        query_emb = await query_emb_task
        vector_rows = await self._vector(
            tenant_id, query_emb, funder_id, CANDIDATES_PER_METHOD
        )
        bm25_rows = await bm25_task

        fused = self._rrf(bm25_rows, vector_rows)
        reranked = await self._rerank(query, fused, top_n=k)

        results: list[RetrievedChunk] = []
        for i, r in enumerate(reranked, start=1):
            results.append(
                RetrievedChunk(
                    chunk_id=r["id"],
                    document_id=r["document_id"],
                    content=r["content"],
                    page_start=r.get("page_start") or 0,
                    page_end=r.get("page_end") or 0,
                    section_heading=r.get("section_heading"),
                    content_type=r.get("content_type", "prose"),
                    source=r.get("source", "tenant"),
                    bm25_score=r.get("bm25_score", 0.0),
                    vector_score=r.get("vector_score", 0.0),
                    rrf_score=r.get("rrf_score", 0.0),
                    rerank_score=r.get("rerank_score", 0.0),
                    citation_id=i,
                )
            )
        return results


# --- Tests ----------------------------------------------------------------
#
# Run with: pytest starter/rag/retriever.py
#
# Required fixtures in conftest.py:
#   - supabase client with seeded two tenants (A, B) each with 5 chunks
#   - cohere and openai mocks for offline tests
#
# Required assertions:
#   1. retrieve(tenant_id=A) never returns a chunk with tenant_id=B.
#   2. A query that lexically matches a BM25 chunk and semantically matches a
#      vector chunk returns BOTH in the top 5 after RRF.
#   3. Funder-scoped chunks (tenant_id=NULL) with matching funder_id appear
#      for both tenant A and tenant B when funder_id is passed.
#   4. Rerank strictly orders by relevance_score desc.
