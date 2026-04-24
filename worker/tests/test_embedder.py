"""Embedder tests.

All network calls are mocked with respx. No real OpenAI API calls are made.
Verifies batching, 429 retry behavior, and that chunk content never reaches
the log output.
"""

from __future__ import annotations

import logging

import httpx
import pytest
import respx
from openai import AsyncOpenAI

from app.ingest.embedder import EMBED_DIMS, EMBED_MODEL, Embedder


def _build_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key="sk-test-not-real",
        base_url="https://api.openai.com/v1",
    )


def _embed_payload(n: int) -> dict[str, object]:
    # Return deterministic vectors: i-th vector is all 0.01 * i.
    return {
        "object": "list",
        "data": [
            {
                "object": "embedding",
                "embedding": [0.01 * (i + 1)] * 8,
                "index": i,
            }
            for i in range(n)
        ],
        "model": EMBED_MODEL,
        "usage": {"prompt_tokens": n, "total_tokens": n},
    }


@pytest.mark.asyncio
@respx.mock
async def test_single_batch_returns_vectors_in_order() -> None:
    route = respx.post("https://api.openai.com/v1/embeddings").mock(
        return_value=httpx.Response(200, json=_embed_payload(3))
    )
    embedder = Embedder(_build_client())
    result = await embedder.embed(["alpha", "beta", "gamma"])
    assert route.called
    assert result.model == EMBED_MODEL
    assert len(result.vectors) == 3
    # First vector is ~0.01 * 1, second is ~0.01 * 2, etc.
    assert result.vectors[0][0] == pytest.approx(0.01)
    assert result.vectors[2][0] == pytest.approx(0.03)


@pytest.mark.asyncio
@respx.mock
async def test_large_input_is_batched() -> None:
    # 250 inputs with batch_size=100 should hit the API 3 times.
    call_sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read()
        import json

        payload = json.loads(body)
        n = len(payload["input"])
        call_sizes.append(n)
        return httpx.Response(200, json=_embed_payload(n))

    respx.post("https://api.openai.com/v1/embeddings").mock(side_effect=handler)
    embedder = Embedder(_build_client(), batch_size=100)
    texts = [f"doc-{i}" for i in range(250)]
    result = await embedder.embed(texts)
    assert call_sizes == [100, 100, 50]
    assert len(result.vectors) == 250


@pytest.mark.asyncio
@respx.mock
async def test_retries_on_429_then_succeeds() -> None:
    responses = [
        httpx.Response(429, json={"error": {"message": "rate limit"}}),
        httpx.Response(200, json=_embed_payload(2)),
    ]
    respx.post("https://api.openai.com/v1/embeddings").mock(side_effect=responses)
    # Short max_retries to keep the test fast; our exponential backoff is
    # bounded but we still want it to go quickly.
    embedder = Embedder(_build_client(), max_retries=3)
    # Patch asyncio.sleep so the test doesn't actually wait.
    import asyncio
    from unittest.mock import AsyncMock, patch

    with patch.object(asyncio, "sleep", AsyncMock()):
        result = await embedder.embed(["one", "two"])
    assert len(result.vectors) == 2


@pytest.mark.asyncio
@respx.mock
async def test_never_logs_chunk_content(caplog: pytest.LogCaptureFixture) -> None:
    respx.post("https://api.openai.com/v1/embeddings").mock(
        return_value=httpx.Response(200, json=_embed_payload(1))
    )
    embedder = Embedder(_build_client())
    # Sentinel string we look for in captured log records.
    sentinel = "SENSITIVE-CHUNK-CONTENT-NEVER-LOG-ME"
    with caplog.at_level(logging.DEBUG, logger="app.ingest.embedder"):
        await embedder.embed([sentinel])
    # Scrub the caplog records and confirm the sentinel never appears.
    all_records = " ".join(r.getMessage() for r in caplog.records)
    all_records += " " + " ".join(str(r.args) for r in caplog.records if r.args)
    assert sentinel not in all_records


@pytest.mark.asyncio
async def test_empty_input_short_circuits() -> None:
    embedder = Embedder(_build_client())
    result = await embedder.embed([])
    assert result.vectors == []
    assert result.model == EMBED_MODEL


def test_embed_dims_constant_is_3072() -> None:
    # Sanity check: the table column is halfvec(3072) so the model must
    # produce matching dims.
    assert EMBED_DIMS == 3072
