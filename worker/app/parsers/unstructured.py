"""Unstructured parser wrapper.

`partition_pdf` returns a list of typed elements. We map those to our
ParsedDocument structure:

  - `Title`          → heading level 1
  - `Header`         → heading level 2
  - `Table`          → ParsedTable (rows parsed from HTML if available)
  - `NarrativeText`  → body text
  - `ListItem`       → body text, prefixed with "- " as a markdown bullet
  - `Text`/other     → body text

Page mapping comes from `element.metadata.page_number`. Unstructured is a
fallback in the envelope. Its table extraction is weaker than Marker's
but it handles scanned PDFs well via the OCR strategy.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.parsers.base import ParsedDocument, ParsedHeading, ParsedPage, ParsedTable
from app.parsers.markdown import (
    document_to_markdown,
    headings_from_pages,
    table_to_markdown,
    tables_from_pages,
)


def parse(pdf_bytes: bytes, strategy: str = "fast") -> ParsedDocument:
    """Parse a PDF from raw bytes using Unstructured.

    `strategy="fast"` keeps CI and smoke tests cheap. Production calls
    can switch to `"hi_res"` for OCR + layout.
    """
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        return parse_path(tmp.name, strategy=strategy)


def parse_path(path: Path | str, strategy: str = "fast") -> ParsedDocument:
    """Parse a PDF at a filesystem path using Unstructured."""
    # Lazy import so CI doesn't drag Unstructured's heavy optional deps in.
    from unstructured.partition.pdf import partition_pdf

    elements = partition_pdf(filename=str(path), strategy=strategy)
    return _build_document(elements)


def _build_document(elements: list[Any]) -> ParsedDocument:
    """Group elements by page and map types to ParsedPage fields."""
    by_page: dict[int, ParsedPage] = {}

    for el in elements:
        page_no = _page_number_of(el)
        page = by_page.setdefault(page_no, ParsedPage(page_number=page_no))
        category = _category_of(el)
        text = (getattr(el, "text", None) or "").strip()
        if not text and category != "Table":
            continue

        if category == "Title":
            page.headings.append(ParsedHeading(text=text, level=1, page_number=page_no))
            page.text = _append_text(page.text, text)
        elif category == "Header":
            page.headings.append(ParsedHeading(text=text, level=2, page_number=page_no))
            page.text = _append_text(page.text, text)
        elif category == "Table":
            rows = _table_rows_from_element(el)
            markdown = table_to_markdown(rows) if rows else text
            page.tables.append(
                ParsedTable(
                    page_number=page_no,
                    rows=rows,
                    markdown=markdown,
                )
            )
        elif category == "ListItem":
            page.text = _append_text(page.text, f"- {text}")
        else:
            page.text = _append_text(page.text, text)

    pages = [by_page[k] for k in sorted(by_page.keys())]
    if not pages:
        pages = [ParsedPage(page_number=1)]

    doc = ParsedDocument(
        page_count=len(pages),
        pages=pages,
        headings=headings_from_pages(pages),
        tables=tables_from_pages(pages),
    )
    doc.markdown = document_to_markdown(doc)
    return doc


def _page_number_of(el: Any) -> int:
    """Extract 1-based page number from an Unstructured element."""
    md = getattr(el, "metadata", None)
    if md is None:
        return 1
    page = getattr(md, "page_number", None)
    if page is None and isinstance(md, dict):
        page = md.get("page_number")
    try:
        return max(1, int(page)) if page is not None else 1
    except (TypeError, ValueError):
        return 1


def _category_of(el: Any) -> str:
    """Resolve the Unstructured element category as a plain string."""
    category = getattr(el, "category", None)
    if category:
        return str(category)
    # Fall back to class name (e.g. `Title`, `NarrativeText`).
    return type(el).__name__


def _append_text(existing: str, addition: str) -> str:
    """Concatenate text chunks with a blank line between them."""
    if not existing:
        return addition
    return f"{existing}\n\n{addition}"


_HTML_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_HTML_CELL = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.IGNORECASE | re.DOTALL)
_HTML_TAG = re.compile(r"<[^>]+>")


def _table_rows_from_element(el: Any) -> list[list[str]]:
    """Extract rows from an Unstructured Table element.

    Prefers `metadata.text_as_html` (proper structure). Falls back to
    tab-delimited `element.text`.
    """
    md = getattr(el, "metadata", None)
    html = None
    if md is not None:
        html = getattr(md, "text_as_html", None)
        if html is None and isinstance(md, dict):
            html = md.get("text_as_html")
    if html:
        rows: list[list[str]] = []
        for row_match in _HTML_ROW.finditer(html):
            cells = [_HTML_TAG.sub("", c).strip() for c in _HTML_CELL.findall(row_match.group(1))]
            if any(cells):
                rows.append(cells)
        if rows:
            return rows

    text = (getattr(el, "text", "") or "").strip()
    if not text:
        return []
    rows = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.split("\t")]
        if any(cells):
            rows.append(cells)
    return rows
