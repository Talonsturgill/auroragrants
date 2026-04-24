"""Tests for the Phase 3 Extractor module and /extract/requirements route.

We mock the Anthropic client with a fake AsyncAnthropic-shaped class so
no real network calls happen. Supabase is mocked via a fake table
builder attached to `app.state.supabase`.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

os.environ.setdefault("WORKER_JWT_SECRET", "ci-test-secret-not-for-production")

import jwt
import pytest
from fastapi.testclient import TestClient

from app.extract import ExtractionResult, extract_reporting_requirements
from app.main import app

# ---------------------------------------------------------------------------
# Fake Anthropic client
# ---------------------------------------------------------------------------


@dataclass
class _FakeUsage:
    input_tokens: int = 100
    output_tokens: int = 50


@dataclass
class _FakeTextBlock:
    text: str
    type: str = "text"


@dataclass
class _FakeResponse:
    content: list[_FakeTextBlock]
    usage: _FakeUsage


class _FakeMessages:
    def __init__(self, fake: _FakeAnthropic) -> None:
        self._fake = fake

    async def create(self, **kwargs: Any) -> _FakeResponse:
        return self._fake._next_response(kwargs)


class _FakeAnthropic:
    """AsyncAnthropic-shaped test double.

    Scripted responses: pass a list of JSON-serializable dicts or raw
    strings. The fake yields them in order. Each call captures the
    user-body prompt so tests can inspect retry hints.
    """

    def __init__(
        self,
        responses: list[dict[str, Any] | str],
        *,
        usage_in: int = 100,
        usage_out: int = 50,
    ) -> None:
        self._responses = list(responses)
        self._usage_in = usage_in
        self._usage_out = usage_out
        self.calls: list[dict[str, Any]] = []
        self.messages = _FakeMessages(self)

    def _next_response(self, kwargs: dict[str, Any]) -> _FakeResponse:
        self.calls.append(kwargs)
        if not self._responses:
            raise AssertionError("_FakeAnthropic called more times than scripted")
        payload = self._responses.pop(0)
        text = payload if isinstance(payload, str) else json.dumps(payload)
        return _FakeResponse(
            content=[_FakeTextBlock(text=text)],
            usage=_FakeUsage(input_tokens=self._usage_in, output_tokens=self._usage_out),
        )


# ---------------------------------------------------------------------------
# Schema-valid fixture payload
# ---------------------------------------------------------------------------


def _valid_requirements() -> dict[str, Any]:
    return {
        "award_summary": {
            "program_name": "Rural Wellness Initiative",
            "funder_name": "Administration for Native Americans",
            "award_min_usd": 50000,
            "award_max_usd": 150000,
            "period_months": 36,
            "cfda_number": "93.612",
            "eligibility_summary": "Federally recognized tribes and tribal orgs.",
        },
        "reports": [
            {
                "title": "Semiannual Progress Report",
                "report_type": "progress",
                "due_offset_days": 30,
                "period_months": 6,
                "format": "portal",
                "narrative_sections": [
                    {
                        "key": "activities",
                        "label": "Activities",
                        "field_type": "narrative",
                        "required": True,
                        "word_count_max": 1000,
                        "word_count_min": 250,
                        "description": "Describe activities this period.",
                    }
                ],
            }
        ],
        "citations": [
            {"field": "reports.0.due_offset_days", "page": 4, "quote": "due within 30 days"}
        ],
        "uncertainties": [],
    }


def _invalid_requirements_missing_top_level() -> dict[str, Any]:
    # Missing required top-level "citations" and "uncertainties".
    return {
        "award_summary": {
            "program_name": "X",
            "funder_name": "Y",
            "award_min_usd": None,
            "award_max_usd": None,
        },
        "reports": [],
    }


# ---------------------------------------------------------------------------
# Extractor unit tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extractor_happy_path_returns_valid_result() -> None:
    fake = _FakeAnthropic([_valid_requirements()])
    result = await extract_reporting_requirements("parsed markdown text", fake)

    assert isinstance(result, ExtractionResult)
    assert result.schema_valid is True
    assert result.schema_errors is None
    assert result.attempts == 1
    assert result.tokens_in == 100
    assert result.tokens_out == 50
    assert result.requirements["award_summary"]["program_name"] == "Rural Wellness Initiative"
    # Only one round trip to Anthropic on the happy path.
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_extractor_retries_once_after_schema_violation() -> None:
    fake = _FakeAnthropic(
        [
            _invalid_requirements_missing_top_level(),
            _valid_requirements(),
        ]
    )
    result = await extract_reporting_requirements("parsed text", fake)

    assert result.schema_valid is True
    assert result.attempts == 2
    assert result.schema_errors is None
    # Tokens accumulate across both attempts.
    assert result.tokens_in == 200
    assert result.tokens_out == 100

    # The second call's user body should include a schema_errors hint.
    second_user = fake.calls[1]["messages"][0]["content"]
    assert "schema_errors" in second_user


@pytest.mark.asyncio
async def test_extractor_gives_up_after_two_schema_violations() -> None:
    fake = _FakeAnthropic(
        [
            _invalid_requirements_missing_top_level(),
            _invalid_requirements_missing_top_level(),
        ]
    )
    result = await extract_reporting_requirements("parsed text", fake)

    assert result.schema_valid is False
    assert result.attempts == 2
    assert result.schema_errors is not None
    assert len(result.schema_errors) > 0
    # Exactly two calls, never three.
    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_extractor_handles_empty_parsed_text() -> None:
    """Empty parsed text still reaches the LLM. The LLM handles it."""
    fake = _FakeAnthropic([_valid_requirements()])
    result = await extract_reporting_requirements("", fake)

    assert result.schema_valid is True
    assert len(fake.calls) == 1
    user_body = fake.calls[0]["messages"][0]["content"]
    # Empty parsed text interpolated into the template; the placeholder
    # marker should have been replaced with nothing (still contains the
    # rest of the template).
    assert "{parsed_document_text}" not in user_body


@pytest.mark.asyncio
async def test_extractor_does_not_log_parsed_text_or_raw_response(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret_text = "SENSITIVE_TENANT_DOCUMENT_CONTENTS_XYZ_12345"
    secret_response_field = "UNIQUE_FUNDER_NAME_ABCDEF_98765"
    payload = _valid_requirements()
    payload["award_summary"]["funder_name"] = secret_response_field

    fake = _FakeAnthropic([payload])

    with caplog.at_level(logging.DEBUG, logger="app.extract.extractor"):
        await extract_reporting_requirements(secret_text, fake)

    combined_logs = "\n".join(record.getMessage() for record in caplog.records)
    # Also check structured extra fields via record.__dict__.
    for record in caplog.records:
        for value in record.__dict__.values():
            if isinstance(value, str):
                combined_logs += "\n" + value

    assert secret_text not in combined_logs
    assert secret_response_field not in combined_logs


@pytest.mark.asyncio
async def test_extractor_retries_on_non_json_then_returns_invalid() -> None:
    """A response that isn't JSON counts as a schema violation."""
    fake = _FakeAnthropic(
        [
            "this is not valid JSON at all",
            "still not JSON",
        ]
    )
    result = await extract_reporting_requirements("parsed text", fake)

    assert result.schema_valid is False
    assert result.attempts == 2
    assert result.schema_errors is not None
    assert len(fake.calls) == 2


# ---------------------------------------------------------------------------
# Route tests — /extract/requirements
# ---------------------------------------------------------------------------


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


class _FakeQuery:
    """Minimal chainable stand-in for the Supabase query builder."""

    def __init__(self, store: _FakeSupabase, table_name: str) -> None:
        self._store = store
        self._table = table_name
        self._filters: dict[str, Any] = {}
        self._order_column: str | None = None

    def select(self, _cols: str) -> _FakeQuery:
        return self

    def eq(self, column: str, value: Any) -> _FakeQuery:
        self._filters[column] = value
        return self

    def order(self, column: str) -> _FakeQuery:
        self._order_column = column
        return self

    def execute(self) -> _FakeResult:
        if self._table == "documents":
            row = self._store.documents.get(self._filters.get("id"))
            data = [row] if row else []
        elif self._table == "document_chunks":
            doc_id = self._filters.get("document_id")
            chunks = list(self._store.chunks.get(doc_id, []))
            if self._order_column == "chunk_index":
                chunks.sort(key=lambda c: c.get("chunk_index", 0))
            data = chunks
        else:
            data = []
        return _FakeResult(data=data)


@dataclass
class _FakeResult:
    data: list[dict[str, Any]]


class _FakeSupabase:
    """Store of documents and chunks addressable by the route helpers."""

    def __init__(
        self,
        documents: dict[str, dict[str, Any]] | None = None,
        chunks: dict[str, list[dict[str, Any]]] | None = None,
    ) -> None:
        self.documents = documents or {}
        self.chunks = chunks or {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


@pytest.fixture(autouse=True)
def _reset_app_state() -> Any:
    for attr in ("supabase", "anthropic"):
        if hasattr(app.state, attr):
            delattr(app.state, attr)
    yield
    for attr in ("supabase", "anthropic"):
        if hasattr(app.state, attr):
            delattr(app.state, attr)


def _install(
    *,
    documents: dict[str, dict[str, Any]] | None = None,
    chunks: dict[str, list[dict[str, Any]]] | None = None,
    anthropic_responses: list[dict[str, Any] | str] | None = None,
) -> _FakeAnthropic:
    app.state.supabase = _FakeSupabase(documents=documents, chunks=chunks)
    fake = _FakeAnthropic(anthropic_responses or [_valid_requirements()])
    app.state.anthropic = fake
    return fake


def test_route_rejects_missing_bearer_token() -> None:
    _install(
        documents={"doc-1": {"id": "doc-1", "tenant_id": "t-A"}},
        chunks={"doc-1": [{"chunk_index": 0, "content": "x"}]},
    )
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/extract/requirements", json={"document_id": "doc-1"})
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"] == "invalid_token"
    assert body["reason"] == "missing_bearer"


def test_route_returns_404_for_unknown_document() -> None:
    _install(documents={})
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/extract/requirements",
        headers={"Authorization": f"Bearer {token}"},
        json={"document_id": "does-not-exist"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "document_not_found"


def test_route_returns_403_for_cross_tenant_document() -> None:
    _install(
        documents={"doc-1": {"id": "doc-1", "tenant_id": "t-OTHER"}},
        chunks={"doc-1": [{"chunk_index": 0, "content": "some content"}]},
    )
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/extract/requirements",
        headers={"Authorization": f"Bearer {token}"},
        json={"document_id": "doc-1"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "tenant_mismatch"


def test_route_returns_409_when_document_has_no_chunks() -> None:
    _install(
        documents={"doc-1": {"id": "doc-1", "tenant_id": "t-A"}},
        chunks={},
    )
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/extract/requirements",
        headers={"Authorization": f"Bearer {token}"},
        json={"document_id": "doc-1"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "document_not_parsed"


def test_route_happy_path_returns_200_with_valid_schema() -> None:
    fake = _install(
        documents={"doc-1": {"id": "doc-1", "tenant_id": "t-A"}},
        chunks={
            "doc-1": [
                {"chunk_index": 1, "content": "second chunk"},
                {"chunk_index": 0, "content": "first chunk"},
            ]
        },
    )
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/extract/requirements",
        headers={"Authorization": f"Bearer {token}"},
        json={"document_id": "doc-1"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["schema_valid"] is True
    assert body["attempts"] == 1
    assert body["schema_errors"] is None
    assert body["requirements"]["award_summary"]["program_name"] == "Rural Wellness Initiative"
    # Chunks were concatenated in chunk_index order.
    user_body = fake.calls[0]["messages"][0]["content"]
    assert user_body.index("first chunk") < user_body.index("second chunk")


def test_route_returns_200_even_when_schema_invalid() -> None:
    _install(
        documents={"doc-1": {"id": "doc-1", "tenant_id": "t-A"}},
        chunks={"doc-1": [{"chunk_index": 0, "content": "content"}]},
        anthropic_responses=[
            _invalid_requirements_missing_top_level(),
            _invalid_requirements_missing_top_level(),
        ],
    )
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/extract/requirements",
        headers={"Authorization": f"Bearer {token}"},
        json={"document_id": "doc-1"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["schema_valid"] is False
    assert body["attempts"] == 2
    assert isinstance(body["schema_errors"], list)
    assert len(body["schema_errors"]) > 0
