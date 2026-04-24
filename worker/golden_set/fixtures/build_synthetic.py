"""
Build a minimal 4-page synthetic PDF that mimics an Alaska NOFO structure.

This script is idempotent and dependency-free. It writes raw PDF bytes using
only the stdlib so it can run in constrained CI environments.

Usage:
    python worker/golden_set/fixtures/build_synthetic.py

Output:
    worker/golden_set/fixtures/synthetic_nofo.pdf

The content is intentionally simple so that any of the three parsers
(Marker, pdfplumber, Unstructured) can extract it and so the bakeoff metrics
are deterministic. The ground truth for this PDF lives in
`synthetic_nofo.ground_truth.yaml` next to this file.

Page layout:
    Page 1: Title "SYNTHETIC ALASKA COMMUNITY DEVELOPMENT GRANT",
            body paragraph, heading "Purpose".
    Page 2: Heading "Eligibility", bullet list.
    Page 3: Heading "Funding Range", a 3x2 table (Tier, Min, Max).
    Page 4: Heading "Application Instructions", numbered list.
"""

from __future__ import annotations

from pathlib import Path


def _escape(text: str) -> str:
    """Escape characters that are special inside a PDF literal string."""
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _text_stream(lines: list[tuple[str, int, int, int]]) -> bytes:
    """
    Build a PDF content stream from a list of (text, x, y, font_size) tuples.

    Coordinates use the PDF default: origin at bottom-left, 72 units per inch.
    """
    parts: list[str] = ["BT"]
    for text, x, y, size in lines:
        parts.append(f"/F1 {size} Tf")
        parts.append(f"{x} {y} Td")
        parts.append(f"({_escape(text)}) Tj")
        # Reset so next Td is absolute from origin.
        parts.append(f"{-x} {-y} Td")
    parts.append("ET")
    return ("\n".join(parts)).encode("latin-1")


def _pages() -> list[bytes]:
    """Return content-stream bytes for each page of the synthetic NOFO."""
    page1 = _text_stream(
        [
            ("SYNTHETIC ALASKA COMMUNITY DEVELOPMENT GRANT", 72, 740, 16),
            (
                "This is a synthetic Notice of Funding Opportunity used by the AuroraGrants",
                72,
                700,
                11,
            ),
            (
                "parser bake-off. It exists only to exercise table and heading extraction.",
                72,
                685,
                11,
            ),
            ("Purpose", 72, 640, 14),
            (
                "The purpose of this program is to support community development projects",
                72,
                615,
                11,
            ),
            (
                "across Alaska that demonstrably improve local capacity and services.",
                72,
                600,
                11,
            ),
        ]
    )
    page2 = _text_stream(
        [
            ("Eligibility", 72, 740, 14),
            ("Eligible applicants include the following entities.", 72, 710, 11),
            ("- Federally recognized tribes and tribal consortia.", 90, 680, 11),
            ("- Alaska 501(c)(3) nonprofit organizations in good standing.", 90, 662, 11),
            ("- Local governments within the State of Alaska.", 90, 644, 11),
            ("- Regional Alaska Native corporations.", 90, 626, 11),
        ]
    )
    # Page 3 is a table drawn with line operators so pdfplumber can detect it.
    page3_lines = [
        ("Funding Range", 72, 740, 14),
        ("Tier", 90, 700, 11),
        ("Min", 220, 700, 11),
        ("Max", 340, 700, 11),
        ("Planning", 90, 675, 11),
        ("25000", 220, 675, 11),
        ("75000", 340, 675, 11),
        ("Implementation", 90, 650, 11),
        ("100000", 220, 650, 11),
        ("500000", 340, 650, 11),
    ]
    page3_text = _text_stream(page3_lines)
    # Add table grid lines (4 horizontal, 4 vertical) so detection-based
    # parsers pick it up as a table.
    grid = (
        # Horizontal
        "72 720 m 420 720 l S\n"
        "72 690 m 420 690 l S\n"
        "72 665 m 420 665 l S\n"
        "72 640 m 420 640 l S\n"
        # Vertical
        "72 720 m 72 640 l S\n"
        "200 720 m 200 640 l S\n"
        "320 720 m 320 640 l S\n"
        "420 720 m 420 640 l S\n"
    ).encode("latin-1")
    page3 = grid + page3_text
    page4 = _text_stream(
        [
            ("Application Instructions", 72, 740, 14),
            ("Follow these steps to apply.", 72, 710, 11),
            ("1. Register in the funder portal.", 90, 680, 11),
            ("2. Upload a cover letter and narrative.", 90, 662, 11),
            ("3. Submit the budget workbook.", 90, 644, 11),
            ("4. Confirm submission by the deadline.", 90, 626, 11),
        ]
    )
    return [page1, page2, page3, page4]


def build_pdf_bytes() -> bytes:
    """Return the raw bytes of the synthetic PDF."""
    streams = _pages()
    # Object layout:
    #   1  Catalog
    #   2  Pages
    #   3..6  Page objects
    #   7..10 Content streams
    #   11    Font
    page_ids = [3, 4, 5, 6]
    content_ids = [7, 8, 9, 10]
    font_id = 11

    objs: dict[int, bytes] = {}
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids = " ".join(f"{pid} 0 R" for pid in page_ids).encode("latin-1")
    objs[2] = b"<< /Type /Pages /Kids [" + kids + b"] /Count " + str(len(page_ids)).encode() + b" >>"
    for pid, cid in zip(page_ids, content_ids, strict=True):
        objs[pid] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {cid} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >>"
        ).encode("latin-1")
    for cid, stream in zip(content_ids, streams, strict=True):
        objs[cid] = (
            b"<< /Length "
            + str(len(stream)).encode()
            + b" >>\nstream\n"
            + stream
            + b"\nendstream"
        )
    objs[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: dict[int, int] = {}
    for oid in sorted(objs):
        offsets[oid] = len(pdf)
        pdf += f"{oid} 0 obj\n".encode("latin-1")
        pdf += objs[oid]
        pdf += b"\nendobj\n"

    xref_start = len(pdf)
    n_objs = len(objs) + 1  # +1 for the free object 0
    pdf += b"xref\n"
    pdf += f"0 {n_objs}\n".encode("latin-1")
    pdf += b"0000000000 65535 f \n"
    for oid in sorted(objs):
        pdf += f"{offsets[oid]:010d} 00000 n \n".encode("latin-1")
    pdf += b"trailer\n"
    pdf += f"<< /Size {n_objs} /Root 1 0 R >>\n".encode("latin-1")
    pdf += b"startxref\n"
    pdf += f"{xref_start}\n".encode("latin-1")
    pdf += b"%%EOF\n"
    return bytes(pdf)


def main() -> None:
    out = Path(__file__).parent / "synthetic_nofo.pdf"
    out.write_bytes(build_pdf_bytes())
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
