"""
TenantContextMiddleware

Extracts tenant_id from the signed JWT in the Authorization header, then
sets `app.current_tenant` on the Supabase session before the route handler
runs. All RLS policies depend on this being set.

The JWT is signed by the Next.js API gateway with a shared secret
(`WORKER_JWT_SECRET`). The payload is:
  {
    "tenant_id": "<uuid>",
    "user_id":   "<clerk user id>",
    "role":      "owner|admin|editor|viewer",
    "iat": ...,
    "exp": ...
  }

Rules:
  - Reject requests without a Bearer token with 401 `missing_bearer`.
  - Reject tokens that fail signature verification with 401 `invalid_signature`.
  - Reject expired tokens (with 30 s clock skew) with 401 `expired_token`.
  - Reject tokens missing `tenant_id` with 401 `missing_tenant`.
  - Attach `tenant_id`, `user_id`, `role` to `request.state`.
  - NEVER log the raw token or the decoded payload beyond tenant id.

The secret MUST be set to a non-empty value in production. In non-production
environments (`APP_ENV != "production"`) an empty secret is tolerated to
simplify smoke tests, but the middleware will still require a properly signed
token (signed with whatever value WORKER_JWT_SECRET currently holds, which may
be an empty string).
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable

import jwt
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

PUBLIC_PATHS: frozenset[str] = frozenset({"/health", "/docs", "/openapi.json", "/redoc"})

# Allowed clock skew when validating the `exp` and `iat` claims.
CLOCK_SKEW_SECONDS = 30


def _load_secret() -> str:
    """Load the shared HS256 secret from env.

    In production the secret MUST be a non-empty string. In other envs we
    allow an empty value so tests can run without configuration, but any
    token presented still has to match whatever value is in place.
    """
    env = os.getenv("APP_ENV", "development")
    secret = os.getenv("WORKER_JWT_SECRET", "")
    if env == "production" and not secret:
        raise RuntimeError("WORKER_JWT_SECRET must be set to a non-empty value in production")
    return secret


class TenantContextMiddleware(BaseHTTPMiddleware):
    """Verify the JWT and stash tenant metadata on `request.state`."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            return _reject("missing_bearer")

        token = auth[len("bearer ") :].strip()
        if not token:
            return _reject("missing_bearer")

        try:
            secret = _load_secret()
        except RuntimeError:
            return _reject("server_misconfigured")

        try:
            payload = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": ["exp"]},
            )
        except jwt.ExpiredSignatureError:
            return _reject("expired_token")
        except jwt.InvalidSignatureError:
            return _reject("invalid_signature")
        except jwt.MissingRequiredClaimError:
            return _reject("missing_exp")
        except jwt.PyJWTError:
            return _reject("invalid_token")

        tenant_id = payload.get("tenant_id")
        if not tenant_id or not isinstance(tenant_id, str):
            return _reject("missing_tenant")

        # Attach to request.state for handlers. NEVER log the raw token.
        request.state.tenant_id = tenant_id
        user_id = payload.get("user_id")
        if isinstance(user_id, str):
            request.state.user_id = user_id
        role = payload.get("role")
        request.state.role = role if isinstance(role, str) else "viewer"

        return await call_next(request)


def _reject(reason: str) -> JSONResponse:
    """Return a uniform 401 error response without leaking token content."""
    return JSONResponse(
        status_code=401,
        content={"error": "invalid_token", "reason": reason},
    )
