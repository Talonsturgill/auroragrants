"""Ingest route tests.

Exercises POST /ingest/document with mocked chunker, embedder, and storage
injected through app.state. Verifies:
  - happy path inserts N chunks + N embeddings
  - empty markdown returns (0, 0) without touching storage
  - embedder failure triggers compensating delete
  - missing Authorization header returns 401
  - tenant mismatch between JWT and body returns 403
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("WORKER_JWT_SECRET", "ci-test-secret-not-for-production")

import jwt
import pytest
from fastapi.testclient import TestClient

from app.ingest.chunker import Chunk
from app.ingest.embedder import EmbeddingResult
from app.main import app


def _issue_jwt(tenant_id: str = "t-A") -> str:
    secret = os.environ["WORKER_JWT_SECRET"]
    payload = {
        "tenant_id": tenant_id,
        "user_id": "u-1",
        "role": "editor",
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@dataclass
class _FakeStorage:
    set_calls: list[str | None]
    cleared: bool
    inserted_ids: list[str]
    deleted_ids: list[str]
    marked_indexed: str | None
    insert_embeddings_count: int

    def __init__(self) -> None:
        self.set_calls = []
        self.cleared = False
        self.inserted_ids = []
        self.deleted_ids = []
        self.marked_indexed = None
        self.insert_embeddings_count = 0
        self.fail_insert_embeddings = False

    def set_tenant(self, tenant_id: str | None) -> None:
        self.set_calls.append(tenant_id)

    def clear_tenant(self) -> None:
        self.cleared = True

    def insert_chunks(
        self,
        *,
        tenant_id: str | None,
        funder_id: str | None,
        document_id: str,
        chunks: list[Chunk],
    ) -> list[str]:
        ids = [f"chunk-{i}" for i in range(len(chunks))]
        self.inserted_ids = ids
        return ids

    def insert_embeddings(
        self,
        *,
        tenant_id: str | None,
        funder_id: str | None,
        chunk_ids: list[str],
        vectors: list[list[float]],
        model: str,
    ) -> int:
        if self.fail_insert_embeddings:
            raise RuntimeError("simulated embeddings insert failure")
        self.insert_embeddings_count = len(chunk_ids)
        return len(chunk_ids)

    def delete_chunks(self, chunk_ids: list[str]) -> None:
        self.deleted_ids = list(chunk_ids)

    def mark_document_indexed(self, document_id: str) -> None:
        self.marked_indexed = document_id


class _FakeChunker:
    def __init__(self, chunks: list[Chunk]) -> None:
        self._chunks = chunks

    def chunk(self, markdown: str, pages: list[dict[str, Any]] | None = None) -> list[Chunk]:
        if not markdown.strip():
            return []
        return list(self._chunks)


def _mk_chunks(n: int) -> list[Chunk]:
    return [
        Chunk(
            chunk_index=i,
            content=f"chunk {i} content",
            section_heading="# Section",
            page_start=1,
            page_end=1,
            token_count=50,
        )
        for i in range(n)
    ]


def _mk_embedder(n: int, *, fail: bool = False) -> Any:
    embedder = MagicMock()
    if fail:
        embedder.embed = AsyncMock(side_effect=RuntimeError("openai down"))
    else:
        embedder.embed = AsyncMock(
            return_value=EmbeddingResult(
                model="text-embedding-3-large",
                vectors=[[0.1] * 8 for _ in range(n)],
            )
        )
    return embedder


def _install_deps(
    chunks: list[Chunk], *, fail_embed: bool = False, fail_insert: bool = False
) -> _FakeStorage:
    storage = _FakeStorage()
    storage.fail_insert_embeddings = fail_insert
    app.state.chunker = _FakeChunker(chunks)
    app.state.embedder = _mk_embedder(len(chunks), fail=fail_embed)
    app.state.storage = storage
    return storage


@pytest.fixture(autouse=True)
def _reset_app_state() -> Any:
    # Ensure each test starts with a clean state.
    for attr in ("chunker", "embedder", "storage"):
        if hasattr(app.state, attr):
            delattr(app.state, attr)
    yield
    for attr in ("chunker", "embedder", "storage"):
        if hasattr(app.state, attr):
            delattr(app.state, attr)


def test_happy_path_inserts_chunks_and_embeddings() -> None:
    storage = _install_deps(_mk_chunks(3))
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")

    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-1",
            "tenant_id": "t-A",
            "funder_id": None,
            "parsed": {
                "markdown": "# Heading\n\nSome content.",
                "pages": [
                    {
                        "page_number": 1,
                        "text_start_offset": 0,
                        "text_end_offset": 10,
                    }
                ],
            },
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["document_id"] == "doc-1"
    assert body["chunks_inserted"] == 3
    assert body["embeddings_inserted"] == 3
    assert body["duration_ms"] >= 0

    # Tenant lifecycle: set once, cleared once.
    assert storage.set_calls == ["t-A"]
    assert storage.cleared is True
    assert storage.marked_indexed == "doc-1"
    assert storage.deleted_ids == []


def test_missing_auth_header_returns_401() -> None:
    _install_deps(_mk_chunks(1))
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/ingest/document",
        json={
            "document_id": "doc-1",
            "tenant_id": "t-A",
            "parsed": {"markdown": "x", "pages": []},
        },
    )
    assert resp.status_code == 401


def test_tenant_mismatch_returns_403() -> None:
    _install_deps(_mk_chunks(1))
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-1",
            "tenant_id": "t-B",  # mismatch with the JWT tenant
            "parsed": {"markdown": "x", "pages": []},
        },
    )
    assert resp.status_code == 403


def test_empty_markdown_returns_zero_without_touching_storage() -> None:
    storage = _install_deps(_mk_chunks(0))  # chunker returns [] for empty
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-1",
            "tenant_id": "t-A",
            "parsed": {"markdown": "   \n  ", "pages": []},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["chunks_inserted"] == 0
    assert body["embeddings_inserted"] == 0
    # We did set + clear context, but never inserted or marked.
    assert storage.inserted_ids == []
    assert storage.marked_indexed is None
    assert storage.cleared is True


def test_embed_failure_rolls_back_chunks() -> None:
    storage = _install_deps(_mk_chunks(3), fail_embed=True)
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-1",
            "tenant_id": "t-A",
            "parsed": {"markdown": "# heading", "pages": []},
        },
    )
    assert resp.status_code == 500
    # Chunks were inserted, then rolled back.
    assert storage.inserted_ids == ["chunk-0", "chunk-1", "chunk-2"]
    assert storage.deleted_ids == ["chunk-0", "chunk-1", "chunk-2"]
    assert storage.marked_indexed is None
    # Tenant context cleared even on failure.
    assert storage.cleared is True


def test_insert_embeddings_failure_rolls_back_chunks() -> None:
    storage = _install_deps(_mk_chunks(2), fail_insert=True)
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-1",
            "tenant_id": "t-A",
            "parsed": {"markdown": "# heading", "pages": []},
        },
    )
    assert resp.status_code == 500
    assert storage.deleted_ids == ["chunk-0", "chunk-1"]
    assert storage.marked_indexed is None
    assert storage.cleared is True


def test_funder_scoped_ingest_with_null_tenant() -> None:
    storage = _install_deps(_mk_chunks(1))
    client = TestClient(app, raise_server_exceptions=False)
    # Middleware still requires a JWT; the request body sets tenant_id=None
    # because the chunks are funder-scoped. The route only enforces tenant
    # match when BOTH JWT and body tenant_id are present.
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-f",
            "tenant_id": None,
            "funder_id": "f-1",
            "parsed": {"markdown": "# funder guideline", "pages": []},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["chunks_inserted"] == 1
    # Tenant context was set to None (funder-scope).
    assert storage.set_calls == [None]
    assert storage.cleared is True


def test_rejects_body_without_owner() -> None:
    _install_deps(_mk_chunks(1))
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    # Neither tenant_id nor funder_id set — validation error.
    resp = client.post(
        "/ingest/document",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "document_id": "doc-1",
            "parsed": {"markdown": "x", "pages": []},
        },
    )
    assert resp.status_code == 422
