"""Writer-Critic-Editor routes. Wire in Phase 4.

See /starter/wce/loop.py for the reference implementation.

Endpoints:
  POST /wce/draft-field  — run the WCE loop on a single report_field
  POST /wce/regenerate   — force regeneration with expanded retrieval

Both endpoints accept `{report_field_id: uuid, high_stakes: bool}` and
return the surfaced draft (or block with reasons).
"""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.post("/draft-field")
async def draft_field(request: Request) -> dict:
    raise HTTPException(status_code=501, detail="Implement in Phase 4 using /starter/wce/loop.py")


@router.post("/regenerate")
async def regenerate(request: Request) -> dict:
    raise HTTPException(status_code=501, detail="Implement in Phase 4")
