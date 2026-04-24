"""Export route.

POST /export/report — render a fully-approved report to PDF, DOCX, or
plain text and stream the bytes back.

Flow:
  1. Decode JWT tenant via middleware (already on `request.state`).
  2. Fetch the `reports` row. 404 if missing.
  3. Verify tenant ownership. 403 on mismatch.
  4. Require `reports.status == 'ready_for_export'`. 409 otherwise.
  5. Fetch all `report_fields` for the report; we render only the
     `human_approved == True` rows.
  6. Fetch the latest `drafts` row per approved field for citations.
  7. Optionally fetch the tenant display name and the funder name for
     the cover page.
  8. Render via the requested format and return a streaming response
     with the right Content-Type and Content-Disposition.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.export import (
    ExportResult,
    build_payload,
    render_docx,
    render_pdf,
    render_text,
)

log = logging.getLogger(__name__)
router = APIRouter()


# MIME types we accept from the client, mirrored in renderer helpers.
_VALID_FORMATS = {"pdf", "docx", "text"}


class ExportReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_id: str = Field(min_length=1)
    format: str = Field(min_length=1)


def _supabase(request: Request) -> Any:
    sb = getattr(request.app.state, "supabase", None)
    if sb is None:
        raise HTTPException(status_code=503, detail="supabase_not_configured")
    return sb


def _fetch_report(sb: Any, report_id: str) -> dict[str, Any] | None:
    res = (
        sb.table("reports")
        .select("id, tenant_id, title, status, award_id")
        .eq("id", report_id)
        .execute()
    )
    rows: list[dict[str, Any]] = list(res.data or [])
    return rows[0] if rows else None


def _fetch_fields(sb: Any, report_id: str) -> list[dict[str, Any]]:
    res = (
        sb.table("report_fields")
        .select(
            "id, report_id, key, label, field_type, required, "
            "current_value, draft_value, human_approved, approved_at"
        )
        .eq("report_id", report_id)
        .execute()
    )
    return list(res.data or [])


def _fetch_drafts(sb: Any, field_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Return a map from report_field_id to its latest drafts row."""
    if not field_ids:
        return {}
    res = (
        sb.table("drafts")
        .select("id, report_field_id, version, content, citations")
        .in_("report_field_id", field_ids)
        .execute()
    )
    rows: list[dict[str, Any]] = list(res.data or [])
    latest: dict[str, dict[str, Any]] = {}
    for r in rows:
        fid = str(r.get("report_field_id") or "")
        if not fid:
            continue
        prev = latest.get(fid)
        if prev is None or int(r.get("version") or 0) > int(prev.get("version") or 0):
            latest[fid] = r
    return latest


def _fetch_funder_name(sb: Any, award_id: str | None) -> str:
    if not award_id:
        return "Unknown funder"
    try:
        award_res = sb.table("awards").select("id, funder_id").eq("id", award_id).execute()
        award_rows: list[dict[str, Any]] = list(award_res.data or [])
        if not award_rows:
            return "Unknown funder"
        funder_id = award_rows[0].get("funder_id")
        if not funder_id:
            return "Unknown funder"
        funder_res = sb.table("funders").select("id, name").eq("id", funder_id).execute()
        funder_rows: list[dict[str, Any]] = list(funder_res.data or [])
        if funder_rows:
            name = funder_rows[0].get("name")
            if isinstance(name, str) and name:
                return name
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("export.funder_lookup_failed", extra={"error_type": type(exc).__name__})
    return "Unknown funder"


def _fetch_tenant_name(sb: Any, tenant_id: str) -> str | None:
    try:
        res = sb.table("tenants").select("id, name").eq("id", tenant_id).execute()
        rows: list[dict[str, Any]] = list(res.data or [])
        if rows:
            name = rows[0].get("name")
            if isinstance(name, str) and name:
                return name
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("export.tenant_lookup_failed", extra={"error_type": type(exc).__name__})
    return None


def _dispatch_render(fmt: str, payload: Any) -> ExportResult:
    if fmt == "pdf":
        try:
            return render_pdf(payload)
        except RuntimeError as exc:
            # WeasyPrint not installed on this host.
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    if fmt == "docx":
        return render_docx(payload)
    # fmt == "text" guaranteed by prior validation.
    return render_text(payload)


@router.post("/report")
async def export_report(
    req: ExportReportRequest,
    request: Request,
) -> Response:
    mw_tenant_id: str | None = getattr(request.state, "tenant_id", None)
    if not mw_tenant_id:
        raise HTTPException(status_code=401, detail="missing_tenant")

    fmt = req.format.lower()
    if fmt not in _VALID_FORMATS:
        raise HTTPException(status_code=400, detail="invalid_format")

    sb = _supabase(request)

    report = _fetch_report(sb, req.report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report_not_found")

    if report.get("tenant_id") != mw_tenant_id:
        raise HTTPException(status_code=403, detail="tenant_mismatch")

    if report.get("status") != "ready_for_export":
        raise HTTPException(status_code=409, detail="report_not_ready")

    fields = _fetch_fields(sb, req.report_id)
    approved_ids = [str(f.get("id")) for f in fields if f.get("human_approved") is True]
    drafts = _fetch_drafts(sb, approved_ids)

    funder_name = _fetch_funder_name(sb, report.get("award_id"))
    tenant_name = _fetch_tenant_name(sb, mw_tenant_id)

    payload = build_payload(
        report=report,
        fields=fields,
        drafts_by_field=drafts,
        funder_name=funder_name,
        tenant_name=tenant_name,
    )

    result = _dispatch_render(fmt, payload)

    log.info(
        "export.report.complete",
        extra={
            "report_id": req.report_id,
            "format": fmt,
            "bytes": len(result.content),
            "sections": len(payload.sections),
        },
    )

    return Response(
        content=result.content,
        media_type=result.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{result.filename}"',
            "X-Export-Format": fmt,
        },
    )
