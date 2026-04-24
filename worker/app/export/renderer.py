"""Shared rendering logic for all three export formats.

Given a raw `reports` row and its `report_fields`, normalize the data
into a `RenderPayload` that each format renderer consumes. Citation
tokens embedded in the field body (`[1]`, `[2]`, ...) are kept as-is;
the body text is appended with a collated footnote list built from the
per-field `drafts.citations` JSON.

Citation tokens that cannot be resolved (no matching id in the drafts
table) are left as `[n]` in the body and recorded as unresolved so the
renderer can render a placeholder entry in the footnote list.

We never accept a field where `human_approved` is false. Those fields
are filtered out at payload-build time and never appear in any export.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Required wording from CLAUDE.md + build plan task 10. Do not reword
# without a /docs/followups.md entry.
DISCLOSURE_FOOTER: str = (
    "This report contains AI-generated content reviewed and approved by a "
    "human signer. AuroraGrants is open source, Apache-2.0."
)

# Citation token marker, for example `[1]` or `[12]`. The Writer and Editor
# both emit tokens in this shape; see /docs/07-prompts.md#writer.
_CITATION_TOKEN_RE = re.compile(r"\[(\d+)\]")


class ExportError(ValueError):
    """Raised when a payload cannot be rendered.

    Callers surface this as a 4xx to the client rather than a 500.
    """


@dataclass(frozen=True)
class ExportRequest:
    """Input contract for the /export/report route handler."""

    report_id: str
    format: str  # "pdf" | "docx" | "text"


@dataclass(frozen=True)
class ExportResult:
    """Return envelope for the renderers.

    `content` is the raw bytes to stream to the client. `content_type`
    is the MIME string. `filename` is the recommended filename for
    `Content-Disposition`.
    """

    content: bytes
    content_type: str
    filename: str


@dataclass(frozen=True)
class Citation:
    """One footnote citation derived from `drafts.citations`.

    `id` is the token number the body references (`[1]`). `page` is the
    source document page. `excerpt` is the quoted text. `source` is a
    human-readable source label (document title) when available.
    """

    id: int
    page: int | None
    excerpt: str
    source: str | None = None


@dataclass(frozen=True)
class ExportSection:
    """One approved field rendered as a labeled section."""

    label: str
    key: str
    body: str
    citations: tuple[Citation, ...] = ()


@dataclass(frozen=True)
class RenderPayload:
    """Normalized view of a report ready for rendering.

    `tenant_name` may be None when the tenant row lacks a display name.
    `approval_date` is ISO-8601 (YYYY-MM-DD), derived from the most
    recent `approved_at` across approved fields.
    """

    report_id: str
    report_title: str
    funder_name: str
    tenant_name: str | None
    approval_date: str | None
    sections: tuple[ExportSection, ...]
    disclosure_footer: str = DISCLOSURE_FOOTER
    citation_sources: tuple[Citation, ...] = field(default_factory=tuple)


def _coerce_citations(raw: Any) -> list[Citation]:
    """Parse the `drafts.citations` JSON into a list of `Citation`.

    Accepts the `[{id, page, excerpt, source?}, ...]` shape produced by
    the Writer / Editor. Tolerates string ids and coerces them to int.
    Drops entries that do not resolve to a valid id.
    """
    if not isinstance(raw, list):
        return []
    out: list[Citation] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        raw_id = entry.get("id")
        if isinstance(raw_id, int):
            cid = raw_id
        elif isinstance(raw_id, str):
            try:
                cid = int(raw_id.strip())
            except ValueError:
                continue
        else:
            continue
        page_val = entry.get("page")
        if isinstance(page_val, int):
            page: int | None = page_val
        elif isinstance(page_val, str):
            try:
                page = int(page_val)
            except ValueError:
                page = None
        else:
            page = None
        excerpt = entry.get("excerpt") or entry.get("quote") or ""
        if not isinstance(excerpt, str):
            excerpt = str(excerpt)
        source = entry.get("source") or entry.get("document_title")
        if source is not None and not isinstance(source, str):
            source = str(source)
        out.append(Citation(id=cid, page=page, excerpt=excerpt, source=source))
    return out


def _body_text_from_field(field_row: dict[str, Any]) -> str:
    """Pick the human-visible body for an approved field.

    `current_value` is the promoted, human-visible text. Fall back to
    `draft_value` only if a field was approved with `current_value`
    still NULL (legacy safety net). Empty → empty string.
    """
    value = field_row.get("current_value")
    if isinstance(value, str) and value.strip():
        return value
    draft = field_row.get("draft_value")
    if isinstance(draft, str) and draft.strip():
        return draft
    return ""


def _sort_citations(citations: list[Citation]) -> list[Citation]:
    """Deduplicate by id and return a stable, ascending-by-id list."""
    seen: dict[int, Citation] = {}
    for c in citations:
        if c.id not in seen:
            seen[c.id] = c
    return [seen[k] for k in sorted(seen.keys())]


def _latest_approval_date(fields: list[dict[str, Any]]) -> str | None:
    """Return the most recent `approved_at` in YYYY-MM-DD form, or None."""
    dates: list[str] = []
    for f in fields:
        ts = f.get("approved_at")
        if isinstance(ts, str) and ts:
            dates.append(ts)
    if not dates:
        return None
    # Pick lexicographically max; ISO-8601 strings sort correctly.
    latest = max(dates)
    # Trim to date.
    return latest[:10]


def build_payload(
    report: dict[str, Any],
    fields: list[dict[str, Any]],
    drafts_by_field: dict[str, dict[str, Any]] | None = None,
    funder_name: str = "Unknown funder",
    tenant_name: str | None = None,
) -> RenderPayload:
    """Build a `RenderPayload` from raw Supabase rows.

    `report` is the `reports` row. `fields` is the list of
    `report_fields`; only those with `human_approved == True` are
    included. `drafts_by_field` is a map from `report_field_id` to the
    most recent `drafts` row, used to source the citation list.
    """
    drafts_by_field = drafts_by_field or {}
    approved_fields = [f for f in fields if f.get("human_approved") is True]

    # Stable order: required first, then by label. Matches the UI.
    approved_fields.sort(
        key=lambda f: (
            0 if f.get("required") else 1,
            str(f.get("label") or "").lower(),
        )
    )

    sections: list[ExportSection] = []
    all_citations: list[Citation] = []
    for f in approved_fields:
        body = _body_text_from_field(f)
        draft = drafts_by_field.get(str(f.get("id")))
        field_citations: list[Citation] = []
        if draft is not None:
            field_citations = _coerce_citations(draft.get("citations"))
        field_citations = _sort_citations(field_citations)
        # Filter citations to those actually referenced in the body.
        referenced_ids = {int(m.group(1)) for m in _CITATION_TOKEN_RE.finditer(body)}
        kept = [c for c in field_citations if c.id in referenced_ids] if referenced_ids else []

        sections.append(
            ExportSection(
                label=str(f.get("label") or f.get("key") or "Untitled"),
                key=str(f.get("key") or ""),
                body=body,
                citations=tuple(kept),
            )
        )
        all_citations.extend(kept)

    return RenderPayload(
        report_id=str(report.get("id") or ""),
        report_title=str(report.get("title") or "Report"),
        funder_name=funder_name or "Unknown funder",
        tenant_name=tenant_name,
        approval_date=_latest_approval_date(approved_fields),
        sections=tuple(sections),
        citation_sources=tuple(_sort_citations(all_citations)),
    )


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _slugify(value: str, fallback: str = "report") -> str:
    """Produce a filesystem-safe slug for `Content-Disposition` filenames."""
    if not value:
        return fallback
    slug = _FILENAME_SAFE_RE.sub("-", value.strip()).strip("-")
    return slug or fallback


def build_filename(payload: RenderPayload, extension: str) -> str:
    """Build `<funder>-<report-title>-<date>.<ext>` from a payload."""
    funder_slug = _slugify(payload.funder_name, fallback="funder")
    title_slug = _slugify(payload.report_title, fallback="report")
    date_part = payload.approval_date or ""
    date_slug = _slugify(date_part, fallback="undated")
    return f"{funder_slug}-{title_slug}-{date_slug}.{extension}"
