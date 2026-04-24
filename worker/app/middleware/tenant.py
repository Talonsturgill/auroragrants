"""
TenantContextMiddleware

Extracts tenant_id from the signed JWT in the Authorization header, then
sets `app.current_tenant` on the Supabase session before the route handler
runs. All RLS policies depend on this being set.

The JWT is signed by the Next.js API gateway with a shared secret
(`WORKER_JWT_SECRET`). The payload is:
  {
    "tenant_id": "<uuid>",
    "user_id": "<clerk user id>",
    "role": "owner|admin|editor|viewer",
    "iat": ...,
    "exp": ...
  }

Reject requests without a valid JWT with 401.
Reject requests where tenant_id is missing with 400.
"""

from __future__ import annotations

import os
import time
from collections.abc import Awaitable, Callable

import jwt
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"error": "missing_bearer"})

        token = auth.removeprefix("Bearer ").strip()
        secret = os.environ["WORKER_JWT_SECRET"]
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            return JSONResponse(status_code=401, content={"error": "invalid_jwt"})

        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            return JSONResponse(status_code=400, content={"error": "missing_tenant"})

        if payload.get("exp", 0) < int(time.time()):
            return JSONResponse(status_code=401, content={"error": "expired_jwt"})

        # Attach to request.state for handlers; DO NOT log raw content.
        request.state.tenant_id = tenant_id
        request.state.user_id = payload.get("user_id")
        request.state.role = payload.get("role", "viewer")

        return await call_next(request)
