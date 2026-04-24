"""Parse routes. Wire in Phase 2.

See /docs/05-build-plan.md Phase 2 for the spec and acceptance criteria.

Endpoints:
  POST /parse/marker       — parse a PDF with Marker, return structured markdown
  POST /parse/pdfplumber   — parse a PDF with pdfplumber, return text + tables
  POST /parse/unstructured — parse a PDF with Unstructured, return element list

Every endpoint accepts `{document_id: uuid}` and reads the PDF from Supabase
Storage via a signed URL. Writes chunks to `document_chunks` and queues
embedding generation via a background task.
"""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.post("/marker")
async def parse_marker(request: Request) -> dict:
    raise HTTPException(status_code=501, detail="Implement in Phase 2")


@router.post("/pdfplumber")
async def parse_pdfplumber(request: Request) -> dict:
    raise HTTPException(status_code=501, detail="Implement in Phase 2")


@router.post("/unstructured")
async def parse_unstructured(request: Request) -> dict:
    raise HTTPException(status_code=501, detail="Implement in Phase 2")
