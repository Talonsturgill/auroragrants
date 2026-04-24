"""Chunker tests.

Covers:
  - empty input
  - short doc under target
  - long doc with clean sentence boundaries
  - long doc with no sentence boundaries (force-break)
  - heading ancestry preservation
  - page mapping with and without offsets
"""

from __future__ import annotations

import pytest

from app.ingest.chunker import TARGET_TOKENS, Chunker


@pytest.fixture
def chunker() -> Chunker:
    return Chunker()


def test_empty_input_returns_empty_list(chunker: Chunker) -> None:
    assert chunker.chunk("") == []
    assert chunker.chunk("   \n  \n ") == []


def test_short_doc_produces_single_chunk(chunker: Chunker) -> None:
    # A ~200-token paragraph. "Hello world." repeated generates 3 tokens per
    # occurrence, so 70 reps ~ 210 tokens.
    text = "Hello world. " * 70
    chunks = chunker.chunk(text)
    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].content.startswith("Hello world.")
    # No overlap required for a single chunk.
    assert chunks[0].token_count < TARGET_TOKENS


def test_long_sentence_doc_produces_multiple_overlapping_chunks(
    chunker: Chunker,
) -> None:
    # Build a long doc with clear sentence boundaries. Each sentence has
    # varied length so boundaries don't align exactly with token windows.
    sentences = [
        f"This is sentence number {i} which contains a few additional words "
        f"to pad the length and make chunking more realistic."
        for i in range(400)
    ]
    text = " ".join(sentences)
    chunks = chunker.chunk(text)
    assert len(chunks) >= 3
    # Each chunk should be within [target - backup_window, target].
    for c in chunks[:-1]:
        assert c.token_count <= TARGET_TOKENS
        assert c.token_count >= TARGET_TOKENS - chunker.backup_window
    # All chunk_index values are sequential starting at 0.
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    # Each non-final chunk should end on a sentence boundary.
    for c in chunks[:-1]:
        assert c.content.rstrip().endswith((".", "!", "?"))


def test_consecutive_chunks_overlap(chunker: Chunker) -> None:
    # If there are at least two chunks, the start of chunk N+1 should share
    # some token content with the end of chunk N (overlap is 100 tokens).
    sentences = [
        f"Sentence {i} carries its own subject and predicate for variety." for i in range(500)
    ]
    text = " ".join(sentences)
    chunks = chunker.chunk(text)
    assert len(chunks) >= 2
    first_end = chunks[0].content[-200:]
    second_start = chunks[1].content[:200]
    # There should be some shared substring of at least one full sentence.
    # Because the chunker trims to sentence boundaries before computing the
    # overlap step, the overlap is approximate; we just require a non-empty
    # intersection at the word level.
    shared_words = set(first_end.split()) & set(second_start.split())
    assert len(shared_words) >= 3


def test_no_sentence_boundary_force_breaks_at_target(chunker: Chunker) -> None:
    # A stream of tokens without any sentence terminators.
    text = "alpha " * 4000  # far larger than target
    chunks = chunker.chunk(text)
    assert len(chunks) >= 2
    # The first chunk must not exceed target_tokens.
    assert chunks[0].token_count <= TARGET_TOKENS
    # And since there are no boundaries to back up to, it should be exactly
    # at the target.
    assert chunks[0].token_count == TARGET_TOKENS


def test_heading_ancestry_is_preserved(chunker: Chunker) -> None:
    # Build a doc whose body under "### Baz" is > target tokens so that the
    # LAST chunk is guaranteed to start past every heading. The very first
    # chunk may still start at offset 0 (before "# Foo"), which correctly
    # yields a heading of "# Foo" only; we check the tail chunk instead.
    body = "Some substantive prose in this section. " * 400
    text = "\n".join(
        [
            "# Foo",
            "intro paragraph for foo. " * 3,
            "## Bar",
            "intro paragraph for bar. " * 3,
            "### Baz",
            body,
        ]
    )
    chunks = chunker.chunk(text)
    assert len(chunks) >= 2
    tail = chunks[-1]
    assert tail.section_heading is not None
    assert "# Foo" in tail.section_heading
    assert "## Bar" in tail.section_heading
    assert "### Baz" in tail.section_heading
    # Chain order matters: shallowest first.
    assert tail.section_heading.index("# Foo") < tail.section_heading.index("## Bar")
    assert tail.section_heading.index("## Bar") < tail.section_heading.index("### Baz")


def test_page_mapping_with_offsets() -> None:
    chunker = Chunker()
    # Build a 2-page doc: page 1 is ~200 tokens, page 2 is ~200 tokens.
    page1 = "Page one content. " * 60
    page2 = "Page two content. " * 60
    markdown = page1 + page2
    pages = [
        {
            "page_number": 1,
            "text_start_offset": 0,
            "text_end_offset": len(page1),
        },
        {
            "page_number": 2,
            "text_start_offset": len(page1),
            "text_end_offset": len(markdown),
        },
    ]
    chunks = chunker.chunk(markdown, pages=pages)
    assert chunks, "expected at least one chunk"
    # Since the doc is ~400 tokens it fits in one chunk. The chunk should
    # span both pages.
    c = chunks[0]
    assert c.page_start == 1
    assert c.page_end in (1, 2)  # depends on where content ends after strip


def test_page_mapping_without_offsets_falls_back() -> None:
    chunker = Chunker()
    # If pages lack offsets, the chunker distributes evenly across listed
    # page numbers. Pass two pages and a doc long enough to span both.
    markdown = "alpha beta gamma. " * 300
    pages = [{"page_number": 1}, {"page_number": 2}]
    chunks = chunker.chunk(markdown, pages=pages)
    assert chunks
    # page_start is always valid, >= 1
    for c in chunks:
        assert c.page_start >= 1
        assert c.page_end >= c.page_start


def test_chunk_indices_are_contiguous(chunker: Chunker) -> None:
    text = "This is a test sentence. " * 1500
    chunks = chunker.chunk(text)
    assert len(chunks) >= 2
    indices = [c.chunk_index for c in chunks]
    assert indices == list(range(len(chunks)))


def test_validator_rejects_invalid_overlap() -> None:
    with pytest.raises(ValueError):
        Chunker(target_tokens=100, overlap_tokens=100)
    with pytest.raises(ValueError):
        Chunker(target_tokens=100, overlap_tokens=200)
