"""Heading-aware markdown chunker.

Chunks parsed markdown into ~800-token pieces with 100-token overlap.
Rules:
  - Never break mid-sentence. When the 800-token boundary falls inside a
    sentence, back up to the nearest sentence boundary within the last
    200 tokens. If no such boundary exists, force-break at 800 tokens.
  - Preserve heading ancestry. Each chunk carries `section_heading` which is
    the nearest ancestor heading chain joined by " > " (e.g.
    "# Foo > ## Bar > ### Baz").
  - Page mapping: `page_start` is the page containing the chunk's first
    character, `page_end` is the page containing its last character. Derived
    from parser.pages offsets, or evenly distributed if offsets are missing.
  - Consecutive identical chunks are deduped (rare but possible on short
    docs where overlap equals content).

Uses tiktoken with the encoding for `text-embedding-3-large`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import tiktoken

TARGET_TOKENS = 800
OVERLAP_TOKENS = 100
BACKUP_WINDOW = 200  # when trimming to sentence boundary, look back this many tokens
EMBED_MODEL = "text-embedding-3-large"

# Matches a sentence terminator followed by whitespace. Used to identify safe
# split points inside a candidate chunk.
_SENTENCE_BOUNDARY = re.compile(r"[.!?]\s+|\n\n+")

# Matches a markdown heading line. The leading hashes determine depth.
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


@dataclass
class Chunk:
    """A single chunk, ready for embedding and DB insert."""

    chunk_index: int
    content: str
    section_heading: str | None
    page_start: int
    page_end: int
    token_count: int
    content_type: str = "prose"
    # Internal start/end char offsets in the source markdown. Useful for tests
    # and for debugging alignment issues; not persisted.
    char_start: int = field(default=0, compare=False)
    char_end: int = field(default=0, compare=False)


def _load_encoding() -> Any:
    """Return the tiktoken encoding for our embedding model.

    tiktoken does not always know `text-embedding-3-large` by name on older
    versions. Falls back to `cl100k_base` which is what 3-large uses.
    """
    try:
        return tiktoken.encoding_for_model(EMBED_MODEL)
    except KeyError:
        return tiktoken.get_encoding("cl100k_base")


class Chunker:
    """Heading-aware markdown chunker.

    Instantiate once per worker process. `chunk()` is pure and re-entrant.
    """

    def __init__(
        self,
        target_tokens: int = TARGET_TOKENS,
        overlap_tokens: int = OVERLAP_TOKENS,
        backup_window: int = BACKUP_WINDOW,
    ) -> None:
        if overlap_tokens >= target_tokens:
            raise ValueError("overlap_tokens must be smaller than target_tokens")
        self.target_tokens = target_tokens
        self.overlap_tokens = overlap_tokens
        self.backup_window = backup_window
        self.enc = _load_encoding()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def chunk(
        self,
        markdown: str,
        pages: list[dict[str, Any]] | None = None,
    ) -> list[Chunk]:
        """Split `markdown` into chunks.

        `pages` is the parser's page table: a list of dicts with
        `page_number`, `text_start_offset`, `text_end_offset`. If missing or
        empty, page mapping falls back to an equal-distribution heuristic:
        the document is assumed to span at least one page, and chunks are
        assigned pages proportional to their character offsets.
        """
        if not markdown or not markdown.strip():
            return []

        heading_index = self._index_headings(markdown)
        page_index = _normalize_pages(pages, len(markdown))

        tokens = self.enc.encode(markdown)
        if not tokens:
            return []

        chunks: list[Chunk] = []
        cursor = 0
        chunk_index = 0
        total = len(tokens)

        while cursor < total:
            end = min(cursor + self.target_tokens, total)
            # Decode the candidate window so we can find a sentence boundary.
            window_tokens = tokens[cursor:end]
            window_text = self.enc.decode(window_tokens)

            # If we did not consume the whole document, try to back up to a
            # clean sentence boundary within the trailing `backup_window`.
            if end < total:
                trim_to = self._find_sentence_boundary(window_text)
                if trim_to is not None:
                    trimmed_text = window_text[:trim_to]
                    trimmed_tokens = self.enc.encode(trimmed_text)
                    # Only accept the backup if it stays within the window.
                    trimmed_len = len(trimmed_tokens)
                    if trimmed_len > 0 and trimmed_len >= self.target_tokens - self.backup_window:
                        window_text = trimmed_text
                        window_tokens = trimmed_tokens
                        end = cursor + trimmed_len

            content = window_text.strip()
            if not content:
                # Decoded to whitespace — force-advance to avoid an infinite loop.
                cursor = end if end > cursor else cursor + 1
                continue

            # Dedup consecutive identical chunks (can happen when a tail block
            # is smaller than the overlap and the next window just repeats it).
            if chunks and chunks[-1].content == content:
                break

            char_start, char_end = self._char_span(markdown, content, chunks)
            page_start, page_end = _map_pages(char_start, char_end, page_index)
            section_heading = self._heading_for_offset(char_start, heading_index)
            token_count = len(window_tokens)

            chunks.append(
                Chunk(
                    chunk_index=chunk_index,
                    content=content,
                    section_heading=section_heading,
                    page_start=page_start,
                    page_end=page_end,
                    token_count=token_count,
                    char_start=char_start,
                    char_end=char_end,
                )
            )
            chunk_index += 1

            if end >= total:
                break

            # Advance with overlap. Overlap is capped at token_count - 1 so the
            # cursor always moves forward.
            step = max(1, token_count - self.overlap_tokens)
            cursor += step

        return chunks

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _find_sentence_boundary(text: str) -> int | None:
        """Return the char offset (exclusive) of the last sentence boundary in
        `text`, or None if none exists. Prefers paragraph breaks over single
        sentence terminators when both exist in the trailing region.
        """
        # Prefer the latest paragraph break.
        para_break = text.rfind("\n\n")
        last_match: re.Match[str] | None = None
        for m in _SENTENCE_BOUNDARY.finditer(text):
            last_match = m
        if para_break != -1 and (last_match is None or para_break >= last_match.start()):
            return para_break + 2
        if last_match is not None:
            return last_match.end()
        return None

    @staticmethod
    def _index_headings(markdown: str) -> list[tuple[int, int, str]]:
        """Return a list of (char_offset, depth, text) for every heading."""
        out: list[tuple[int, int, str]] = []
        for m in _HEADING_RE.finditer(markdown):
            hashes, text = m.group(1), m.group(2).strip()
            out.append((m.start(), len(hashes), text))
        return out

    @staticmethod
    def _heading_for_offset(offset: int, headings: list[tuple[int, int, str]]) -> str | None:
        """Return the ancestor heading chain for `offset` as
        "# H1 > ## H2 > ### H3", or None if no heading precedes `offset`.
        """
        stack: list[tuple[int, str]] = []  # (depth, text)
        for h_offset, depth, text in headings:
            if h_offset > offset:
                break
            # Pop any headings at equal or deeper depth.
            while stack and stack[-1][0] >= depth:
                stack.pop()
            stack.append((depth, text))
        if not stack:
            return None
        return " > ".join(f"{'#' * d} {t}" for d, t in stack)

    @staticmethod
    def _char_span(markdown: str, content: str, prev_chunks: list[Chunk]) -> tuple[int, int]:
        """Locate `content` in `markdown`, preferring positions after the
        previous chunk's start. Returns (start, end). On failure (e.g.
        whitespace differences after decode), returns (0, len(content)) as a
        best-effort.
        """
        search_from = prev_chunks[-1].char_start + 1 if prev_chunks else 0
        idx = markdown.find(content, search_from)
        if idx == -1:
            # Fall back: strip + search for the first line.
            first_line = content.splitlines()[0] if content else ""
            if first_line:
                idx = markdown.find(first_line, search_from)
        if idx == -1:
            return (0, len(content))
        return (idx, idx + len(content))


# ----------------------------------------------------------------------
# Page mapping helpers
# ----------------------------------------------------------------------


@dataclass
class _PageRange:
    page_number: int
    start: int
    end: int  # exclusive


def _normalize_pages(pages: list[dict[str, Any]] | None, doc_len: int) -> list[_PageRange]:
    """Normalize the parser.pages list into a list of _PageRange objects.

    If pages is missing or does not carry offsets, falls back to an
    equal-distribution heuristic: if there are N pages listed (by count),
    the document is split into N equal char windows. If pages is empty or
    None, we return a single page covering [0, doc_len).
    """
    if not pages:
        return [_PageRange(page_number=1, start=0, end=max(doc_len, 1))]

    has_offsets = all(
        isinstance(p.get("text_start_offset"), int) and isinstance(p.get("text_end_offset"), int)
        for p in pages
    )
    if has_offsets:
        ranges: list[_PageRange] = []
        for p in pages:
            ranges.append(
                _PageRange(
                    page_number=int(p.get("page_number") or (len(ranges) + 1)),
                    start=int(p["text_start_offset"]),
                    end=int(p["text_end_offset"]),
                )
            )
        # Guard against zero-length final page.
        if ranges and ranges[-1].end <= ranges[-1].start:
            ranges[-1].end = max(doc_len, ranges[-1].start + 1)
        return ranges

    # Equal-distribution fallback.
    n = len(pages)
    per = max(1, doc_len // n) if n else 1
    ranges = []
    for i, p in enumerate(pages):
        start = i * per
        end = (i + 1) * per if i < n - 1 else max(doc_len, start + 1)
        ranges.append(
            _PageRange(
                page_number=int(p.get("page_number") or (i + 1)),
                start=start,
                end=end,
            )
        )
    return ranges


def _map_pages(char_start: int, char_end: int, pages: list[_PageRange]) -> tuple[int, int]:
    """Return (page_start, page_end) for a char span."""
    page_start = pages[0].page_number
    page_end = pages[-1].page_number
    found_start = False
    for pr in pages:
        if not found_start and pr.start <= char_start < pr.end:
            page_start = pr.page_number
            found_start = True
        if pr.start < char_end <= pr.end or pr.start <= char_end - 1 < pr.end:
            page_end = pr.page_number
    return (page_start, page_end)
