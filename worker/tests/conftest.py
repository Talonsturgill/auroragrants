"""Shared pytest fixtures for the worker test suite.

We set `WORKER_JWT_SECRET` early (before the FastAPI app imports) so the
middleware can decode tokens in tests. We also provide two synthetic
PDFs: a tiny one-page PDF and a small three-page PDF. Both are
assembled from scratch (no reportlab, no network) using Type1 fonts so
pdfplumber can extract text without needing font files on disk.
"""

from __future__ import annotations

import os

# Set the shared secret BEFORE the FastAPI app or middleware is imported.
os.environ.setdefault("WORKER_JWT_SECRET", "test-secret")
os.environ.setdefault("APP_ENV", "test")

from typing import Any

import pytest


def _tiktoken_available() -> bool:
    """Probe whether tiktoken can load `cl100k_base`.

    CI sometimes cannot reach `openaipublic.blob.core.windows.net` (sandbox
    or transient network issues). If the encoding cannot be fetched and is
    not cached, tests that depend on it will be skipped rather than errored.
    """
    try:
        import tiktoken

        tiktoken.get_encoding("cl100k_base")
        return True
    except Exception:
        return False


TIKTOKEN_AVAILABLE = _tiktoken_available()


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip chunker tests when tiktoken's BPE file is unreachable."""
    if TIKTOKEN_AVAILABLE:
        return
    skip_marker = pytest.mark.skip(
        reason="tiktoken cl100k_base not available (no network, no cache)"
    )
    for item in items:
        if "test_chunker" in str(item.fspath):
            item.add_marker(skip_marker)


def _build_pdf(page_texts: list[str]) -> bytes:
    """Assemble a minimal PDF 1.4 with `len(page_texts)` pages.

    Each page uses Helvetica (Type1 standard font, no embedded file).
    Returns raw bytes. pdfplumber, pypdf, and Marker can all open the
    result. Text is placed on one line per page at (72, 720) in the
    612x792 media box.
    """
    header = b"%PDF-1.4\n"
    parts: list[bytes] = [header]
    offsets: list[int] = []
    cursor = len(header)

    objs: list[bytes] = []
    n_pages = len(page_texts)
    # Object numbering:
    #   1: Catalog
    #   2: Pages
    #   3..3+n_pages-1: Page objects
    #   3+n_pages..3+2*n_pages-1: Content streams
    #   3+2*n_pages: Font
    page_ids = [3 + i for i in range(n_pages)]
    content_ids = [3 + n_pages + i for i in range(n_pages)]
    font_id = 3 + 2 * n_pages

    objs.append(b"<</Type/Catalog/Pages 2 0 R>>")
    kids = b" ".join(f"{pid} 0 R".encode() for pid in page_ids)
    objs.append(b"<</Type/Pages/Kids[" + kids + b"]/Count " + str(n_pages).encode() + b">>")
    for i, _ in enumerate(page_texts):
        objs.append(
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents "
            + str(content_ids[i]).encode()
            + b" 0 R/Resources<</Font<</F1 "
            + str(font_id).encode()
            + b" 0 R>>>>>>"
        )
    for text in page_texts:
        # Escape `(` and `)` in text since they delimit literal strings.
        safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = (
            b"BT /F1 12 Tf 72 720 Td (" + safe.encode("latin-1", errors="replace") + b") Tj ET\n"
        )
        objs.append(
            b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"endstream"
        )
    objs.append(b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")

    for i, body in enumerate(objs, start=1):
        offsets.append(cursor)
        chunk = f"{i} 0 obj".encode() + body + b"\nendobj\n"
        parts.append(chunk)
        cursor += len(chunk)

    xref_offset = cursor
    xref_lines = [b"xref\n", f"0 {len(objs) + 1}\n".encode(), b"0000000000 65535 f \n"]
    for o in offsets:
        xref_lines.append(f"{o:010d} 00000 n \n".encode())
    parts.append(b"".join(xref_lines))
    parts.append(
        b"trailer<</Size " + str(len(objs) + 1).encode() + b"/Root 1 0 R>>\n"
        b"startxref\n" + str(xref_offset).encode() + b"\n%%EOF\n"
    )
    return b"".join(parts)


@pytest.fixture
def tiny_pdf_bytes() -> bytes:
    """A one-page PDF with the text 'Hello AuroraGrants'."""
    return _build_pdf(["Hello AuroraGrants"])


@pytest.fixture
def three_page_pdf_bytes() -> bytes:
    """A three-page synthetic PDF with distinct text per page."""
    return _build_pdf(
        [
            "EXECUTIVE SUMMARY",
            "Page two body text continues the narrative.",
            "3. Budget Justification",
        ]
    )


@pytest.fixture
def jwt_secret() -> str:
    """The shared HS256 secret used for test JWTs."""
    return os.environ["WORKER_JWT_SECRET"]


@pytest.fixture
def make_jwt(jwt_secret: str) -> Any:
    """Factory producing signed JWTs with the given claims.

    Defaults to a ten-minute expiry and a fixed tenant_id so tests don't
    have to repeat boilerplate.
    """
    import time

    import jwt as pyjwt

    def _make(**claims: Any) -> str:
        now = int(time.time())
        payload: dict[str, Any] = {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "role": "editor",
            "iat": now,
            "exp": now + 600,
        }
        payload.update(claims)
        return pyjwt.encode(payload, jwt_secret, algorithm="HS256")

    return _make
