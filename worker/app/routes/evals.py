"""Eval harness routes. Wire in Phase 4.

See /starter/evals/harness.py for the reference implementation.
See /docs/06-eval-harness.md for the full spec.

Endpoints:
  POST /evals/run           — run the harness on a draft (pre-surface gate)
  GET  /evals/drift/{tenant_id} — rolling drift scorecard for the admin dashboard
"""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.post("/run")
async def run_evals(request: Request) -> dict:
    raise HTTPException(
        status_code=501, detail="Implement in Phase 4 using /starter/evals/harness.py"
    )


@router.get("/drift/{tenant_id}")
async def drift(request: Request, tenant_id: str) -> dict:
    raise HTTPException(status_code=501, detail="Implement in Phase 5")
