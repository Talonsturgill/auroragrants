"""
Parser bake-off orchestrator.

Runs Marker, pdfplumber, and Unstructured against the golden set of
Alaska NOFOs plus the synthetic fixture and writes a scorecard to
`worker/parser_scorecard.md`.

The parser libraries are heavy (marker-pdf pulls in torch, unstructured
pulls in a lot of OCR machinery). We import each one lazily inside the
adapter and log a warning if it fails. The bake-off still runs with
whatever subset is installed.

The scoring functions live in `metrics.py` so they can be unit tested
without the parser libraries.

Exit code is always 0. This is a benchmark, not a gate. The CI gate is
documented in `/docs/06-eval-harness.md`.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import yaml  # type: ignore[import-untyped]

# Allow running this module as a script or as `worker.scripts.parser_bakeoff`.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from metrics import (  # noqa: E402  (sys.path setup must run first)
    F1Score,
    HeadingAccuracy,
    HeadingDescriptor,
    TableDescriptor,
    heading_accuracy,
    table_f1,
    token_efficiency,
)

logger = logging.getLogger("parser_bakeoff")

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_ROOT = REPO_ROOT / "worker"
GOLDEN_SET_ROOT = WORKER_ROOT / "golden_set"
DEFAULT_PDFS_DIR = GOLDEN_SET_ROOT / "pdfs"
SYNTHETIC_FIXTURE = GOLDEN_SET_ROOT / "fixtures" / "synthetic_nofo.pdf"
SYNTHETIC_GROUND_TRUTH = GOLDEN_SET_ROOT / "fixtures" / "synthetic_nofo.ground_truth.yaml"
MAIN_GROUND_TRUTH = GOLDEN_SET_ROOT / "ground_truth.yaml"
SCORECARD_PATH = WORKER_ROOT / "parser_scorecard.md"

PARSER_NAMES = ("marker", "pdfplumber", "unstructured")


@dataclass
class ParserOutput:
    """Normalized parser output used by the scoring code."""

    markdown: str
    headings: list[HeadingDescriptor]
    tables: list[TableDescriptor]
    page_count: int


@dataclass
class ParseResult:
    """Per-PDF, per-parser scoring result."""

    parser: str
    slug: str
    ok: bool
    seconds: float
    pages: int
    table_score: F1Score | None
    heading_score: HeadingAccuracy | None
    token_ratio: float
    markdown_chars: int
    error: str | None = None


@dataclass
class ParserTotals:
    """Aggregated numbers per parser, suitable for the scorecard row."""

    parser: str
    n_pdfs_parsed: int = 0
    n_pdfs_failed: int = 0
    table_f1_sum: float = 0.0
    table_f1_count: int = 0
    heading_acc_sum: float = 0.0
    heading_acc_count: int = 0
    token_ratio_sum: float = 0.0
    token_ratio_count: int = 0
    seconds_total: float = 0.0
    pages_total: int = 0
    errors: list[str] = field(default_factory=list)

    def mean_table_f1(self) -> float:
        return self.table_f1_sum / self.table_f1_count if self.table_f1_count else 0.0

    def mean_heading_accuracy(self) -> float:
        return self.heading_acc_sum / self.heading_acc_count if self.heading_acc_count else 0.0

    def mean_token_ratio(self) -> float:
        return self.token_ratio_sum / self.token_ratio_count if self.token_ratio_count else 0.0

    def seconds_per_page(self) -> float:
        return self.seconds_total / self.pages_total if self.pages_total else 0.0


# --- parser adapters -------------------------------------------------------


def _parse_with_pdfplumber(pdf_path: Path) -> ParserOutput:
    import pdfplumber

    markdown_parts: list[str] = []
    tables: list[TableDescriptor] = []
    headings: list[HeadingDescriptor] = []

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            markdown_parts.append(text)
            # Naive heading heuristic: a short, title-cased line.
            for line in text.splitlines():
                stripped = line.strip()
                if 0 < len(stripped) <= 80 and stripped == stripped.title():
                    headings.append(HeadingDescriptor(text=stripped, level=1))
            for t in page.extract_tables() or []:
                if not t:
                    continue
                n_rows = len(t)
                n_cols = max((len(r) for r in t), default=0)
                tables.append(
                    TableDescriptor(
                        page=i,
                        n_rows=n_rows,
                        n_cols=n_cols,
                        has_header=True,
                        topic="",
                    )
                )

    return ParserOutput(
        markdown="\n".join(markdown_parts),
        headings=headings,
        tables=tables,
        page_count=page_count,
    )


def _parse_with_marker(pdf_path: Path) -> ParserOutput:
    from marker.convert import convert_single_pdf
    from marker.models import load_all_models

    # Marker's API is: load models once, then convert per-PDF. In this
    # bake-off we accept the cold-load cost on each call since we run a
    # small number of PDFs.
    models = load_all_models()
    full_text, _images, metadata = convert_single_pdf(str(pdf_path), models)

    page_count = int(metadata.get("page_count", 0) or 0)
    headings = _extract_markdown_headings(full_text)
    tables = _extract_markdown_tables(full_text)
    return ParserOutput(
        markdown=full_text,
        headings=headings,
        tables=tables,
        page_count=page_count,
    )


def _parse_with_unstructured(pdf_path: Path) -> ParserOutput:
    from unstructured.partition.pdf import partition_pdf

    elements = partition_pdf(filename=str(pdf_path))
    markdown_parts: list[str] = []
    headings: list[HeadingDescriptor] = []
    tables: list[TableDescriptor] = []
    page_count = 0

    for el in elements:
        category = getattr(el, "category", "") or el.__class__.__name__
        text = getattr(el, "text", "") or ""
        metadata = getattr(el, "metadata", None)
        page_number = getattr(metadata, "page_number", None) if metadata else None
        if isinstance(page_number, int):
            page_count = max(page_count, page_number)

        if category in {"Title", "Heading"}:
            headings.append(HeadingDescriptor(text=text.strip(), level=1))
        elif category == "Table":
            tables.append(
                TableDescriptor(
                    page=int(page_number or 0),
                    n_rows=text.count("\n") + 1 if text else 0,
                    n_cols=0,
                    has_header=True,
                    topic="",
                )
            )
        markdown_parts.append(text)

    return ParserOutput(
        markdown="\n".join(markdown_parts),
        headings=headings,
        tables=tables,
        page_count=page_count,
    )


PARSER_ADAPTERS = {
    "pdfplumber": _parse_with_pdfplumber,
    "marker": _parse_with_marker,
    "unstructured": _parse_with_unstructured,
}


def _extract_markdown_headings(markdown: str) -> list[HeadingDescriptor]:
    """Parse ATX-style headings (`#`, `##`, ...) out of a markdown blob."""
    headings: list[HeadingDescriptor] = []
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line.startswith("#"):
            continue
        level = 0
        for ch in line:
            if ch == "#" and level < 6:
                level += 1
            else:
                break
        text = line[level:].strip()
        if text:
            headings.append(HeadingDescriptor(text=text, level=level))
    return headings


def _extract_markdown_tables(markdown: str) -> list[TableDescriptor]:
    """
    Count markdown pipe-tables. We cannot know the original page number
    from plain markdown so we tag each detected table with `page=-1`. The
    scorer treats `-1` as a wildcard-fail, which is intentional; callers
    that want proper page mapping should use a parser that exposes it.
    """
    tables: list[TableDescriptor] = []
    lines = markdown.splitlines()
    in_table = False
    n_rows = 0
    n_cols = 0
    for line in lines:
        stripped = line.strip()
        is_pipe_row = stripped.startswith("|") and stripped.endswith("|")
        if is_pipe_row:
            if not in_table:
                in_table = True
                n_rows = 0
                n_cols = 0
            n_rows += 1
            n_cols = max(n_cols, stripped.count("|") - 1)
        else:
            if in_table and n_rows > 1:
                tables.append(
                    TableDescriptor(
                        page=-1,
                        n_rows=n_rows,
                        n_cols=n_cols,
                        has_header=True,
                        topic="",
                    )
                )
            in_table = False
            n_rows = 0
            n_cols = 0
    if in_table and n_rows > 1:
        tables.append(
            TableDescriptor(page=-1, n_rows=n_rows, n_cols=n_cols, has_header=True, topic="")
        )
    return tables


# --- ground-truth loading --------------------------------------------------


@dataclass
class GroundTruth:
    slug: str
    expected_headings: list[HeadingDescriptor]
    expected_tables: list[TableDescriptor]
    expected_fields: dict[str, Any]
    source_url: str | None
    notes: str


def _entry_to_ground_truth(entry: dict[str, Any]) -> GroundTruth:
    headings_raw = entry.get("expected_headings", []) or []
    headings: list[HeadingDescriptor] = [
        HeadingDescriptor(text=str(h), level=1) for h in headings_raw
    ]
    tables_raw = entry.get("expected_tables", []) or []
    tables: list[TableDescriptor] = []
    for t in tables_raw:
        tables.append(
            TableDescriptor(
                page=int(t.get("page", -1)),
                n_rows=int(t.get("n_rows", 0)),
                n_cols=int(t.get("n_cols", 0)),
                has_header=bool(t.get("has_header", False)),
                topic=str(t.get("topic", "")),
            )
        )
    return GroundTruth(
        slug=str(entry["slug"]),
        expected_headings=headings,
        expected_tables=tables,
        expected_fields=cast(dict[str, Any], entry.get("expected_fields", {}) or {}),
        source_url=cast(str | None, entry.get("source_url")),
        notes=str(entry.get("notes", "")),
    )


def load_ground_truth() -> dict[str, GroundTruth]:
    """Load labels from both the main YAML and the synthetic fixture YAML."""
    truth: dict[str, GroundTruth] = {}
    if MAIN_GROUND_TRUTH.exists():
        with MAIN_GROUND_TRUTH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        for entry in data.get("pdfs", []) or []:
            gt = _entry_to_ground_truth(entry)
            truth[gt.slug] = gt
    if SYNTHETIC_GROUND_TRUTH.exists():
        with SYNTHETIC_GROUND_TRUTH.open("r", encoding="utf-8") as fh:
            entry = yaml.safe_load(fh) or {}
        gt = _entry_to_ground_truth(entry)
        truth[gt.slug] = gt
    return truth


def discover_pdfs(pdfs_dir: Path) -> list[Path]:
    """Return the real PDFs plus the synthetic fixture, sorted by slug."""
    pdfs: list[Path] = []
    if pdfs_dir.exists():
        pdfs.extend(sorted(p for p in pdfs_dir.glob("*.pdf") if p.is_file()))
    if SYNTHETIC_FIXTURE.exists():
        pdfs.append(SYNTHETIC_FIXTURE)
    return pdfs


# --- scoring ---------------------------------------------------------------


def _score_one(
    parser: str,
    pdf: Path,
    truth: GroundTruth | None,
) -> ParseResult:
    adapter = PARSER_ADAPTERS[parser]
    slug = pdf.stem
    t0 = time.perf_counter()
    try:
        out = adapter(pdf)
    except Exception as exc:  # pragma: no cover - exercised only with real parsers
        elapsed = time.perf_counter() - t0
        logger.warning("%s failed on %s: %s", parser, slug, exc)
        return ParseResult(
            parser=parser,
            slug=slug,
            ok=False,
            seconds=elapsed,
            pages=0,
            table_score=None,
            heading_score=None,
            token_ratio=0.0,
            markdown_chars=0,
            error=str(exc),
        )
    elapsed = time.perf_counter() - t0

    if truth is None:
        # No ground truth for this PDF. Still record the parse succeeded
        # so the mean time metric reflects it.
        return ParseResult(
            parser=parser,
            slug=slug,
            ok=True,
            seconds=elapsed,
            pages=out.page_count,
            table_score=None,
            heading_score=None,
            token_ratio=0.0,
            markdown_chars=len(out.markdown),
        )

    table_score = table_f1(out.tables, truth.expected_tables)
    heading_score = heading_accuracy(out.headings, truth.expected_headings)
    # Expected length: rough estimate based on the number of headings and
    # tables in the ground truth, so we do not need to hand-label byte
    # counts for every NOFO.
    expected_len = max(
        500,
        sum(len(h.get("text", "")) for h in truth.expected_headings) * 20
        + len(truth.expected_tables) * 200,
    )
    ratio = token_efficiency(out.markdown, expected_len)
    return ParseResult(
        parser=parser,
        slug=slug,
        ok=True,
        seconds=elapsed,
        pages=out.page_count,
        table_score=table_score,
        heading_score=heading_score,
        token_ratio=ratio,
        markdown_chars=len(out.markdown),
    )


def _available_parsers(requested: list[str]) -> list[str]:
    """Filter `requested` down to the parsers that actually import."""
    available: list[str] = []
    for name in requested:
        try:
            if name == "pdfplumber":
                __import__("pdfplumber")
            elif name == "marker":
                __import__("marker")
            elif name == "unstructured":
                __import__("unstructured.partition.pdf")
            available.append(name)
        except ImportError as exc:
            logger.warning("skipping %s: %s", name, exc)
    return available


def run_bakeoff(
    pdfs_dir: Path = DEFAULT_PDFS_DIR,
    only: str | None = None,
    dry_run: bool = False,
) -> tuple[list[ParseResult], list[ParserTotals]]:
    """Run the bake-off and return (per-pdf results, per-parser totals)."""
    truth = load_ground_truth()
    pdfs = discover_pdfs(pdfs_dir)
    logger.info("found %d PDFs", len(pdfs))

    requested = [only] if only else list(PARSER_NAMES)
    parsers = [] if dry_run else _available_parsers(requested)
    if dry_run:
        logger.info("dry-run: skipping parser execution")

    results: list[ParseResult] = []
    totals: dict[str, ParserTotals] = {name: ParserTotals(parser=name) for name in requested}

    for pdf in pdfs:
        slug = pdf.stem
        gt = truth.get(slug)
        if gt is None:
            logger.warning("no ground truth for %s", slug)
        for parser in parsers:
            result = _score_one(parser, pdf, gt)
            results.append(result)
            t = totals[parser]
            if result.ok:
                t.n_pdfs_parsed += 1
                t.seconds_total += result.seconds
                t.pages_total += result.pages
                if result.table_score is not None:
                    t.table_f1_sum += result.table_score.f1
                    t.table_f1_count += 1
                if result.heading_score is not None:
                    t.heading_acc_sum += result.heading_score.exact
                    t.heading_acc_count += 1
                if result.markdown_chars > 0:
                    t.token_ratio_sum += result.token_ratio
                    t.token_ratio_count += 1
            else:
                t.n_pdfs_failed += 1
                if result.error:
                    t.errors.append(f"{result.slug}: {result.error}")

    return results, list(totals.values())


# --- reporting -------------------------------------------------------------


def format_scorecard(
    results: list[ParseResult],
    totals: list[ParserTotals],
    *,
    pdfs_scanned: int,
    dry_run: bool,
    ground_truth_version: int,
) -> str:
    header = "# Parser bake-off scorecard\n\n"
    header += f"- Ground-truth version: {ground_truth_version}\n"
    header += f"- PDFs scanned: {pdfs_scanned}\n"
    header += f"- Mode: {'dry-run' if dry_run else 'full'}\n\n"

    header += "## Summary\n\n"
    header += (
        "| parser | n_pdfs_parsed | table_f1 | heading_accuracy | "
        "mean_token_ratio | seconds_per_page |\n"
    )
    header += "|---|---|---|---|---|---|\n"
    for t in totals:
        header += (
            f"| {t.parser} | {t.n_pdfs_parsed} | {t.mean_table_f1():.3f} | "
            f"{t.mean_heading_accuracy():.3f} | {t.mean_token_ratio():.3f} | "
            f"{t.seconds_per_page():.3f} |\n"
        )

    header += "\n## Per-PDF results\n\n"
    if not results:
        header += "_No parser was able to run. Install at least one of "
        header += "marker-pdf, pdfplumber, or unstructured[pdf]._\n"
        return header
    header += "| parser | slug | ok | pages | table_f1 | heading_exact | token_ratio | seconds |\n"
    header += "|---|---|---|---|---|---|---|---|\n"
    for r in results:
        tf = f"{r.table_score.f1:.3f}" if r.table_score else "n/a"
        ha = f"{r.heading_score.exact:.3f}" if r.heading_score else "n/a"
        header += (
            f"| {r.parser} | {r.slug} | {'yes' if r.ok else 'no'} | {r.pages} | "
            f"{tf} | {ha} | {r.token_ratio:.3f} | {r.seconds:.2f} |\n"
        )

    errors = [(t.parser, err) for t in totals for err in t.errors]
    if errors:
        header += "\n## Errors\n\n"
        for parser, err in errors:
            header += f"- **{parser}** {err}\n"
    return header


def write_scorecard(
    path: Path,
    results: list[ParseResult],
    totals: list[ParserTotals],
    *,
    pdfs_scanned: int,
    dry_run: bool,
    ground_truth_version: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        format_scorecard(
            results,
            totals,
            pdfs_scanned=pdfs_scanned,
            dry_run=dry_run,
            ground_truth_version=ground_truth_version,
        ),
        encoding="utf-8",
    )


def _load_ground_truth_version() -> int:
    if not MAIN_GROUND_TRUTH.exists():
        return 0
    with MAIN_GROUND_TRUTH.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return int(data.get("version", 0))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the PDF parser bake-off.")
    parser.add_argument(
        "--pdfs-dir",
        type=Path,
        default=DEFAULT_PDFS_DIR,
        help="Directory with real NOFO PDFs. Defaults to worker/golden_set/pdfs.",
    )
    parser.add_argument(
        "--only",
        choices=PARSER_NAMES,
        default=None,
        help="Run a single parser instead of all three.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip parser execution. Still writes the scorecard header.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Python log level.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    pdfs = discover_pdfs(args.pdfs_dir)
    if not pdfs:
        logger.warning("0 PDFs found in %s", args.pdfs_dir)

    results, totals = run_bakeoff(
        pdfs_dir=args.pdfs_dir,
        only=args.only,
        dry_run=args.dry_run,
    )

    write_scorecard(
        SCORECARD_PATH,
        results,
        totals,
        pdfs_scanned=len(pdfs),
        dry_run=args.dry_run,
        ground_truth_version=_load_ground_truth_version(),
    )
    logger.info("wrote %s", SCORECARD_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
