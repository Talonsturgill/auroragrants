"""
Railway cron entry point for the AuroraGrants deadline notification agent.

Reads env vars, calls run_deadline_check, exits 0 on success, 1 on error.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone


def _log(action: str, reason: str) -> None:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "reason": reason,
    }
    sys.stdout.write(json.dumps(record) + "\n")
    sys.stdout.flush()


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    resend_api_key = os.environ.get("RESEND_API_KEY", "")
    twilio_account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    twilio_auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    twilio_from_number = os.environ.get("TWILIO_FROM_NUMBER", "")
    app_base_url = os.environ.get("APP_BASE_URL", "https://auroragrants.app")

    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", supabase_service_key),
            ("RESEND_API_KEY", resend_api_key),
        ]
        if not val
    ]
    if missing:
        _log("startup_error", f"Missing required env vars: {', '.join(missing)}")
        return 1

    from app.deadline_agent.agent import run_deadline_check  # noqa: PLC0415

    try:
        asyncio.run(
            run_deadline_check(
                supabase_url=supabase_url,
                supabase_service_key=supabase_service_key,
                resend_api_key=resend_api_key,
                twilio_account_sid=twilio_account_sid,
                twilio_auth_token=twilio_auth_token,
                twilio_from_number=twilio_from_number,
                app_base_url=app_base_url,
            )
        )
        _log("run_complete", "deadline_check_finished")
        return 0
    except Exception as exc:
        _log("run_error", str(exc)[:300])
        return 1


if __name__ == "__main__":
    sys.exit(main())
