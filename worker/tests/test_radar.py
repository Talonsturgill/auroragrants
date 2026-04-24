"""
Tests for worker/app/deadline_agent/radar.py

All Supabase REST and Resend calls are mocked via respx.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest
import respx


BASE_URL = "https://sb.test"
SERVICE_KEY = "service-key"
RESEND_KEY = "resend-key"
APP_URL = "https://app.test"

TENANT_1 = "aaaaaaaa-1111-0000-0000-000000000001"
TENANT_2 = "aaaaaaaa-2222-0000-0000-000000000002"
REPORT_ID = "cccccccc-0000-0000-0000-000000000001"


def _due_in_days(days: int) -> str:
    dt = datetime.now(timezone.utc) + timedelta(days=days)
    return dt.isoformat()


def _make_tenant(tid: str, email: str | None = "admin@org.test", name: str = "Org") -> dict[str, Any]:
    return {"id": tid, "name": name, "primary_email": email}


def _make_deadline(source_id: str, days: int) -> dict[str, Any]:
    return {
        "id": f"dl-{days}",
        "source_type": "report",
        "source_id": source_id,
        "due_at": _due_in_days(days),
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@respx.mock
@pytest.mark.asyncio
async def test_tenant_with_zero_deadlines_skipped() -> None:
    """Tenant with no upcoming deadlines should not receive a radar email."""
    from app.deadline_agent.radar import run_radar

    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant(TENANT_1)])
    )
    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=[])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "e1"})
    )

    await run_radar(BASE_URL, SERVICE_KEY, RESEND_KEY, APP_URL)

    assert not email_req.called, "No email should be sent for tenant with 0 deadlines"


@respx.mock
@pytest.mark.asyncio
async def test_tenant_with_three_deadlines_gets_email() -> None:
    """Tenant with 3 upcoming deadlines should receive one radar email."""
    from app.deadline_agent.radar import run_radar

    deadlines = [
        _make_deadline(REPORT_ID, 5),
        _make_deadline(REPORT_ID, 15),
        _make_deadline(REPORT_ID, 25),
    ]

    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant(TENANT_1)])
    )
    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=deadlines)
    )
    # Report title fetch.
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[{"title": "Q1 Report"}])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "e2"})
    )

    await run_radar(BASE_URL, SERVICE_KEY, RESEND_KEY, APP_URL)

    assert email_req.called, "Email should be sent for tenant with 3 deadlines"
    assert email_req.call_count == 1, "Exactly one email per tenant"
    # Check subject contains count.
    sent_payload = email_req.calls[0].request.read()
    import json
    body = json.loads(sent_payload)
    assert "3" in body["subject"], "Subject should mention the count of deadlines"


@respx.mock
@pytest.mark.asyncio
async def test_radar_disabled_tenant_skipped() -> None:
    """Tenant with deadline_radar_enabled=false is excluded at the query level."""
    from app.deadline_agent.radar import run_radar

    # The tenants query filters by deadline_radar_enabled=true, so disabled
    # tenants never appear in the response. Simulate this by returning empty list.
    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[])  # no opted-in tenants
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={})
    )

    await run_radar(BASE_URL, SERVICE_KEY, RESEND_KEY, APP_URL)

    assert not email_req.called, "No email when no opted-in tenants"


@respx.mock
@pytest.mark.asyncio
async def test_tenant_without_primary_email_skipped() -> None:
    """Tenant with no primary_email should be skipped with a log entry."""
    from app.deadline_agent.radar import run_radar

    deadlines = [_make_deadline(REPORT_ID, 10)]

    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(
        return_value=httpx.Response(200, json=[_make_tenant(TENANT_1, email=None)])
    )
    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(
        return_value=httpx.Response(200, json=deadlines)
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={})
    )

    await run_radar(BASE_URL, SERVICE_KEY, RESEND_KEY, APP_URL)

    assert not email_req.called, "No email when tenant has no primary_email"


@respx.mock
@pytest.mark.asyncio
async def test_multiple_tenants_each_get_one_email() -> None:
    """Two tenants with deadlines each receive exactly one email."""
    from app.deadline_agent.radar import run_radar

    tenants = [_make_tenant(TENANT_1, "a@a.test"), _make_tenant(TENANT_2, "b@b.test")]
    deadlines = [_make_deadline(REPORT_ID, 7)]

    def _tenant_responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=tenants)

    def _deadline_responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=deadlines)

    respx.get(f"{BASE_URL}/rest/v1/tenants").mock(side_effect=_tenant_responder)
    respx.get(f"{BASE_URL}/rest/v1/deadlines").mock(side_effect=_deadline_responder)
    respx.get(f"{BASE_URL}/rest/v1/reports").mock(
        return_value=httpx.Response(200, json=[{"title": "Midyear Report"}])
    )
    email_req = respx.post("https://api.resend.com/emails").mock(
        return_value=httpx.Response(201, json={"id": "ex"})
    )

    await run_radar(BASE_URL, SERVICE_KEY, RESEND_KEY, APP_URL)

    assert email_req.call_count == 2, "One email per tenant"
