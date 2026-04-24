"""Shared markdown-serialization helpers used by every parser wrapper.

Keeps the serialization deterministic so the bake-off scorecard compares
like with like, and so downstream chunking sees one canonical markdown
form regardless of upstream parser choice.
"""

from __future__ import annotations

from app.parsers.base import ParsedDocument, ParsedHeading, ParsedPage, ParsedTable


def table_to_markdown(rows: list[list[str]]) -> str:
    """Render a 2D table as a GitHub-flavored markdown table.

    The first row is treated as the header. Empty tables return "".
    """
    if not rows:
        return ""
    # Normalize row length to the widest row to keep the markdown valid.
    width = max(len(r) for r in rows)
    padded = [[_cell(c) for c in r] + [""] * (width - len(r)) for r in rows]
    header = padded[0]
    body = padded[1:] if len(padded) > 1 else []

    sep = ["---"] * width
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(sep) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _cell(value: str | None) -> str:
    """Escape a single cell so pipes and newlines don't break the table."""
    if value is None:
        return ""
    return str(value).replace("\n", " ").replace("|", "\\|").strip()


def heading_to_markdown(heading: ParsedHeading) -> str:
    """Render a heading at the given hierarchy level."""
    prefix = "#" * max(1, min(6, heading.level))
    return f"{prefix} {heading.text.strip()}"


def page_to_markdown(page: ParsedPage) -> str:
    """Render a single page as markdown.

    The page body text is kept verbatim. Tables are appended after the
    page body in order of capture. Headings are emitted both at the top
    (as a structural summary) and inline if already present in the text.
    """
    parts: list[str] = []
    for heading in page.headings:
        parts.append(heading_to_markdown(heading))
    if page.text.strip():
        parts.append(page.text.strip())
    for table in page.tables:
        if table.markdown:
            parts.append(table.markdown)
        elif table.rows:
            parts.append(table_to_markdown(table.rows))
    return "\n\n".join(parts)


def document_to_markdown(doc: ParsedDocument) -> str:
    """Render the whole document as markdown, page by page.

    Pages are delimited by a horizontal rule and a `<!-- page N -->`
    HTML comment so downstream chunkers can preserve page mapping.
    """
    chunks: list[str] = []
    for page in doc.pages:
        chunks.append(f"<!-- page {page.page_number} -->")
        body = page_to_markdown(page)
        if body:
            chunks.append(body)
    return "\n\n---\n\n".join(chunks)


def tables_from_pages(pages: list[ParsedPage]) -> list[ParsedTable]:
    """Flatten tables from a list of pages preserving page order."""
    flat: list[ParsedTable] = []
    for page in pages:
        flat.extend(page.tables)
    return flat


def headings_from_pages(pages: list[ParsedPage]) -> list[ParsedHeading]:
    """Flatten headings from a list of pages preserving page order."""
    flat: list[ParsedHeading] = []
    for page in pages:
        flat.extend(page.headings)
    return flat
