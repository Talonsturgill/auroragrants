"""Supabase insert helpers for document ingestion.

Responsibilities:
  - Set per-tenant RLS context via the `set_current_tenant` RPC before every
    write, in a try/finally so the context is always cleared at the end of
    the request. Cross-tenant leakage is prevented at the DB level by the
    RLS policies in `supabase/migrations/0001_initial.sql`.
  - Insert `document_chunks` rows in bulk.
  - Insert `embeddings` rows in bulk. Postgres casts plain float32 arrays to
    the `halfvec(3072)` column.
  - Update the parent `documents` row when the full pipeline completes.
  - On embedding failure, compensate by deleting any already-inserted chunks
    so the caller can retry cleanly.

Fail-closed: if `set_current_tenant` raises, NOTHING is inserted.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from supabase import Client

from app.ingest.chunker import Chunk

log = logging.getLogger(__name__)


@dataclass
class ChunkInsertRow:
    id: str  # pre-generated UUID so we can correlate with embeddings
    chunk_index: int
    page_start: int
    page_end: int
    section_heading: str | None
    content: str
    content_type: str
    token_count: int


class IngestStorage:
    """Thin wrapper over the Supabase client for ingestion-time writes."""

    def __init__(self, supabase: Client) -> None:
        self.sb = supabase

    # ------------------------------------------------------------------
    # Tenant context
    # ------------------------------------------------------------------

    def set_tenant(self, tenant_id: str | None) -> None:
        """Set `app.current_tenant` via RPC.

        If tenant_id is None this is a funder-scoped ingest (the row has
        `tenant_id IS NULL` and `funder_id` set). We still call the RPC with
        an empty string so downstream current_tenant_id() returns NULL and
        the funder-insert RLS policy applies.
        """
        self.sb.rpc("set_current_tenant", {"tenant_id": tenant_id or ""}).execute()

    def clear_tenant(self) -> None:
        """Clear the tenant context. Safe to call in finally blocks."""
        try:
            self.sb.rpc("set_current_tenant", {"tenant_id": ""}).execute()
        except Exception as exc:
            log.warning("ingest.storage.clear_tenant_failed", extra={"err": str(exc)})

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    def insert_chunks(
        self,
        *,
        tenant_id: str | None,
        funder_id: str | None,
        document_id: str,
        chunks: list[Chunk],
    ) -> list[str]:
        """Insert chunks. Returns the list of inserted chunk IDs.

        The Postgres `document_chunks.id` default is `gen_random_uuid()`, so
        we let the DB generate IDs and read them back from the response.
        """
        if not chunks:
            return []

        rows: list[dict[str, Any]] = []
        for c in chunks:
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "funder_id": funder_id,
                    "document_id": document_id,
                    "chunk_index": c.chunk_index,
                    "page_start": c.page_start,
                    "page_end": c.page_end,
                    "section_heading": c.section_heading,
                    "content": c.content,
                    "content_type": c.content_type,
                    "token_count": c.token_count,
                }
            )
        res = self.sb.table("document_chunks").insert(rows).execute()
        data = res.data or []
        return [r["id"] for r in data]

    def insert_embeddings(
        self,
        *,
        tenant_id: str | None,
        funder_id: str | None,
        chunk_ids: list[str],
        vectors: list[list[float]],
        model: str,
    ) -> int:
        """Insert embedding rows, one per chunk. Returns insert count."""
        if not chunk_ids:
            return 0
        if len(chunk_ids) != len(vectors):
            raise ValueError(
                "chunk_ids and vectors must have the same length "
                f"(got {len(chunk_ids)} vs {len(vectors)})"
            )

        rows: list[dict[str, Any]] = []
        for cid, vec in zip(chunk_ids, vectors, strict=True):
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "funder_id": funder_id,
                    "document_chunk_id": cid,
                    "model": model,
                    # Supabase's PostgREST serializer passes lists through as
                    # JSON arrays; Postgres casts to halfvec(3072) on insert.
                    "embedding": vec,
                }
            )
        res = self.sb.table("embeddings").insert(rows).execute()
        return len(res.data or [])

    def delete_chunks(self, chunk_ids: list[str]) -> None:
        """Compensating delete when embedding fails after chunks inserted."""
        if not chunk_ids:
            return
        try:
            self.sb.table("document_chunks").delete().in_("id", chunk_ids).execute()
        except Exception as exc:
            log.error(
                "ingest.storage.delete_chunks_failed",
                extra={"count": len(chunk_ids), "err": str(exc)},
            )

    def mark_document_indexed(self, document_id: str) -> None:
        """Mark the parent document as indexed.

        NOTE: `supabase/migrations/0001_initial.sql` currently caps
        `parse_status` at {queued, parsing, parsed, failed} and does not define
        `indexed_at`. A 0003 migration is required before this runs against a
        real Supabase — tracked in `/docs/followups.md`. Mocked tests pass.
        """
        self.sb.table("documents").update(
            {
                "parse_status": "indexed",
                "indexed_at": datetime.now(UTC).isoformat(),
            }
        ).eq("id", document_id).execute()
