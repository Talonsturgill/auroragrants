"""
AuroraGrants FastAPI worker.

Three logical services in one container:
  - /parse/*  — PDF ingestion (Marker, pdfplumber, Unstructured)
  - /wce/*    — Writer-Critic-Editor loop
  - /evals/*  — pre-surface evaluation harness

All endpoints require a signed tenant JWT in the Authorization header.
The middleware extracts `tenant_id` and calls `SELECT set_config('app.current_tenant', ...)` before any DB query.

See /docs/01-architecture.md and /docs/05-build-plan.md for the spec.
This file is a skeleton. Claude Code fills in the route handlers per the specs.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.middleware.tenant import TenantContextMiddleware
from app.routes import evals, health, parse, wce


def _init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=0.1,
            profiles_sample_rate=0.1,
            environment=os.getenv("APP_ENV", "development"),
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _init_sentry()
    yield


app = FastAPI(
    title="AuroraGrants Worker",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if os.getenv("APP_ENV") != "production" else None,
)

app.add_middleware(TenantContextMiddleware)

app.include_router(health.router)
app.include_router(parse.router, prefix="/parse", tags=["parse"])
app.include_router(wce.router, prefix="/wce", tags=["wce"])
app.include_router(evals.router, prefix="/evals", tags=["evals"])


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    # Scrub; never echo payload back
    sentry_sdk.capture_exception(exc)
    return JSONResponse(status_code=500, content={"error": "internal_server_error"})
