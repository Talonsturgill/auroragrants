"""
AuroraGrants Weekly Deadline Radar.

For each tenant with deadline_radar_enabled=true, fetches the next 10
upcoming unacknowledged deadlines and sends a single digest email via Resend.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any

import httpx


def _log(action: str, tenant_id: str, reason: str, extra: dict[str, Any] | None = None) -> None:
    record: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "tenant_id": tenant_id,
        "reason": reason,
    }
    if extra:
        record.update(extra)
    sys.stdout.write(json.dumps(record) + "\n")
    sys.stdout.flush()


def _days_until(due_at_str: str) -> int:
    due = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    delta = due - now
    return max(0, int(delta.total_seconds() / 86400))


def _format_due(due_at_str: str) -> str:
    try:
        dt = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
        return dt.strftime("%B %-d, %Y")
    except Exception:
        return due_at_str[:10]


async def _fetch_radar_tenants(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
) -> list[dict[str, Any]]:
    url = f"{supabase_url.rstrip('/')}/rest/v1/tenants"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
    }
    params = {
        "deadline_radar_enabled": "eq.true",
        "status": "eq.active",
        "select": "id,name,primary_email",
    }
    resp = await client.get(url, headers=headers, params=params, timeout=15.0)
    resp.raise_for_status()
    return resp.json()  # type: ignore[return-value]


async def _fetch_tenant_deadlines(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
    tenant_id: str,
) -> list[dict[str, Any]]:
    url = f"{supabase_url.rstrip('/')}/rest/v1/deadlines"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    params = {
        "tenant_id": f"eq.{tenant_id}",
        "acknowledged": "eq.false",
        "due_at": f"gt.{now_iso}",
        "order": "due_at.asc",
        "limit": "10",
        "select": "id,source_id,source_type,due_at",
    }
    resp = await client.get(url, headers=headers, params=params, timeout=10.0)
    resp.raise_for_status()
    return resp.json()  # type: ignore[return-value]


async def _fetch_report_title(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
    report_id: str,
) -> str:
    url = f"{supabase_url.rstrip('/')}/rest/v1/reports"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
    }
    params = {"id": f"eq.{report_id}", "select": "title", "limit": "1"}
    resp = await client.get(url, headers=headers, params=params, timeout=10.0)
    resp.raise_for_status()
    rows = resp.json()
    if rows:
        return rows[0].get("title") or "Compliance Report"
    return "Compliance Report"


async def _send_radar_email(
    client: httpx.AsyncClient,
    resend_api_key: str,
    to_email: str,
    tenant_name: str,
    tenant_id: str,
    deadlines: list[dict[str, Any]],
    supabase_url: str,
    supabase_service_key: str,
    app_base_url: str,
) -> None:
    n = len(deadlines)
    subject = f"AuroraGrants Weekly Radar, {n} deadline{'s' if n != 1 else ''} coming up"

    lines = [
        f"Hello {tenant_name},",
        "",
        f"Here are your next {n} upcoming grant report deadline{'s' if n != 1 else ''}.",
        "",
    ]
    for dl in deadlines:
        days = _days_until(dl["due_at"])
        due_str = _format_due(dl["due_at"])
        # Resolve title if this is a report deadline.
        title = "Compliance Report"
        if dl.get("source_type") == "report" and dl.get("source_id"):
            title = await _fetch_report_title(
                client, supabase_url, supabase_service_key, dl["source_id"]
            )
        lines.append(f"  {title}  |  Due {due_str}  ({days} day{'s' if days != 1 else ''} away)")

    lines += [
        "",
        f"View all deadlines at {app_base_url.rstrip('/')}/app/deadlines",
        "",
        "AuroraGrants",
        "Free, open-source grant compliance for Alaska nonprofits and tribal organizations.",
        "To opt out of this weekly email, ask your administrator to update your settings.",
    ]

    body = "\n".join(lines)
    payload = {
        "from": "AuroraGrants <no-reply@auroragrants.app>",
        "to": [to_email],
        "subject": subject,
        "text": body,
    }
    try:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {resend_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10.0,
        )
        if resp.status_code in (200, 201):
            _log("radar_email_sent", tenant_id, "ok", {"n_deadlines": n})
        else:
            _log(
                "radar_email_error",
                tenant_id,
                "resend_error",
                {"status": resp.status_code, "body": resp.text[:200]},
            )
    except Exception as exc:
        _log("radar_email_error", tenant_id, str(exc)[:200])


async def run_radar(
    supabase_url: str,
    supabase_service_key: str,
    resend_api_key: str,
    app_base_url: str,
) -> None:
    """
    Send weekly deadline digest to each opted-in tenant.

    Tenants with 0 upcoming deadlines are skipped.
    Tenants with deadline_radar_enabled=false are excluded by the query.
    Tenants with no primary_email are skipped with a log entry.
    """
    async with httpx.AsyncClient() as client:
        tenants = await _fetch_radar_tenants(client, supabase_url, supabase_service_key)

        for tenant in tenants:
            tid: str = tenant["id"]
            tname: str = tenant.get("name") or "your organization"
            to_email: str | None = tenant.get("primary_email")

            if not to_email:
                _log("skipped", tid, "no_primary_email")
                continue

            deadlines = await _fetch_tenant_deadlines(
                client, supabase_url, supabase_service_key, tid
            )

            if not deadlines:
                _log("skipped", tid, "no_upcoming_deadlines")
                continue

            await _send_radar_email(
                client,
                resend_api_key,
                to_email,
                tname,
                tid,
                deadlines,
                supabase_url,
                supabase_service_key,
                app_base_url,
            )
