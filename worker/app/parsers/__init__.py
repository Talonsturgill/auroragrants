"""PDF parser wrappers for the AuroraGrants worker.

Exposes three parsers (Marker, pdfplumber, Unstructured) behind a unified
Pydantic interface (`ParserResult`). The bake-off script in
`worker/scripts/parser_bakeoff.py` calls these wrappers and scores each
against the golden set. See `/docs/05-build-plan.md` Phase 2.
"""

from __future__ import annotations

from app.parsers.base import (
    ParsedDocument,
    ParsedHeading,
    ParsedPage,
    ParsedTable,
    ParserResult,
)

__all__ = [
    "ParsedDocument",
    "ParsedHeading",
    "ParsedPage",
    "ParsedTable",
    "ParserResult",
]
