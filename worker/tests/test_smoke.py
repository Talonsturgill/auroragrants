"""Smoke tests for the FastAPI worker skeleton."""

from __future__ import annotations

import os

os.environ.setdefault("WORKER_JWT_SECRET", "ci-test-secret-not-for-production")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)


def test_health_returns_ok() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_parse_requires_auth() -> None:
    resp = client.post("/parse/marker", json={})
    assert resp.status_code == 401


def test_wce_requires_auth() -> None:
    resp = client.post("/wce/draft-field", json={})
    assert resp.status_code == 401


def test_evals_requires_auth() -> None:
    resp = client.post("/evals/run", json={})
    assert resp.status_code == 401
