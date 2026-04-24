"""Report export renderers: PDF (WeasyPrint), DOCX (python-docx), plain text.

See /docs/05-build-plan.md Phase 4, tasks 10-12. The renderers take a
normalized payload assembled from a `reports` row and its approved
`report_fields`, transform citation tokens into footnote references,
and emit the corresponding binary for download.

All exports carry the Apache-2.0 AI-disclosure footer. Do not change the
wording without a `docs/followups.md` entry per CLAUDE.md.
"""

from app.export.docx import render_docx
from app.export.pdf import render_pdf
from app.export.renderer import (
    DISCLOSURE_FOOTER,
    Citation,
    ExportRequest,
    ExportResult,
    ExportSection,
    RenderPayload,
    build_payload,
)
from app.export.text import render_text

__all__ = [
    "DISCLOSURE_FOOTER",
    "Citation",
    "ExportRequest",
    "ExportResult",
    "ExportSection",
    "RenderPayload",
    "build_payload",
    "render_docx",
    "render_pdf",
    "render_text",
]
