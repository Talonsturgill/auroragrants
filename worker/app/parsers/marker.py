"""Marker parser wrapper.

Marker is the primary parser in the envelope. It is heavy (loads
ML models on first call) so we lazy-import it inside `parse` and
never at module import time. Unit tests mock
`marker.convert.convert_single_pdf` to avoid pulling weights.

Marker returns:
  - `full_text` — a markdown string of the whole document.
  - `images` — dict of image bytes keyed by block id (ignored here).
  - `out_meta` — dict with at least `"page_stats"` (per-page token counts,
    block counts) and sometimes `"toc"` (heading outline).

We parse `full_text` into per-page slices using the `<page>` markers
marker emits by default, or fall back to a single page if markers are
absent.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.parsers.base import ParsedDocument, ParsedHeading, ParsedPage, ParsedTable
from app.parsers.markdown import headings_from_pages, tables_from_pages

# Marker's per-page separator looks like "\n\n{N}------------------------------------------------\n\n".
# We accept any run of dashes at least 10 long, bracketed by blank lines, with a leading page number.
_PAGE_SPLIT = re.compile(r"\n{0,2}(\d+)-{10,}\n{1,2}")
_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_MD_TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")
_MD_TABLE_SEP = re.compile(r"^\s*\|(\s*:?-+:?\s*\|)+\s*$")


def parse(pdf_bytes: bytes, max_pages: int | None = None) -> ParsedDocument:
    """Parse a PDF from raw bytes using Marker.

    Marker's ML models are loaded lazily on first call. The call site
    pays the model load cost once per worker process. Tests should
    monkeypatch `marker.convert.convert_single_pdf` to avoid this.
    """
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        return parse_path(tmp.name, max_pages=max_pages)


def parse_path(path: Path | str, max_pages: int | None = None) -> ParsedDocument:
    """Parse a PDF at a filesystem path using Marker.

    Marker model loading happens on first call. Subsequent calls in the
    same process reuse the cached models. Tests MUST mock
    `marker.convert.convert_single_pdf` to avoid GPU/weights requirements.
    """
    # Lazy import so test collection doesn't drag marker + torch in.
    from marker.convert import convert_single_pdf
    from marker.models import load_all_models

    # `load_all_models` caches internally; a parser wrapper can call it
    # repeatedly without re-downloading weights.
    model_lst = load_all_models()
    full_text, _images, out_meta = convert_single_pdf(str(path), model_lst, max_pages=max_pages)
    return _build_document(full_text, out_meta)


def _build_document(full_text: str, out_meta: dict[str, Any] | None) -> ParsedDocument:
    """Convert Marker's raw output into our ParsedDocument shape."""
    pages = _split_into_pages(full_text)
    # Attach any heading hints from Marker's TOC if available.
    toc = (out_meta or {}).get("toc") or []
    for entry in toc:
        _apply_toc_hint(pages, entry)

    doc = ParsedDocument(
        page_count=len(pages),
        markdown=full_text,
        pages=pages,
        headings=headings_from_pages(pages),
        tables=tables_from_pages(pages),
    )
    return doc


def _split_into_pages(full_text: str) -> list[ParsedPage]:
    """Split Marker's markdown into pages.

    Marker delimits pages with `\\n\\nN-------------------\\n\\n` where N is
    the 1-based page number. If no markers are present we assume one page.
    """
    if not full_text:
        return [ParsedPage(page_number=1)]
    parts = _PAGE_SPLIT.split(full_text)
    # `re.split` with a capturing group yields [before, n1, text1, n2, text2, ...].
    pages: list[ParsedPage] = []
    if len(parts) == 1:
        pages.append(_page_from_markdown(1, parts[0]))
        return pages

    # First chunk is page 1's content (before the "1-----" separator).
    first_text = parts[0]
    if first_text.strip():
        pages.append(_page_from_markdown(1, first_text))
    # Remaining chunks are pairs of (page_number, content).
    for i in range(1, len(parts) - 1, 2):
        try:
            n = int(parts[i])
        except ValueError:
            n = len(pages) + 1
        body = parts[i + 1] if i + 1 < len(parts) else ""
        pages.append(_page_from_markdown(n, body))
    if not pages:
        pages.append(_page_from_markdown(1, full_text))
    return pages


def _page_from_markdown(page_number: int, md: str) -> ParsedPage:
    """Build a ParsedPage from a slice of Marker markdown."""
    headings: list[ParsedHeading] = []
    tables: list[ParsedTable] = []

    lines = md.splitlines()
    i = 0
    table_buf: list[list[str]] = []
    while i < len(lines):
        line = lines[i]
        heading_match = _MD_HEADING.match(line)
        if heading_match:
            hashes, text = heading_match.group(1), heading_match.group(2)
            headings.append(
                ParsedHeading(
                    text=text.strip(),
                    level=len(hashes),
                    page_number=page_number,
                )
            )
            i += 1
            continue

        if _MD_TABLE_ROW.match(line):
            # Collect contiguous table rows.
            table_buf = []
            while i < len(lines) and _MD_TABLE_ROW.match(lines[i]):
                # Skip markdown separator rows like "| --- | --- |".
                if _MD_TABLE_SEP.match(lines[i]):
                    i += 1
                    continue
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                table_buf.append(cells)
                i += 1
            if table_buf:
                tables.append(
                    ParsedTable(
                        page_number=page_number,
                        rows=table_buf,
                        markdown="\n".join(lines[max(0, i - len(table_buf) - 1) : i]).strip(),
                    )
                )
            continue

        i += 1

    return ParsedPage(
        page_number=page_number,
        text=md.strip(),
        headings=headings,
        tables=tables,
    )


def _apply_toc_hint(pages: list[ParsedPage], entry: dict[str, Any]) -> None:
    """If Marker's TOC names a heading already present on a page, keep it.

    If a TOC entry references a page we already have but no matching
    heading is present (because text extraction missed it), inject it.
    """
    title = entry.get("title") or entry.get("text")
    level = int(entry.get("level", 1) or 1)
    page_no = int(entry.get("page", 1) or 1)
    if not title:
        return
    for page in pages:
        if page.page_number != page_no:
            continue
        existing = {h.text.strip().lower() for h in page.headings}
        if title.strip().lower() not in existing:
            page.headings.append(
                ParsedHeading(
                    text=title.strip(),
                    level=max(1, min(6, level)),
                    page_number=page_no,
                )
            )
        return
