"""Tests for the Phase 4 report export system (PDF, DOCX, plain text).

Unit tests exercise the pure rendering logic with a hand-assembled
`RenderPayload`. Route tests exercise `/export/report` end-to-end with
a fake Supabase and the real renderers so we validate the disclosure
footer and content-type wiring through the full path.
"""

from __future__ import annotations

import io
import os
import time
import zipfile
from dataclasses import dataclass
from typing import Any

os.environ.setdefault("WORKER_JWT_SECRET", "ci-test-secret-not-for-production")

import jwt
import pytest
from fastapi.testclient import TestClient

from app.export import (
    DISCLOSURE_FOOTER,
    Citation,
    ExportSection,
    RenderPayload,
    build_payload,
    render_docx,
    render_text,
)
from app.export.renderer import build_filename
from app.main import app

# WeasyPrint is optional on CI hosts without cairo/pango. Gate every PDF
# test behind an importorskip so the rest of the file still runs.
try:
    import weasyprint  # type: ignore[import-untyped]  # noqa: F401

    WEASYPRINT_AVAILABLE = True
except Exception:  # pragma: no cover - environment-dependent
    WEASYPRINT_AVAILABLE = False


# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------


def _payload(
    *,
    sections: list[ExportSection] | None = None,
    citations: list[Citation] | None = None,
    report_title: str = "Semiannual Progress Report",
    funder_name: str = "Rasmuson Foundation",
    tenant_name: str | None = "Tanana Chiefs Conference",
    approval_date: str | None = "2026-04-24",
) -> RenderPayload:
    return RenderPayload(
        report_id="report-1",
        report_title=report_title,
        funder_name=funder_name,
        tenant_name=tenant_name,
        approval_date=approval_date,
        sections=tuple(sections or []),
        citation_sources=tuple(citations or []),
    )


def _sample_sections() -> list[ExportSection]:
    return [
        ExportSection(
            label="Activities",
            key="activities",
            body=("We served 42 elders in Q1 [1]. Meal delivery continued through winter [2]."),
            citations=(
                Citation(id=1, page=3, excerpt="served 42 elders", source="Letter.pdf"),
                Citation(id=2, page=5, excerpt="meal delivery continued"),
            ),
        ),
        ExportSection(
            label="Challenges",
            key="challenges",
            body="Supply-chain delays slowed equipment procurement.",
            citations=(),
        ),
    ]


# ---------------------------------------------------------------------------
# Unit tests: rendering logic
# ---------------------------------------------------------------------------


def test_text_renderer_includes_disclosure_footer() -> None:
    payload = _payload(sections=_sample_sections(), citations=list(_sample_sections()[0].citations))
    result = render_text(payload)

    text = result.content.decode("utf-8")
    assert DISCLOSURE_FOOTER in text
    assert result.content_type.startswith("text/plain")
    assert result.filename.endswith(".txt")


def test_text_renderer_uses_section_separator_and_order() -> None:
    payload = _payload(sections=_sample_sections())
    result = render_text(payload)
    text = result.content.decode("utf-8")

    # The separator is exactly "\n\n==========\n\n" between blocks.
    assert "\n\n==========\n\n" in text
    # Header precedes first section label.
    assert text.index(payload.report_title) < text.index("Activities")
    # Sections are rendered in the order we provided.
    assert text.index("Activities") < text.index("Challenges")


def test_text_renderer_has_no_sections_still_has_footer() -> None:
    payload = _payload(sections=[])
    result = render_text(payload)
    text = result.content.decode("utf-8")
    assert DISCLOSURE_FOOTER in text


def test_renderer_omits_unapproved_fields() -> None:
    """`build_payload` drops fields where human_approved is not True."""
    report = {"id": "r-1", "title": "Quarterly Report", "status": "ready_for_export"}
    fields = [
        {
            "id": "f-approved",
            "label": "Activities",
            "key": "activities",
            "required": True,
            "human_approved": True,
            "current_value": "Approved body [1].",
            "draft_value": "",
            "approved_at": "2026-04-24T10:00:00Z",
        },
        {
            "id": "f-pending",
            "label": "Budget Narrative",
            "key": "budget",
            "required": True,
            "human_approved": False,
            "current_value": "Still drafting.",
            "draft_value": "Still drafting.",
            "approved_at": None,
        },
    ]
    drafts = {
        "f-approved": {
            "report_field_id": "f-approved",
            "version": 1,
            "citations": [{"id": 1, "page": 2, "excerpt": "cited line"}],
        }
    }

    payload = build_payload(
        report=report,
        fields=fields,
        drafts_by_field=drafts,
        funder_name="Rasmuson",
        tenant_name="TCC",
    )

    assert len(payload.sections) == 1
    assert payload.sections[0].key == "activities"
    assert all("Still drafting" not in s.body for s in payload.sections)


def test_renderer_citations_rendered_as_footnotes() -> None:
    """Citations appear once per unique id in the footnote block."""
    sections = [
        ExportSection(
            label="Activities",
            key="activities",
            body="We did X [1] and Y [2].",
            citations=(
                Citation(id=1, page=1, excerpt="X happened"),
                Citation(id=2, page=2, excerpt="Y happened", source="Report.pdf"),
            ),
        )
    ]
    payload = _payload(
        sections=sections,
        citations=[
            Citation(id=1, page=1, excerpt="X happened"),
            Citation(id=2, page=2, excerpt="Y happened", source="Report.pdf"),
        ],
    )
    text = render_text(payload).content.decode("utf-8")
    assert "[1] p. 1" in text
    assert "[2] p. 2" in text
    assert "Report.pdf" in text
    # The body still carries the inline tokens.
    assert "[1]" in text
    assert "[2]" in text


def test_build_payload_filters_citations_to_body_references() -> None:
    """A citation present in the drafts row but not referenced in the body
    should not be surfaced. Keeps exports tidy when drafts mutate."""
    report = {"id": "r-2", "title": "Q1", "status": "ready_for_export"}
    fields = [
        {
            "id": "f-1",
            "label": "Activities",
            "key": "activities",
            "required": True,
            "human_approved": True,
            "current_value": "Body cites [1] only.",
            "draft_value": "",
            "approved_at": "2026-04-01T00:00:00Z",
        }
    ]
    drafts = {
        "f-1": {
            "report_field_id": "f-1",
            "version": 3,
            "citations": [
                {"id": 1, "page": 1, "excerpt": "cited"},
                {"id": 2, "page": 2, "excerpt": "unreferenced"},
            ],
        }
    }
    payload = build_payload(report=report, fields=fields, drafts_by_field=drafts)
    # Only citation 1 is referenced.
    assert len(payload.citation_sources) == 1
    assert payload.citation_sources[0].id == 1


def test_build_filename_slugifies_and_dates() -> None:
    payload = _payload(
        report_title="Semi:annual Report",
        funder_name="Rasmuson / Foundation",
        approval_date="2026-04-24",
    )
    fname = build_filename(payload, "pdf")
    # No colons or slashes survive; date is preserved.
    assert ":" not in fname
    assert "/" not in fname
    assert fname.endswith(".pdf")
    assert "2026-04-24" in fname


def test_build_filename_uses_undated_when_missing() -> None:
    payload = _payload(approval_date=None)
    fname = build_filename(payload, "docx")
    assert fname.endswith("-undated.docx")


def test_build_payload_latest_approval_date_is_max() -> None:
    """approval_date uses the max ISO timestamp across approved fields."""
    fields = [
        {
            "id": "f-a",
            "label": "A",
            "key": "a",
            "required": True,
            "human_approved": True,
            "current_value": "A",
            "draft_value": "",
            "approved_at": "2026-02-10T00:00:00Z",
        },
        {
            "id": "f-b",
            "label": "B",
            "key": "b",
            "required": True,
            "human_approved": True,
            "current_value": "B",
            "draft_value": "",
            "approved_at": "2026-04-12T00:00:00Z",
        },
    ]
    payload = build_payload(
        report={"id": "r-x", "title": "T", "status": "ready_for_export"},
        fields=fields,
    )
    assert payload.approval_date == "2026-04-12"


def test_coerce_citations_handles_string_ids_and_missing_pages() -> None:
    """Non-int ids and missing pages should still produce valid Citations."""
    from app.export.renderer import _coerce_citations  # type: ignore[attr-defined]

    cites = _coerce_citations(
        [
            {"id": "3", "page": "4", "excerpt": "x"},
            {"id": "not-a-number", "page": 2, "excerpt": "dropped"},
            {"id": 5, "page": None, "quote": "excerpt from quote key"},
            "garbage",
            {"id": 7},
        ]
    )
    ids = [c.id for c in cites]
    assert 3 in ids
    assert 5 in ids
    assert 7 in ids
    # Dropped entries aren't present.
    assert len(cites) == 3


def test_coerce_citations_rejects_non_list() -> None:
    from app.export.renderer import _coerce_citations  # type: ignore[attr-defined]

    assert _coerce_citations(None) == []
    assert _coerce_citations({"id": 1}) == []


def test_docx_renderer_has_one_heading_per_field() -> None:
    """Each approved field produces exactly one Heading 2 paragraph.

    python-docx stores paragraph styles in the `.style.name` string. The
    cover title uses Heading 0 (Title), and each section uses Heading 2.
    """
    from docx import Document  # type: ignore[import-untyped]

    sections = _sample_sections()
    payload = _payload(sections=sections)
    result = render_docx(payload)

    assert result.content_type.startswith("application/vnd.openxmlformats")
    assert result.filename.endswith(".docx")

    doc = Document(io.BytesIO(result.content))
    heading_two_labels = [
        p.text
        for p in doc.paragraphs
        if p.style is not None and "Heading 2" in (p.style.name or "")
    ]
    assert heading_two_labels == [s.label for s in sections]


def test_docx_renderer_footer_has_disclosure() -> None:
    from docx import Document  # type: ignore[import-untyped]

    payload = _payload(sections=_sample_sections())
    result = render_docx(payload)
    doc = Document(io.BytesIO(result.content))

    footer_texts: list[str] = []
    for section in doc.sections:
        for p in section.footer.paragraphs:
            footer_texts.append(p.text)
    combined = "\n".join(footer_texts)
    assert DISCLOSURE_FOOTER in combined


def test_docx_renderer_includes_citations_page_when_present() -> None:
    from docx import Document  # type: ignore[import-untyped]

    sections = _sample_sections()
    citations = list(sections[0].citations)
    payload = _payload(sections=sections, citations=citations)
    result = render_docx(payload)
    doc = Document(io.BytesIO(result.content))
    texts = [p.text for p in doc.paragraphs]
    assert any(t == "Citations" for t in texts)
    assert any("[1]" in t for t in texts)


def test_docx_bytes_are_valid_zip() -> None:
    """.docx is a ZIP container; the rendered bytes must unzip cleanly."""
    payload = _payload(sections=_sample_sections())
    result = render_docx(payload)
    with zipfile.ZipFile(io.BytesIO(result.content)) as zf:
        names = zf.namelist()
    assert "word/document.xml" in names


@pytest.mark.skipif(not WEASYPRINT_AVAILABLE, reason="WeasyPrint not installed")
def test_pdf_renderer_returns_valid_pdf_bytes() -> None:
    from app.export import render_pdf

    payload = _payload(sections=_sample_sections())
    result = render_pdf(payload)

    assert result.content_type == "application/pdf"
    assert result.filename.endswith(".pdf")
    assert result.content.startswith(b"%PDF-")
    # PDFs end with %%EOF; tolerate trailing whitespace.
    assert b"%%EOF" in result.content[-64:]


@pytest.mark.skipif(not WEASYPRINT_AVAILABLE, reason="WeasyPrint not installed")
def test_pdf_html_contains_disclosure_and_sections() -> None:
    """The pre-render HTML carries the disclosure and every section label."""
    from app.export.pdf import build_html

    sections = _sample_sections()
    payload = _payload(sections=sections)
    html = build_html(payload)
    assert DISCLOSURE_FOOTER in html
    for s in sections:
        assert s.label in html


def test_pdf_render_raises_runtime_error_when_weasyprint_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If WeasyPrint is absent, render_pdf surfaces a RuntimeError the
    route can map to a 503. We simulate the import failure."""
    import builtins

    real_import = builtins.__import__

    def _fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "weasyprint":
            raise ImportError("no weasyprint for you")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _fake_import)

    from app.export import render_pdf

    with pytest.raises(RuntimeError, match="weasyprint_not_installed"):
        render_pdf(_payload(sections=_sample_sections()))


# ---------------------------------------------------------------------------
# Route tests
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


@dataclass
class _Result:
    data: list[dict[str, Any]]


class _FakeQuery:
    """Minimal chainable Supabase-query builder for tests."""

    def __init__(self, store: _FakeSupabase, table_name: str) -> None:
        self._store = store
        self._table = table_name
        self._filters: dict[str, Any] = {}
        self._in_filter: tuple[str, list[Any]] | None = None

    def select(self, _cols: str) -> _FakeQuery:
        return self

    def eq(self, column: str, value: Any) -> _FakeQuery:
        self._filters[column] = value
        return self

    def in_(self, column: str, values: list[Any]) -> _FakeQuery:
        self._in_filter = (column, list(values))
        return self

    def execute(self) -> _Result:
        rows = list(self._store.tables.get(self._table, []))
        if self._table == "reports":
            rid = self._filters.get("id")
            rows = [r for r in rows if r.get("id") == rid]
        elif self._table == "report_fields":
            rid = self._filters.get("report_id")
            rows = [r for r in rows if r.get("report_id") == rid]
        elif self._table == "drafts":
            if self._in_filter is not None:
                col, allowed = self._in_filter
                rows = [r for r in rows if r.get(col) in set(allowed)]
        elif self._table == "awards":
            aid = self._filters.get("id")
            rows = [r for r in rows if r.get("id") == aid]
        elif self._table == "funders":
            fid = self._filters.get("id")
            rows = [r for r in rows if r.get("id") == fid]
        elif self._table == "tenants":
            tid = self._filters.get("id")
            rows = [r for r in rows if r.get("id") == tid]
        return _Result(data=rows)


class _FakeSupabase:
    def __init__(self, tables: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.tables = tables or {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def _install_supabase(tables: dict[str, list[dict[str, Any]]]) -> _FakeSupabase:
    fake = _FakeSupabase(tables=tables)
    app.state.supabase = fake
    return fake


@pytest.fixture(autouse=True)
def _reset_app_state() -> Any:
    for attr in ("supabase",):
        if hasattr(app.state, attr):
            delattr(app.state, attr)
    yield
    for attr in ("supabase",):
        if hasattr(app.state, attr):
            delattr(app.state, attr)


def _seed_ready_report(
    *,
    tenant_id: str = "t-A",
    status: str = "ready_for_export",
) -> _FakeSupabase:
    return _install_supabase(
        {
            "reports": [
                {
                    "id": "r-1",
                    "tenant_id": tenant_id,
                    "title": "Semiannual Report",
                    "status": status,
                    "award_id": "a-1",
                }
            ],
            "report_fields": [
                {
                    "id": "f-1",
                    "report_id": "r-1",
                    "key": "activities",
                    "label": "Activities",
                    "field_type": "narrative",
                    "required": True,
                    "human_approved": True,
                    "current_value": "We served 42 elders [1].",
                    "draft_value": "",
                    "approved_at": "2026-04-24T00:00:00Z",
                }
            ],
            "drafts": [
                {
                    "id": "d-1",
                    "report_field_id": "f-1",
                    "version": 1,
                    "content": "We served 42 elders [1].",
                    "citations": [{"id": 1, "page": 3, "excerpt": "served 42 elders"}],
                }
            ],
            "awards": [{"id": "a-1", "funder_id": "fn-1"}],
            "funders": [{"id": "fn-1", "name": "Rasmuson Foundation"}],
            "tenants": [{"id": tenant_id, "name": "Tanana Chiefs"}],
        }
    )


def test_export_route_requires_auth() -> None:
    _seed_ready_report()
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post(
        "/export/report",
        json={"report_id": "r-1", "format": "text"},
    )
    assert resp.status_code == 401


def test_export_route_rejects_unknown_format() -> None:
    _seed_ready_report()
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "csv"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid_format"


def test_export_route_404_when_report_missing() -> None:
    _install_supabase({"reports": []})
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-missing", "format": "text"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "report_not_found"


def test_export_route_tenant_mismatch() -> None:
    _seed_ready_report(tenant_id="t-OTHER")
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "text"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "tenant_mismatch"


def test_export_route_rejects_non_ready_report() -> None:
    _seed_ready_report(status="drafting")
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "text"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "report_not_ready"


def test_export_route_happy_path_text() -> None:
    _seed_ready_report()
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "text"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/plain")
    disp = resp.headers["content-disposition"]
    assert "attachment" in disp
    assert disp.endswith('.txt"')
    body = resp.content.decode("utf-8")
    assert "Activities" in body
    assert DISCLOSURE_FOOTER in body
    assert "Rasmuson" in body


def test_export_route_happy_path_docx() -> None:
    _seed_ready_report()
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "docx"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert resp.headers["content-disposition"].endswith('.docx"')
    # Content must be a valid .docx zip.
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert "word/document.xml" in zf.namelist()


@pytest.mark.skipif(not WEASYPRINT_AVAILABLE, reason="WeasyPrint not installed")
def test_export_route_happy_path_pdf() -> None:
    _seed_ready_report()
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "pdf"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"].endswith('.pdf"')
    assert resp.content.startswith(b"%PDF-")


def test_export_route_503_when_supabase_missing() -> None:
    # Autouse fixture removed `supabase`. No install call.
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "text"},
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "supabase_not_configured"


def test_export_route_filename_includes_funder_title_and_date() -> None:
    _seed_ready_report()
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "text"},
    )
    disp = resp.headers["content-disposition"]
    assert "Rasmuson" in disp
    assert "Semiannual" in disp
    assert "2026-04-24" in disp


def test_export_route_approved_fields_only_included_in_body() -> None:
    """Adding an unapproved field to the table must not leak into output."""
    fake = _seed_ready_report()
    fake.tables["report_fields"].append(
        {
            "id": "f-2",
            "report_id": "r-1",
            "key": "budget",
            "label": "Budget Narrative",
            "field_type": "narrative",
            "required": True,
            "human_approved": False,
            "current_value": "DO_NOT_LEAK_SECRET_WIP",
            "draft_value": "DO_NOT_LEAK_SECRET_WIP",
            "approved_at": None,
        }
    )
    client = TestClient(app, raise_server_exceptions=False)
    token = _issue_jwt(tenant_id="t-A")
    resp = client.post(
        "/export/report",
        headers={"Authorization": f"Bearer {token}"},
        json={"report_id": "r-1", "format": "text"},
    )
    assert resp.status_code == 200
    body = resp.content.decode("utf-8")
    assert "DO_NOT_LEAK_SECRET_WIP" not in body
    assert "Budget Narrative" not in body
