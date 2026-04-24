"""pdfplumber parser wrapper.

Iterates the document page by page, extracts text and tables, and uses
lightweight heuristics to identify headings (all caps, numbered, or
bold-ish). This is the fallback parser in the envelope (see
`/docs/05-build-plan.md` Phase 2 and `/CLAUDE.md`). It runs CPU-only
with no model weights, so it is safe to run in CI.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.parsers.base import ParsedDocument, ParsedHeading, ParsedPage, ParsedTable
from app.parsers.markdown import (
    document_to_markdown,
    headings_from_pages,
    table_to_markdown,
    tables_from_pages,
)

# A numbered heading looks like "1", "1.", "1.2", "1.2.3 " ... followed by text.
_NUMBERED_HEADING = re.compile(r"^(?P<num>\d+(?:\.\d+)*)\.?\s+(?P<text>\S.+)$")
# A short line in ALL CAPS, optionally with digits or punctuation, no lowercase.
_ALLCAPS_HEADING = re.compile(r"^[A-Z0-9][A-Z0-9 \-&/,.:'\"()]{2,}$")


def parse(pdf_bytes: bytes) -> ParsedDocument:
    """Parse a PDF from raw bytes and return a `ParsedDocument`.

    Uses pdfplumber's `page.extract_text()` and `page.extract_tables()`.
    Heading detection is heuristic. pdfplumber does not give us reliable
    font metadata for every PDF, so we fall back to two cheap signals:
    numbered prefixes and ALL-CAPS short lines. Accuracy on real NOFOs is
    tracked by the bake-off scorecard.
    """
    import io

    import pdfplumber

    pages: list[ParsedPage] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            headings = _detect_headings(text, page_number=i)
            raw_tables = page.extract_tables() or []
            tables: list[ParsedTable] = []
            for raw in raw_tables:
                rows = _normalize_table(raw)
                if not rows:
                    continue
                tables.append(
                    ParsedTable(
                        page_number=i,
                        rows=rows,
                        markdown=table_to_markdown(rows),
                    )
                )
            pages.append(
                ParsedPage(
                    page_number=i,
                    text=text,
                    headings=headings,
                    tables=tables,
                )
            )

    doc = ParsedDocument(
        page_count=len(pages),
        pages=pages,
        headings=headings_from_pages(pages),
        tables=tables_from_pages(pages),
    )
    doc.markdown = document_to_markdown(doc)
    return doc


def parse_path(path: Path | str) -> ParsedDocument:
    """Convenience: parse a PDF at a filesystem path."""
    data = Path(path).read_bytes()
    return parse(data)


def _detect_headings(text: str, page_number: int) -> list[ParsedHeading]:
    """Heuristic heading detection.

    Rules (in order):
      1. `^\\d+(\\.\\d+)*\\s+...` → numbered heading, level = dots + 1.
      2. Short (< 80 chars) ALL-CAPS line with no lowercase → level 1.
    Lines are skipped if they look like a body paragraph (too long or
    ending with a period followed by more body text).
    """
    headings: list[ParsedHeading] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or len(line) > 120:
            continue

        numbered = _NUMBERED_HEADING.match(line)
        if numbered:
            level = numbered.group("num").count(".") + 1
            level = max(1, min(6, level))
            headings.append(
                ParsedHeading(
                    text=numbered.group("text").strip(),
                    level=level,
                    page_number=page_number,
                )
            )
            continue

        if len(line) <= 80 and _ALLCAPS_HEADING.match(line) and not any(c.islower() for c in line):
            headings.append(ParsedHeading(text=line, level=1, page_number=page_number))

    return headings


def _normalize_table(raw: list[list[str | None]]) -> list[list[str]]:
    """Coerce pdfplumber's table cells to strings and drop empty rows."""
    rows: list[list[str]] = []
    for row in raw:
        cleaned = ["" if c is None else str(c).strip() for c in row]
        if any(cell for cell in cleaned):
            rows.append(cleaned)
    return rows
