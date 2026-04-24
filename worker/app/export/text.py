"""Plain-text renderer for clipboard-friendly funder-portal paste.

Sections are separated by `\n\n==========\n\n`. Citations are rendered
inline as `[n]` (unchanged from the stored body) and collated in a
"Citations" appendix. The disclosure footer trails the document.
"""

from __future__ import annotations

from app.export.renderer import (
    DISCLOSURE_FOOTER,
    ExportResult,
    RenderPayload,
    build_filename,
)

SECTION_SEPARATOR = "\n\n==========\n\n"
CONTENT_TYPE = "text/plain; charset=utf-8"


def _header_block(payload: RenderPayload) -> str:
    lines = [payload.report_title, payload.funder_name]
    if payload.tenant_name:
        lines.append(payload.tenant_name)
    if payload.approval_date:
        lines.append(f"Approved: {payload.approval_date}")
    return "\n".join(lines)


def _citations_block(payload: RenderPayload) -> str:
    if not payload.citation_sources:
        return ""
    rows = ["Citations"]
    for c in payload.citation_sources:
        page_str = f"p. {c.page}" if c.page is not None else "no page"
        source = c.source or ""
        header = f"[{c.id}] {page_str}"
        if source:
            header = f"{header} — {source}"
        rows.append(header)
        if c.excerpt:
            rows.append(f'    "{c.excerpt}"')
    return "\n".join(rows)


def render_text(payload: RenderPayload) -> ExportResult:
    """Render `payload` as plain text bytes."""
    blocks: list[str] = [_header_block(payload)]
    for section in payload.sections:
        block = f"{section.label}\n\n{section.body}" if section.body else section.label
        blocks.append(block)

    citations = _citations_block(payload)
    if citations:
        blocks.append(citations)

    # The disclosure footer is mandatory on every export.
    blocks.append(DISCLOSURE_FOOTER)

    content = SECTION_SEPARATOR.join(blocks).encode("utf-8")
    return ExportResult(
        content=content,
        content_type=CONTENT_TYPE,
        filename=build_filename(payload, "txt"),
    )
