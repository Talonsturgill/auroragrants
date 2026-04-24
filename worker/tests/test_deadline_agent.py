"""
Tests for worker/app/deadline_agent/agent.py

All network calls are mocked via respx. Supabase REST calls and notification
provider calls are intercepted so no real network is required.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_URL = "https://sb.test"
SERVICE_KEY = "service-key"
RESEND_KEY = "resend-key"
TWILIO_SID = "ACtest"
TWILIO_TOKEN = "twilio-token"
TWILIO_FROM = "+15550000"
APP_URL = "https://app.test"

TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
DEADLINE_ID = "bbbbbbbb-0000-0000-0000-000000000001"
REPORT_ID = "cccccccc-0000-0000-0000-000000000001"
ACK_TOKEN = "dddddddd-0000-0000-0000-000000000001"


def _due_in_days(days: float) -> str:
    """ISO timestamp for a deadline due N days from now."""
    dt = datetime.now(timezone.utc) + timedelta(days=days)
    return dt.isoformat()


def _make_deadline(
    days: float,
    notified_30d: bool = False,
    notified_14d: bool = False,
    notified_7d: bool = False,
    notified_1d: bool = False,
    notified_48h_sms: bool = False,
    acknowledged: bool = False,
) -> dict[str, Any]:
    return {
        "id": DEADLINE_ID,
        "tenant_id": TENANT_ID,
        "source_type": "report",
        "source_id": REPORT_ID,
        "due_at": _due_in_days(days),
        "ack_token": ACK_TOKEN,
        "notified_30d": notified_30d,
        "notified_14d": notified_14d,
        "notified_7d": notified_7d,
        "notified_1d": notified_1d,
        "notified_48h_sms": notified_48h_sms,
        "acknowledged": acknowledged,
    }


def _make_tenant(phone: str | None = None) -> dict[str, Any]:
    return {
        "id": TENANT_ID,
        "name": "Test Org",
        "primary_email": "contact@test.org",
        "primary_phone": phone,
    }


def _make_report() -> dict[str, Any]:
    return {
        "id": REPORT_ID,
        "title": "Annual Performance Report",
        "funder_id": "f1",
        "funders": {"name": "Test Foundation"},
    }


# ---------------------------------------------------------------------------
# run_deadline_check tests
# ---------------------------------------------------------------------------

@respx.mock
@pytest.mark.asyncio
async def test_30d_email_sent_and_column_set() -> None:
    """Deadline 20 days out: should send 30d email and set notified_30d=True."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(20)

    # Supabase: list deadlines
    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    # Supabase: fetch tenant
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant()])
    )
    # Supabase: fetch report
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[_make_report()])
    )
    # Resend: accept email
    resend_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "email-1"})
    )
    # Supabase: PATCH deadline
    patch_req = respx.patch(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(204)
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert resend_req.called, "Email should have been sent"
    # Verify patch body includes notified_30d=true
    patch_body = json.loads(patch_req.calls[0].request.content)
    assert patch_body.get("notified_30d") is True


@respx.mock
@pytest.mark.asyncio
async def test_48h_sends_email_and_sms() -> None:
    """Deadline 1 day out: should send both email and SMS."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(
        1,
        notified_30d=True,
        notified_14d=True,
        notified_7d=True,
        notified_1d=False,
        notified_48h_sms=False,
    )

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant(phone="+19075551234")])
    )
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[_make_report()])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "email-2"})
    )
    twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    sms_req = respx.post(twilio_url).mock(
        return_value=httpx.Response(201, json={"sid": "SM1"})
    )
    patch_req = respx.patch(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(204)
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert email_req.called, "48h email should be sent"
    assert sms_req.called, "48h SMS should be sent"
    patch_body = json.loads(patch_req.calls[0].request.content)
    assert patch_body.get("notified_1d") is True
    assert patch_body.get("notified_48h_sms") is True


@respx.mock
@pytest.mark.asyncio
async def test_already_notified_skipped() -> None:
    """Deadline 1 day out but all notifications already sent: no email or SMS."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(
        1,
        notified_30d=True,
        notified_14d=True,
        notified_7d=True,
        notified_1d=True,
        notified_48h_sms=True,
    )

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant(phone="+19075551234")])
    )
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[_make_report()])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "skip"})
    )
    twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    sms_req = respx.post(twilio_url).mock(
        return_value=httpx.Response(201, json={"sid": "SMS"})
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert not email_req.called, "No email when already notified"
    assert not sms_req.called, "No SMS when already notified"


@respx.mock
@pytest.mark.asyncio
async def test_no_deadlines_no_calls() -> None:
    """Empty deadline list: no emails, no SMS, no patches."""
    from app.deadline_agent.agent import run_deadline_check

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={})
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert not email_req.called


@respx.mock
@pytest.mark.asyncio
async def test_no_phone_skips_sms() -> None:
    """Deadline at 48h with tenant that has no phone: email sent, no SMS."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(1, notified_30d=True, notified_14d=True, notified_7d=True)

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant(phone=None)])
    )
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[_make_report()])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "e3"})
    )
    twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    sms_req = respx.post(twilio_url).mock(
        return_value=httpx.Response(201, json={})
    )
    respx.patch(f"{BASE_URL}/rest/v1/deadlines").mock(return_value=httpx.Response(204))

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert email_req.called, "Email should be sent at 48h"
    assert not sms_req.called, "SMS should be skipped without phone"


@respx.mock
@pytest.mark.asyncio
async def test_14d_email_sent() -> None:
    """Deadline 10 days out: should send 30d and 14d emails."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(10, notified_30d=True)  # 30d already sent

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant()])
    )
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[_make_report()])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "e4"})
    )
    patch_req = respx.patch(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(204)
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert email_req.called
    patch_body = json.loads(patch_req.calls[0].request.content)
    assert patch_body.get("notified_14d") is True


@respx.mock
@pytest.mark.asyncio
async def test_7d_email_sent() -> None:
    """Deadline 5 days out: 30d, 14d, 7d all fire (only 14d and 7d new here)."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(5, notified_30d=True, notified_14d=True)

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant()])
    )
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[_make_report()])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "e5"})
    )
    patch_req = respx.patch(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(204)
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert email_req.called
    patch_body = json.loads(patch_req.calls[0].request.content)
    assert patch_body.get("notified_7d") is True


@respx.mock
@pytest.mark.asyncio
async def test_tenant_missing_email_skipped() -> None:
    """Tenant with no primary_email: deadline should be skipped entirely."""
    from app.deadline_agent.agent import run_deadline_check

    deadline = _make_deadline(20)
    tenant_no_email = {
        "id": TENANT_ID,
        "name": "No Email Org",
        "primary_email": None,
        "primary_phone": None,
    }

    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[deadline])
    )
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[tenant_no_email])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={})
    )

    await run_deadline_check(
        BASE_URL, SERVICE_KEY, RESEND_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, APP_URL
    )

    assert not email_req.called
