"""HybridRetriever tests.

Every external client (Supabase, Cohere, OpenAI) is mocked. Verifies:
  - set_current_tenant is called before every SQL call
  - RRF fuses two ranked lists correctly
  - Cohere rerank results are surfaced with their relevance_score
  - Funder-scoped rows vs tenant rows are tagged correctly
  - The halfvec cast appears in the vector SQL (guards against regression)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.retrieve.hybrid import BM25_WEIGHT, RRF_K, VECTOR_WEIGHT, HybridRetriever

# ---------------------------------------------------------------------------
# Mocks
# ---------------------------------------------------------------------------


class _SBResult:
    def __init__(self, data: list[dict[str, Any]] | None = None) -> None:
        self.data = data or []


class _FakeSupabase:
    """Records every RPC call in order so tests can assert call ordering.

    RPCs we handle:
      - set_current_tenant: returns an empty result
      - exec_sql: looks up canned responses by a sequential counter
    """

    def __init__(
        self,
        bm25_rows: list[dict[str, Any]],
        vector_rows: list[dict[str, Any]],
    ) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._responses = iter([bm25_rows, vector_rows])

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        # Record the call.
        self.calls.append((name, args))
        if name == "set_current_tenant":
            return _FakeExec(_SBResult())
        if name == "exec_sql":
            try:
                data = next(self._responses)
            except StopIteration:
                data = []
            return _FakeExec(_SBResult(data))
        return _FakeExec(_SBResult())


class _FakeExec:
    def __init__(self, result: _SBResult) -> None:
        self._result = result

    def execute(self) -> _SBResult:
        return self._result


@dataclass
class _FakeRerankResult:
    index: int
    relevance_score: float


class _FakeRerankResponse:
    def __init__(self, results: list[_FakeRerankResult]) -> None:
        self.results = results


class _FakeCohere:
    def __init__(self, order: list[int], scores: list[float] | None = None) -> None:
        self.order = order
        self.scores = scores or [1.0 - 0.1 * i for i in range(len(order))]
        self.last_kwargs: dict[str, Any] | None = None

    def rerank(self, **kwargs: Any) -> _FakeRerankResponse:
        self.last_kwargs = kwargs
        return _FakeRerankResponse(
            [
                _FakeRerankResult(index=i, relevance_score=s)
                for i, s in zip(self.order, self.scores, strict=True)
            ]
        )


class _FakeOpenAI:
    """Minimal async stub for openai.AsyncOpenAI."""

    def __init__(self) -> None:
        self.embeddings = _FakeEmbeddings()


class _FakeEmbeddings:
    def __init__(self) -> None:
        self.create = AsyncMock()
        self.create.return_value = MagicMock(data=[MagicMock(embedding=[0.1] * 8)])


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sets_tenant_before_every_sql() -> None:
    bm25 = [
        {
            "id": "c1",
            "document_id": "d1",
            "content": "foo bar",
            "page_start": 1,
            "page_end": 1,
            "section_heading": "# Intro",
            "content_type": "prose",
            "source": "tenant",
            "score": 0.9,
        }
    ]
    vector = [
        {
            "id": "c2",
            "document_id": "d2",
            "content": "baz qux",
            "page_start": 2,
            "page_end": 2,
            "section_heading": None,
            "content_type": "prose",
            "source": "tenant",
            "score": 0.8,
        }
    ]
    sb = _FakeSupabase(bm25, vector)
    co = _FakeCohere(order=[0, 1])
    oa = _FakeOpenAI()

    retriever = HybridRetriever(sb, co, oa)
    await retriever.retrieve(tenant_id="t-A", query="what is x", k=2)

    # Strictly alternate: set_current_tenant, exec_sql, set_current_tenant, exec_sql
    # (order of bm25 vs vector depends on asyncio scheduling but each exec_sql
    # must be preceded by a set_current_tenant for the same tenant).
    names = [c[0] for c in sb.calls]
    # Count and ordering: 2 set_current_tenant, 2 exec_sql, interleaved.
    assert names.count("set_current_tenant") == 2
    assert names.count("exec_sql") == 2
    # Every exec_sql is preceded by a set_current_tenant (not necessarily the
    # immediately previous call, because asyncio may interleave, but within
    # the call history a set_current_tenant for the same tenant appears
    # before each exec_sql).
    for i, (name, _args) in enumerate(sb.calls):
        if name == "exec_sql":
            prior = sb.calls[:i]
            assert any(
                n == "set_current_tenant" and a.get("tenant_id") == "t-A" for n, a in prior
            ), "exec_sql must be preceded by set_current_tenant for the same tenant"


@pytest.mark.asyncio
async def test_rrf_fuses_ranks_with_expected_weights() -> None:
    # c1 is rank 1 in bm25 only. c2 is rank 1 in vector only.
    bm25 = [
        {
            "id": "c1",
            "document_id": "d1",
            "content": "lexical match",
            "page_start": 1,
            "page_end": 1,
            "section_heading": None,
            "content_type": "prose",
            "source": "tenant",
            "score": 0.9,
        }
    ]
    vector = [
        {
            "id": "c2",
            "document_id": "d2",
            "content": "semantic match",
            "page_start": 2,
            "page_end": 2,
            "section_heading": None,
            "content_type": "prose",
            "source": "tenant",
            "score": 0.85,
        }
    ]
    sb = _FakeSupabase(bm25, vector)
    co = _FakeCohere(order=[0, 1], scores=[0.99, 0.88])
    oa = _FakeOpenAI()

    retriever = HybridRetriever(sb, co, oa)
    results = await retriever.retrieve(tenant_id="t-A", query="q", k=5)

    # Both chunks should survive through rerank.
    ids = {r.chunk_id for r in results}
    assert {"c1", "c2"}.issubset(ids)

    # c1 rrf_score should equal BM25_WEIGHT / (RRF_K + 1). c2 rrf_score should
    # equal VECTOR_WEIGHT / (RRF_K + 1).
    by_id = {r.chunk_id: r for r in results}
    expected_c1 = BM25_WEIGHT / (RRF_K + 1)
    expected_c2 = VECTOR_WEIGHT / (RRF_K + 1)
    assert by_id["c1"].rrf_score == pytest.approx(expected_c1, rel=1e-6)
    assert by_id["c2"].rrf_score == pytest.approx(expected_c2, rel=1e-6)

    # bm25_score and vector_score come through from the raw rows.
    assert by_id["c1"].bm25_score == pytest.approx(0.9)
    assert by_id["c1"].vector_score == 0.0
    assert by_id["c2"].bm25_score == 0.0
    assert by_id["c2"].vector_score == pytest.approx(0.85)


@pytest.mark.asyncio
async def test_rerank_orders_and_cites_in_rank_order() -> None:
    # Three candidates, rerank returns them in a specific order.
    bm25 = [
        {
            "id": f"c{i}",
            "document_id": f"d{i}",
            "content": f"c{i} text",
            "page_start": i,
            "page_end": i,
            "section_heading": None,
            "content_type": "prose",
            "source": "tenant",
            "score": 0.5 + 0.1 * (3 - i),
        }
        for i in range(3)
    ]
    sb = _FakeSupabase(bm25, [])
    # Cohere returns indices in order [2, 0, 1] with relevance scores that
    # must strictly decrease.
    co = _FakeCohere(order=[2, 0, 1], scores=[0.95, 0.9, 0.1])
    oa = _FakeOpenAI()

    retriever = HybridRetriever(sb, co, oa)
    results = await retriever.retrieve(tenant_id="t-A", query="q", k=3)

    # Citation IDs are 1-indexed in rerank order.
    assert [r.citation_id for r in results] == [1, 2, 3]
    assert [r.chunk_id for r in results] == ["c2", "c0", "c1"]
    # Rerank scores are strictly descending for this fixture.
    assert results[0].rerank_score > results[1].rerank_score > results[2].rerank_score


@pytest.mark.asyncio
async def test_funder_source_is_labeled() -> None:
    bm25 = [
        {
            "id": "c-tenant",
            "document_id": "d-t",
            "content": "tenant text",
            "page_start": 1,
            "page_end": 1,
            "section_heading": None,
            "content_type": "prose",
            "source": "tenant",
            "score": 0.9,
        }
    ]
    vector = [
        {
            "id": "c-funder",
            "document_id": "d-f",
            "content": "funder text",
            "page_start": 2,
            "page_end": 2,
            "section_heading": None,
            "content_type": "prose",
            "source": "funder",
            "score": 0.8,
        }
    ]
    sb = _FakeSupabase(bm25, vector)
    co = _FakeCohere(order=[0, 1])
    oa = _FakeOpenAI()

    retriever = HybridRetriever(sb, co, oa)
    results = await retriever.retrieve(tenant_id="t-A", query="q", funder_id="f-1", k=2)
    by_id = {r.chunk_id: r for r in results}
    assert by_id["c-tenant"].source == "tenant"
    assert by_id["c-funder"].source == "funder"


@pytest.mark.asyncio
async def test_vector_sql_uses_halfvec_cast() -> None:
    """Regression guard: we're on halfvec(3072), not vector(3072). The SQL
    string passed to exec_sql for the vector path must cast with
    `::halfvec(3072)` so pgvector picks the right overload.
    """
    sb = _FakeSupabase([], [])
    co = _FakeCohere(order=[])
    oa = _FakeOpenAI()

    retriever = HybridRetriever(sb, co, oa)
    await retriever.retrieve(tenant_id="t-A", query="q", k=5)

    # Find the vector exec_sql call. BM25 SQL contains "plainto_tsquery",
    # vector SQL contains "embedding <=>".
    vector_call = next(
        (
            args
            for name, args in sb.calls
            if name == "exec_sql" and "embedding <=>" in args.get("sql", "")
        ),
        None,
    )
    assert vector_call is not None, "vector exec_sql call not found"
    assert "::halfvec(3072)" in vector_call["sql"]


@pytest.mark.asyncio
async def test_empty_candidate_set_returns_empty_results() -> None:
    sb = _FakeSupabase([], [])
    co = _FakeCohere(order=[])
    oa = _FakeOpenAI()

    retriever = HybridRetriever(sb, co, oa)
    results = await retriever.retrieve(tenant_id="t-A", query="q", k=5)
    assert results == []


# ---------------------------------------------------------------------------
# Route smoke tests
# ---------------------------------------------------------------------------


def test_retrieve_route_requires_auth() -> None:
    import os

    os.environ.setdefault("WORKER_JWT_SECRET", "ci-test-secret-not-for-production")
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/retrieve",
        json={"tenant_id": "t-A", "query": "x", "k": 5},
    )
    assert resp.status_code == 401


def test_retrieve_route_returns_chunks_from_retriever() -> None:
    import os
    import time

    os.environ.setdefault("WORKER_JWT_SECRET", "ci-test-secret-not-for-production")
    import jwt
    from fastapi.testclient import TestClient

    from app.main import app
    from app.retrieve.models import RetrievedChunk

    # Install a stub retriever on app.state.
    class _StubRetriever:
        async def retrieve(self, **kwargs: Any) -> list[RetrievedChunk]:
            return [
                RetrievedChunk(
                    chunk_id="c1",
                    document_id="d1",
                    content="hello",
                    page_start=1,
                    page_end=1,
                    section_heading="# Intro",
                    content_type="prose",
                    source="tenant",
                    bm25_score=0.9,
                    vector_score=0.8,
                    rrf_score=0.7,
                    rerank_score=0.99,
                    citation_id=1,
                )
            ]

    app.state.retriever = _StubRetriever()
    try:
        secret = os.environ["WORKER_JWT_SECRET"]
        token = jwt.encode(
            {
                "tenant_id": "t-A",
                "user_id": "u-1",
                "role": "editor",
                "iat": int(time.time()),
                "exp": int(time.time()) + 600,
            },
            secret,
            algorithm="HS256",
        )
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(
            "/retrieve",
            headers={"Authorization": f"Bearer {token}"},
            json={"tenant_id": "t-A", "query": "what is x?", "k": 1},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["chunks"]) == 1
        assert body["chunks"][0]["chunk_id"] == "c1"
        assert body["duration_ms"] >= 0
    finally:
        delattr(app.state, "retriever")
