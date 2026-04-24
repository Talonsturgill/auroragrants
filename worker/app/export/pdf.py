"""PDF renderer via WeasyPrint.

We build a minimal HTML document with inline CSS (no external fonts or
stylesheets) and ask WeasyPrint for the PDF bytes. The template mirrors
the DOCX structure: cover block, one heading per field, body
paragraphs, optional "Citations" section, and a page-level disclosure
footer that appears at the bottom of every page.

WeasyPrint pulls in cairo/pango at runtime. Hosts without those system
libraries should skip PDF export entirely; see `/worker/fly.toml` for
the production install. At import time we do not raise if WeasyPrint
cannot load — we defer until `render_pdf` is actually called so unit
tests can still import the module and skip via `pytest.importorskip`.
"""

from __future__ import annotations

from html import escape

from app.export.renderer import (
    DISCLOSURE_FOOTER,
    ExportResult,
    RenderPayload,
    build_filename,
)

CONTENT_TYPE = "application/pdf"


def _inline_css() -> str:
    """All CSS lives inline. No external fonts or stylesheets."""
    # `@page` footer uses a string-set + running header pattern so the
    # disclosure appears on every rendered page.
    return """
        @page {
            size: Letter;
            margin: 0.75in 0.75in 1.0in 0.75in;
            @bottom-center {
                content: string(disclosure);
                font-size: 9pt;
                color: #555;
            }
        }
        body {
            font-family: "Helvetica", "Arial", sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #111;
        }
        .cover {
            margin-bottom: 32pt;
            border-bottom: 1pt solid #ddd;
            padding-bottom: 16pt;
        }
        .cover h1 {
            font-size: 20pt;
            margin: 0 0 8pt 0;
        }
        .cover .meta {
            font-size: 11pt;
            color: #444;
            margin: 0;
        }
        .meta-line {
            margin: 2pt 0;
        }
        h2 {
            font-size: 13pt;
            margin-top: 18pt;
            margin-bottom: 6pt;
        }
        p.body {
            margin: 0 0 8pt 0;
            white-space: pre-wrap;
        }
        .citations {
            margin-top: 24pt;
            border-top: 1pt solid #ddd;
            padding-top: 12pt;
            font-size: 10pt;
        }
        .citations h2 {
            font-size: 12pt;
            margin-top: 0;
        }
        .citation {
            margin-bottom: 6pt;
        }
        .citation .excerpt {
            color: #333;
            font-style: italic;
            margin-left: 12pt;
        }
        .disclosure-source {
            string-set: disclosure content();
            position: absolute;
            left: -9999px;
            height: 0;
        }
    """


def _render_body_paragraphs(body: str) -> str:
    """Render the field body as paragraph HTML, preserving blank-line breaks."""
    if not body:
        return '<p class="body"></p>'
    parts = [p for p in body.split("\n\n") if p is not None]
    out: list[str] = []
    for part in parts:
        escaped = escape(part, quote=False)
        out.append(f'<p class="body">{escaped}</p>')
    return "".join(out) or '<p class="body"></p>'


def _render_citations_html(payload: RenderPayload) -> str:
    if not payload.citation_sources:
        return ""
    rows: list[str] = ['<section class="citations"><h2>Citations</h2>']
    for c in payload.citation_sources:
        page_str = f"p. {c.page}" if c.page is not None else "no page"
        header = f"[{c.id}] {escape(page_str)}"
        if c.source:
            header = f"{header} &mdash; {escape(c.source)}"
        rows.append('<div class="citation">')
        rows.append(f"<div>{header}</div>")
        if c.excerpt:
            rows.append(f'<div class="excerpt">&ldquo;{escape(c.excerpt)}&rdquo;</div>')
        rows.append("</div>")
    rows.append("</section>")
    return "".join(rows)


def _render_cover_html(payload: RenderPayload) -> str:
    parts = [
        '<section class="cover">',
        f"<h1>{escape(payload.report_title)}</h1>",
        f'<p class="meta meta-line">{escape(payload.funder_name)}</p>',
    ]
    if payload.tenant_name:
        parts.append(f'<p class="meta meta-line">{escape(payload.tenant_name)}</p>')
    if payload.approval_date:
        parts.append(f'<p class="meta meta-line">Approved: {escape(payload.approval_date)}</p>')
    parts.append("</section>")
    return "".join(parts)


def _render_sections_html(payload: RenderPayload) -> str:
    parts: list[str] = []
    for section in payload.sections:
        parts.append(f"<h2>{escape(section.label)}</h2>")
        parts.append(_render_body_paragraphs(section.body))
    return "".join(parts)


def build_html(payload: RenderPayload) -> str:
    """Assemble the HTML document. Public for tests."""
    return (
        "<!DOCTYPE html><html><head>"
        f"<style>{_inline_css()}</style>"
        "</head><body>"
        # Hidden source element that sets the running footer string.
        f'<div class="disclosure-source">{escape(DISCLOSURE_FOOTER)}</div>'
        f"{_render_cover_html(payload)}"
        f"{_render_sections_html(payload)}"
        f"{_render_citations_html(payload)}"
        "</body></html>"
    )


def render_pdf(payload: RenderPayload) -> ExportResult:
    """Render `payload` as PDF bytes.

    Raises `RuntimeError` if WeasyPrint is not installed.
    """
    try:
        from weasyprint import HTML  # type: ignore[import-untyped]
    except ImportError as exc:  # pragma: no cover - guarded in route
        raise RuntimeError("weasyprint_not_installed") from exc

    html_doc = build_html(payload)
    pdf_bytes = HTML(string=html_doc).write_pdf()
    return ExportResult(
        content=pdf_bytes,
        content_type=CONTENT_TYPE,
        filename=build_filename(payload, "pdf"),
    )
