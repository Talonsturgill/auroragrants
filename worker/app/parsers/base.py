"""Common Pydantic models for parser output.

Every parser wrapper (Marker, pdfplumber, Unstructured) MUST return a
`ParserResult`. This normalizes the bake-off scorecard and the downstream
chunker in `/worker/scripts/parser_bakeoff.py` and the ingestion pipeline.

Model hierarchy:
  - `ParserResult` is the envelope returned by the route handler.
  - `ParsedDocument` is the parser-level structure (pages, headings, tables).
  - `ParsedPage` holds per-page text and structural elements.
  - `ParsedHeading` and `ParsedTable` capture structural elements with a
    page mapping so retrieval can show `[source: doc_id, page, chunk]`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ParsedHeading(BaseModel):
    """A heading with a hierarchy level (1 = top) and page number."""

    model_config = ConfigDict(extra="forbid")

    text: str
    level: int = Field(ge=1, le=6)
    page_number: int = Field(ge=1)


class ParsedTable(BaseModel):
    """A table captured with its raw rows and a markdown rendering."""

    model_config = ConfigDict(extra="forbid")

    page_number: int = Field(ge=1)
    rows: list[list[str]] = Field(default_factory=list)
    markdown: str = ""
    caption: str | None = None


class ParsedPage(BaseModel):
    """Structural content of a single PDF page."""

    model_config = ConfigDict(extra="forbid")

    page_number: int = Field(ge=1)
    text: str = ""
    headings: list[ParsedHeading] = Field(default_factory=list)
    tables: list[ParsedTable] = Field(default_factory=list)


class ParsedDocument(BaseModel):
    """A parser's view of the full document, structured per page."""

    model_config = ConfigDict(extra="forbid")

    page_count: int = Field(ge=0)
    markdown: str = ""
    pages: list[ParsedPage] = Field(default_factory=list)
    headings: list[ParsedHeading] = Field(default_factory=list)
    tables: list[ParsedTable] = Field(default_factory=list)


class ParserResult(BaseModel):
    """HTTP envelope returned by `/parse/{engine}` endpoints.

    The scorecard script consumes this directly and flattens
    `headings` and `tables` across pages for counting.
    """

    model_config = ConfigDict(extra="forbid")

    document_id: str
    engine: str
    duration_ms: int = Field(ge=0)
    page_count: int = Field(ge=0)
    markdown: str
    pages: list[ParsedPage] = Field(default_factory=list)
    tables: list[ParsedTable] = Field(default_factory=list)
    headings: list[ParsedHeading] = Field(default_factory=list)
