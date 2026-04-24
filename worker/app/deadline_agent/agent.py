"""
AuroraGrants deadline notification agent.

Standalone async function that queries upcoming, unacknowledged deadlines and
sends email via Resend and SMS via Twilio at the 30d, 14d, 7d, and 48h
thresholds. Uses raw HTTP only (httpx.AsyncClient). No SDK imports.

Log format: JSON to stdout only. No print() statements.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any

import httpx


def _log(action: str, deadline_id: str, reason: str, extra: dict[str, Any] | None = None) -> None:
    record: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "deadline_id": deadline_id,
        "reason": reason,
    }
    if extra:
        record.update(extra)
    sys.stdout.write(json.dumps(record) + "\n")
    sys.stdout.flush()


def _days_until(due_at_str: str) -> float:
    """Return fractional days until due_at (negative means overdue)."""
    due = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    delta = due - now
    return delta.total_seconds() / 86400.0


def _email_subject(report_title: str, days: int) -> str:
    return f"AuroraGrants: {report_title} due {days} days, action required"


def _email_body(
    report_title: str,
    funder_name: str,
    due_date: str,
    days: int,
    ack_url: str,
) -> str:
    return (
        f"Hello,\n\n"
        f"This is a reminder that your report \"{report_title}\" for {funder_name} "
        f"is due in {days} day{'s' if days != 1 else ''}.\n\n"
        f"Due date: {due_date}\n\n"
        f"To acknowledge this reminder and confirm you are aware of the deadline, "
        f"visit the link below. No login is required.\n\n"
        f"{ack_url}\n\n"
        f"You can also view and manage this report by visiting AuroraGrants.\n\n"
        f"AuroraGrants\n"
        f"Free, open-source grant compliance for Alaska nonprofits and tribal organizations.\n"
    )


def _sms_body(report_title: str, funder_name: str, days: int, ack_url: str) -> str:
    return (
        f"AuroraGrants reminder: \"{report_title}\" for {funder_name} "
        f"is due in {days} day{'s' if days != 1 else ''}. "
        f"Acknowledge at {ack_url}"
    )


async def _send_email(
    client: httpx.AsyncClient,
    resend_api_key: str,
    to_email: str,
    subject: str,
    body: str,
    deadline_id: str,
    reason: str,
) -> bool:
    """POST to Resend. Returns True on success."""
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
            _log("email_sent", deadline_id, reason)
            return True
        _log(
            "email_error",
            deadline_id,
            reason,
            {"status": resp.status_code, "body": resp.text[:200]},
        )
        return False
    except Exception as exc:
        _log("email_error", deadline_id, reason, {"exc": str(exc)[:200]})
        return False


async def _send_sms(
    client: httpx.AsyncClient,
    account_sid: str,
    auth_token: str,
    from_number: str,
    to_number: str,
    body: str,
    deadline_id: str,
) -> bool:
    """POST to Twilio Messages. Returns True on success."""
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    try:
        resp = await client.post(
            url,
            auth=(account_sid, auth_token),
            data={"From": from_number, "To": to_number, "Body": body},
            timeout=10.0,
        )
        if resp.status_code in (200, 201):
            _log("sms_sent", deadline_id, "48h_threshold")
            return True
        _log(
            "sms_error",
            deadline_id,
            "48h_threshold",
            {"status": resp.status_code, "body": resp.text[:200]},
        )
        return False
    except Exception as exc:
        _log("sms_error", deadline_id, "48h_threshold", {"exc": str(exc)[:200]})
        return False


async def _fetch_deadlines(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
) -> list[dict[str, Any]]:
    """Fetch unacknowledged, future deadlines joined with tenant and report info."""
    # We use the Supabase REST API directly (raw HTTP, no SDK).
    # Join: deadlines -> tenants (for email, phone), reports (for title, funder)
    # We do two queries: fetch deadlines, then enrich with tenant + report data.
    url = f"{supabase_url.rstrip('/')}/rest/v1/deadlines"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
        "Content-Type": "application/json",
    }
    params = {
        "acknowledged": "eq.false",
        "due_at": f"gt.{datetime.now(timezone.utc).isoformat()}",
        "select": (
            "id,tenant_id,source_type,source_id,due_at,ack_token,"
            "notified_30d,notified_14d,notified_7d,notified_1d,notified_48h_sms"
        ),
    }
    resp = await client.get(url, headers=headers, params=params, timeout=15.0)
    resp.raise_for_status()
    return resp.json()  # type: ignore[return-value]


async def _fetch_tenant(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
    tenant_id: str,
) -> dict[str, Any] | None:
    url = f"{supabase_url.rstrip('/')}/rest/v1/tenants"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
    }
    params = {
        "id": f"eq.{tenant_id}",
        "select": "id,name,primary_email,primary_phone",
        "limit": "1",
    }
    resp = await client.get(url, headers=headers, params=params, timeout=10.0)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None  # type: ignore[index]


async def _fetch_report(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
    report_id: str,
) -> dict[str, Any] | None:
    url = f"{supabase_url.rstrip('/')}/rest/v1/reports"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
    }
    params = {
        "id": f"eq.{report_id}",
        "select": "id,title,funder_id,funders(name)",
        "limit": "1",
    }
    resp = await client.get(url, headers=headers, params=params, timeout=10.0)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None  # type: ignore[index]


async def _patch_deadline(
    client: httpx.AsyncClient,
    supabase_url: str,
    supabase_service_key: str,
    deadline_id: str,
    patch: dict[str, Any],
) -> None:
    url = f"{supabase_url.rstrip('/')}/rest/v1/deadlines"
    headers = {
        "apikey": supabase_service_key,
        "Authorization": f"Bearer {supabase_service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    params = {"id": f"eq.{deadline_id}"}
    resp = await client.patch(url, headers=headers, params=params, json=patch, timeout=10.0)
    resp.raise_for_status()


async def run_deadline_check(
    supabase_url: str,
    supabase_service_key: str,
    resend_api_key: str,
    twilio_account_sid: str,
    twilio_auth_token: str,
    twilio_from_number: str,
    app_base_url: str,
) -> None:
    """
    Main deadline notification loop. Idempotent: safe to run multiple times
    in the same window. Already-notified deadlines are skipped.

    Thresholds:
      30 days  -> email (notified_30d)
      14 days  -> email (notified_14d)
      7 days   -> email (notified_7d)
      2 days   -> email (notified_1d) + SMS (notified_48h_sms) if phone present
    """
    async with httpx.AsyncClient() as client:
        deadlines = await _fetch_deadlines(client, supabase_url, supabase_service_key)

        for dl in deadlines:
            dl_id: str = dl["id"]
            tenant_id: str = dl["tenant_id"]
            source_type: str = dl["source_type"]
            source_id: str = dl["source_id"]
            due_at_str: str = dl["due_at"]
            ack_token: str | None = dl.get("ack_token")

            days_f = _days_until(due_at_str)
            days_int = int(days_f)
            if days_f < 0:
                _log("skipped", dl_id, "overdue")
                continue

            ack_url = f"{app_base_url.rstrip('/')}/api/deadlines/ack/{ack_token}" if ack_token else app_base_url

            # Resolve tenant (for email + phone).
            tenant = await _fetch_tenant(client, supabase_url, supabase_service_key, tenant_id)
            if not tenant:
                _log("skipped", dl_id, "tenant_not_found")
                continue

            to_email: str | None = tenant.get("primary_email")
            if not to_email:
                _log("skipped", dl_id, "no_tenant_email")
                continue

            # Resolve report title + funder name (only for source_type=report).
            report_title = "Compliance Report"
            funder_name = "your funder"
            if source_type == "report":
                report = await _fetch_report(client, supabase_url, supabase_service_key, source_id)
                if report:
                    report_title = report.get("title") or report_title
                    funder_info = report.get("funders")
                    if isinstance(funder_info, dict):
                        funder_name = funder_info.get("name") or funder_name
                    elif isinstance(funder_info, list) and funder_info:
                        funder_name = funder_info[0].get("name") or funder_name

            # Format due date as human-readable string.
            try:
                due_dt = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
                due_date_str = due_dt.strftime("%B %-d, %Y")
            except Exception:
                due_date_str = due_at_str[:10]

            patch: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
            sent_any = False

            # 30-day threshold.
            if days_f <= 30 and not dl.get("notified_30d"):
                subject = _email_subject(report_title, days_int)
                body = _email_body(report_title, funder_name, due_date_str, days_int, ack_url)
                ok = await _send_email(
                    client, resend_api_key, to_email, subject, body, dl_id, "30d_threshold"
                )
                if ok:
                    patch["notified_30d"] = True
                    sent_any = True

            # 14-day threshold.
            if days_f <= 14 and not dl.get("notified_14d"):
                subject = _email_subject(report_title, days_int)
                body = _email_body(report_title, funder_name, due_date_str, days_int, ack_url)
                ok = await _send_email(
                    client, resend_api_key, to_email, subject, body, dl_id, "14d_threshold"
                )
                if ok:
                    patch["notified_14d"] = True
                    sent_any = True

            # 7-day threshold.
            if days_f <= 7 and not dl.get("notified_7d"):
                subject = _email_subject(report_title, days_int)
                body = _email_body(report_title, funder_name, due_date_str, days_int, ack_url)
                ok = await _send_email(
                    client, resend_api_key, to_email, subject, body, dl_id, "7d_threshold"
                )
                if ok:
                    patch["notified_7d"] = True
                    sent_any = True

            # 48-hour (2-day) threshold: email + optional SMS.
            if days_f <= 2:
                if not dl.get("notified_1d"):
                    subject = _email_subject(report_title, days_int)
                    body = _email_body(report_title, funder_name, due_date_str, days_int, ack_url)
                    ok = await _send_email(
                        client, resend_api_key, to_email, subject, body, dl_id, "48h_threshold"
                    )
                    if ok:
                        patch["notified_1d"] = True
                        sent_any = True

                primary_phone: str | None = tenant.get("primary_phone")
                if primary_phone and not dl.get("notified_48h_sms"):
                    sms_text = _sms_body(report_title, funder_name, days_int, ack_url)
                    ok = await _send_sms(
                        client,
                        twilio_account_sid,
                        twilio_auth_token,
                        twilio_from_number,
                        primary_phone,
                        sms_text,
                        dl_id,
                    )
                    if ok:
                        patch["notified_48h_sms"] = True
                        sent_any = True

            if not sent_any:
                _log("skipped", dl_id, "already_notified_or_no_threshold_met")

            # Persist updated notified columns.
            if len(patch) > 1:  # more than just updated_at
                await _patch_deadline(client, supabase_url, supabase_service_key, dl_id, patch)
