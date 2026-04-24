"""DOCX renderer via python-docx.

Structure matches the PDF:
  - Cover page with funder, report title, tenant name, approval date.
  - One `Heading 2` per approved field.
  - Body paragraphs per field with citation tokens preserved inline.
  - Page break before a "Citations" section at the end.
  - Final page with the mandatory AI-disclosure footer.
"""

from __future__ import annotations

import io

from app.export.renderer import (
    DISCLOSURE_FOOTER,
    ExportResult,
    RenderPayload,
    build_filename,
)

CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _render_cover(doc: object, payload: RenderPayload) -> None:
    """Write the cover-page heading block."""
    # Type the local binding as Any for the python-docx API. The module's
    # stubs are minimal so we keep the imports local.
    from docx.document import Document  # type: ignore[import-untyped]

    d: Document = doc  # type: ignore[assignment]
    d.add_heading(payload.report_title, level=0)
    d.add_paragraph(payload.funder_name)
    if payload.tenant_name:
        d.add_paragraph(payload.tenant_name)
    if payload.approval_date:
        d.add_paragraph(f"Approved: {payload.approval_date}")


def _render_section(doc: object, label: str, body: str) -> None:
    """Write one heading-2 + body paragraph block."""
    from docx.document import Document  # type: ignore[import-untyped]

    d: Document = doc  # type: ignore[assignment]
    d.add_heading(label, level=2)
    # python-docx treats embedded newlines by creating separate paragraphs
    # on explicit calls. We split on blank-line boundaries so empty lines
    # render as paragraph breaks.
    if not body:
        d.add_paragraph("")
        return
    for para in body.split("\n\n"):
        para_text = para.strip("\n")
        d.add_paragraph(para_text)


def _render_citations(doc: object, payload: RenderPayload) -> None:
    """Write the "Citations" appendix if any citations exist."""
    from docx.document import Document  # type: ignore[import-untyped]

    d: Document = doc  # type: ignore[assignment]
    if not payload.citation_sources:
        return
    d.add_page_break()
    d.add_heading("Citations", level=2)
    for c in payload.citation_sources:
        page_str = f"p. {c.page}" if c.page is not None else "no page"
        header = f"[{c.id}] {page_str}"
        if c.source:
            header = f"{header} — {c.source}"
        d.add_paragraph(header)
        if c.excerpt:
            # Indent the quote to visually nest it under the citation.
            p = d.add_paragraph(f'"{c.excerpt}"')
            p.paragraph_format.left_indent = _indent_emu()


def _indent_emu() -> int:
    """Return a 0.25 inch indent in EMU (English Metric Units).

    python-docx uses EMU for left_indent. 914400 EMU == 1 inch.
    """
    return int(914400 * 0.25)


def _render_footer(doc: object) -> None:
    """Attach the disclosure footer to every page via the document footer.

    python-docx exposes footers per section; we write to the default
    section's footer so every rendered page carries it.
    """
    from docx.document import Document  # type: ignore[import-untyped]

    d: Document = doc  # type: ignore[assignment]
    for section in d.sections:
        footer = section.footer
        # The footer has a default paragraph; overwrite it.
        para = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
        para.text = DISCLOSURE_FOOTER


def render_docx(payload: RenderPayload) -> ExportResult:
    """Render `payload` as a `.docx` document."""
    # Defer the import so test environments without python-docx can still
    # import the module header (unit tests gate via importorskip).
    from docx import Document  # type: ignore[import-untyped]

    doc = Document()

    _render_cover(doc, payload)
    for section in payload.sections:
        _render_section(doc, section.label, section.body)
    _render_citations(doc, payload)
    _render_footer(doc)

    buf = io.BytesIO()
    doc.save(buf)

    return ExportResult(
        content=buf.getvalue(),
        content_type=CONTENT_TYPE,
        filename=build_filename(payload, "docx"),
    )
