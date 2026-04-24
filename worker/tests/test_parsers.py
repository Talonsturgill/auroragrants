"""Tests for the Phase 2 parser endpoints and JWT middleware.

Marker and Unstructured are gated by heavy ML / OCR dependencies that are
not available in CI. We mock the underlying library entry points and test
that our wrappers (and the FastAPI endpoint shape) behave correctly.
pdfplumber is exercised end-to-end against a synthetic PDF built at
test-time in `conftest.py`.
"""

from __future__ import annotations

import sys
import time
import types
from typing import Any
from unittest.mock import patch

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import app
from app.parsers.base import (
    ParsedDocument,
    ParsedHeading,
    ParsedPage,
    ParsedTable,
)

client = TestClient(app, raise_server_exceptions=False)

PDF_URL = "https://storage.example/test.pdf"
DOC_ID = "doc-123"
TENANT_ID = "tenant-1"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _body(pdf_url: str = PDF_URL) -> dict[str, str]:
    return {"pdf_url": pdf_url, "document_id": DOC_ID, "tenant_id": TENANT_ID}


# ---------------------------------------------------------------------------
# JWT middleware
# ---------------------------------------------------------------------------


def test_auth_middleware_rejects_missing_bearer() -> None:
    resp = client.post("/parse/pdfplumber", json=_body())
    assert resp.status_code == 401
    payload = resp.json()
    assert payload["error"] == "invalid_token"
    assert payload["reason"] == "missing_bearer"


def test_auth_middleware_rejects_bad_signature(make_jwt: Any) -> None:
    # Sign with a different secret so the signature check fails.
    import jwt as pyjwt

    bad = pyjwt.encode(
        {"tenant_id": "tenant-1", "exp": int(time.time()) + 60},
        "wrong-secret",
        algorithm="HS256",
    )
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(bad))
    assert resp.status_code == 401
    assert resp.json()["reason"] == "invalid_signature"


def test_auth_middleware_rejects_expired_token(jwt_secret: str) -> None:
    import jwt as pyjwt

    # Expired well outside the 30-second clock skew window.
    expired = pyjwt.encode(
        {"tenant_id": "tenant-1", "exp": int(time.time()) - 3600},
        jwt_secret,
        algorithm="HS256",
    )
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(expired))
    assert resp.status_code == 401
    assert resp.json()["reason"] == "expired_token"


def test_auth_middleware_rejects_missing_tenant(jwt_secret: str) -> None:
    import jwt as pyjwt

    token = pyjwt.encode(
        {"exp": int(time.time()) + 60},
        jwt_secret,
        algorithm="HS256",
    )
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 401
    assert resp.json()["reason"] == "missing_tenant"


@respx.mock
def test_auth_middleware_accepts_valid_token(make_jwt: Any, tiny_pdf_bytes: bytes) -> None:
    """A correctly signed token passes and reaches the handler."""
    respx.get(PDF_URL).mock(
        return_value=httpx.Response(
            200, content=tiny_pdf_bytes, headers={"content-type": "application/pdf"}
        )
    )
    token = make_jwt()
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engine"] == "pdfplumber"
    assert body["document_id"] == DOC_ID


# ---------------------------------------------------------------------------
# pdfplumber endpoint
# ---------------------------------------------------------------------------


@respx.mock
def test_parse_pdfplumber_real_small_pdf(make_jwt: Any, three_page_pdf_bytes: bytes) -> None:
    respx.get(PDF_URL).mock(return_value=httpx.Response(200, content=three_page_pdf_bytes))
    token = make_jwt()
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["page_count"] == 3
    assert len(body["pages"]) == 3
    # Page mapping preserved.
    assert [p["page_number"] for p in body["pages"]] == [1, 2, 3]
    # Executive summary on page 1 is ALL CAPS, should be detected as heading.
    p1_headings = body["pages"][0]["headings"]
    assert any(h["text"].startswith("EXECUTIVE SUMMARY") for h in p1_headings)
    # Numbered heading on page 3.
    p3_headings = body["pages"][2]["headings"]
    assert any(h["text"].startswith("Budget Justification") for h in p3_headings)


@respx.mock
def test_parse_pdfplumber_invalid_pdf_returns_400(make_jwt: Any) -> None:
    respx.get(PDF_URL).mock(return_value=httpx.Response(200, content=b"not a pdf at all"))
    token = make_jwt()
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 400
    assert resp.json()["detail"] == "not_a_pdf"


@respx.mock
def test_parse_upstream_fetch_failure_returns_502(make_jwt: Any) -> None:
    respx.get(PDF_URL).mock(return_value=httpx.Response(500, content=b""))
    token = make_jwt()
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 502
    assert "pdf_fetch_failed" in resp.json()["detail"]


@respx.mock
def test_parse_rejects_oversized_content_length(make_jwt: Any) -> None:
    respx.get(PDF_URL).mock(
        return_value=httpx.Response(
            200,
            content=b"%PDF-1.4\n",
            headers={"content-length": str(200 * 1024 * 1024)},
        )
    )
    token = make_jwt()
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 413
    assert resp.json()["detail"] == "pdf_too_large"


@respx.mock
def test_parse_rejects_tenant_mismatch(make_jwt: Any, tiny_pdf_bytes: bytes) -> None:
    respx.get(PDF_URL).mock(return_value=httpx.Response(200, content=tiny_pdf_bytes))
    token = make_jwt(tenant_id="tenant-other")
    resp = client.post("/parse/pdfplumber", json=_body(), headers=_headers(token))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "tenant_mismatch"


# ---------------------------------------------------------------------------
# Marker endpoint (mocked)
# ---------------------------------------------------------------------------


def _install_fake_marker(full_text: str, toc: list[dict[str, Any]] | None = None) -> None:
    """Install a fake `marker` module tree so `import marker.convert` works.

    We do NOT have the real `marker-pdf` package installed in CI. The
    wrapper lazy-imports it inside `parse_path`, so we only need these
    modules present at call time.
    """
    convert_mod = types.ModuleType("marker.convert")
    models_mod = types.ModuleType("marker.models")
    root_mod = types.ModuleType("marker")

    def _fake_convert_single_pdf(
        path: str, model_lst: Any, max_pages: Any = None
    ) -> tuple[str, dict[str, bytes], dict[str, Any]]:
        return full_text, {}, {"toc": toc or []}

    def _fake_load_all_models() -> list[str]:
        return ["fake-model"]

    convert_mod.convert_single_pdf = _fake_convert_single_pdf  # type: ignore[attr-defined]
    models_mod.load_all_models = _fake_load_all_models  # type: ignore[attr-defined]
    root_mod.convert = convert_mod  # type: ignore[attr-defined]
    root_mod.models = models_mod  # type: ignore[attr-defined]
    sys.modules["marker"] = root_mod
    sys.modules["marker.convert"] = convert_mod
    sys.modules["marker.models"] = models_mod


@respx.mock
def test_parse_marker_with_mocked_convert(make_jwt: Any, tiny_pdf_bytes: bytes) -> None:
    respx.get(PDF_URL).mock(return_value=httpx.Response(200, content=tiny_pdf_bytes))
    full_text = (
        "# Project Overview\n\n"
        "Some body text on page one.\n\n"
        "1------------------------------------------------\n\n"
        "## Budget\n\n"
        "| Category | Amount |\n"
        "| --- | --- |\n"
        "| Salaries | $10,000 |\n\n"
        "2------------------------------------------------\n\n"
    )
    _install_fake_marker(full_text, toc=[{"title": "Appendix", "level": 2, "page": 2}])
    token = make_jwt()
    resp = client.post("/parse/marker", json=_body(), headers=_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engine"] == "marker"
    assert body["page_count"] >= 2
    # Markdown heading parsed.
    heading_texts = {h["text"] for h in body["headings"]}
    assert "Project Overview" in heading_texts
    assert "Budget" in heading_texts
    # TOC-injected heading applied.
    assert "Appendix" in heading_texts
    # Table captured.
    assert any(t["rows"] for t in body["tables"])


# ---------------------------------------------------------------------------
# Unstructured endpoint (mocked)
# ---------------------------------------------------------------------------


class _FakeMeta:
    def __init__(self, page_number: int, text_as_html: str | None = None) -> None:
        self.page_number = page_number
        self.text_as_html = text_as_html


class _FakeEl:
    def __init__(
        self,
        category: str,
        text: str,
        page_number: int,
        text_as_html: str | None = None,
    ) -> None:
        self.category = category
        self.text = text
        self.metadata = _FakeMeta(page_number, text_as_html)


def _install_fake_unstructured(elements: list[Any]) -> None:
    """Install a fake `unstructured.partition.pdf.partition_pdf`."""
    pdf_mod = types.ModuleType("unstructured.partition.pdf")
    partition_mod = types.ModuleType("unstructured.partition")
    root_mod = types.ModuleType("unstructured")

    def _fake_partition_pdf(filename: str, strategy: str = "fast") -> list[Any]:
        return elements

    pdf_mod.partition_pdf = _fake_partition_pdf  # type: ignore[attr-defined]
    partition_mod.pdf = pdf_mod  # type: ignore[attr-defined]
    root_mod.partition = partition_mod  # type: ignore[attr-defined]
    sys.modules["unstructured"] = root_mod
    sys.modules["unstructured.partition"] = partition_mod
    sys.modules["unstructured.partition.pdf"] = pdf_mod


@respx.mock
def test_parse_unstructured_with_mocked_partition(make_jwt: Any, tiny_pdf_bytes: bytes) -> None:
    respx.get(PDF_URL).mock(return_value=httpx.Response(200, content=tiny_pdf_bytes))
    elements = [
        _FakeEl("Title", "Project Narrative", 1),
        _FakeEl("NarrativeText", "This project serves Alaska Native communities.", 1),
        _FakeEl("Header", "Budget", 2),
        _FakeEl(
            "Table",
            "Category\tAmount\nSalaries\t$10,000",
            2,
            text_as_html=(
                "<table><tr><td>Category</td><td>Amount</td></tr>"
                "<tr><td>Salaries</td><td>$10,000</td></tr></table>"
            ),
        ),
        _FakeEl("ListItem", "Eligible as a 501(c)(3)", 2),
    ]
    _install_fake_unstructured(elements)
    token = make_jwt()
    resp = client.post("/parse/unstructured", json=_body(), headers=_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["engine"] == "unstructured"
    assert body["page_count"] == 2
    heading_texts = {h["text"] for h in body["headings"]}
    assert "Project Narrative" in heading_texts
    assert "Budget" in heading_texts
    # Table was parsed from the HTML payload with 2 rows.
    tables = body["tables"]
    assert len(tables) == 1
    assert tables[0]["rows"] == [["Category", "Amount"], ["Salaries", "$10,000"]]


# ---------------------------------------------------------------------------
# Parser wrapper direct tests (cheap, no HTTP)
# ---------------------------------------------------------------------------


def test_pdfplumber_wrapper_direct(three_page_pdf_bytes: bytes) -> None:
    from app.parsers import pdfplumber as pdfplumber_parser

    doc = pdfplumber_parser.parse(three_page_pdf_bytes)
    assert isinstance(doc, ParsedDocument)
    assert doc.page_count == 3
    assert len(doc.pages) == 3
    assert doc.markdown  # non-empty


def test_markdown_helpers_roundtrip() -> None:
    from app.parsers.markdown import (
        document_to_markdown,
        heading_to_markdown,
        table_to_markdown,
    )

    assert heading_to_markdown(ParsedHeading(text="Scope", level=2, page_number=1)) == "## Scope"
    md = table_to_markdown([["a", "b"], ["1", "2"]])
    assert "| a | b |" in md
    assert "| 1 | 2 |" in md

    page = ParsedPage(
        page_number=1,
        text="body",
        headings=[ParsedHeading(text="Scope", level=1, page_number=1)],
        tables=[ParsedTable(page_number=1, rows=[["a", "b"]], markdown="| a | b |")],
    )
    doc = ParsedDocument(page_count=1, pages=[page])
    rendered = document_to_markdown(doc)
    assert "<!-- page 1 -->" in rendered
    assert "# Scope" in rendered


# ---------------------------------------------------------------------------
# Production misconfiguration guard
# ---------------------------------------------------------------------------


def test_middleware_rejects_when_secret_missing_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WORKER_JWT_SECRET", "")
    # Use a separate TestClient against the already-imported app so the
    # middleware re-reads env on this request.
    local = TestClient(app, raise_server_exceptions=False)
    resp = local.post(
        "/parse/pdfplumber",
        json=_body(),
        headers={"Authorization": "Bearer anything"},
    )
    assert resp.status_code == 401
    assert resp.json()["reason"] == "server_misconfigured"


# Avoid the patch import flagged as unused by Ruff when the test module is
# trimmed down (it's used to document future hook points for real models).
_ = patch
