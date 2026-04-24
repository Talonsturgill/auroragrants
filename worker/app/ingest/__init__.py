"""Document ingestion pipeline: chunking, embedding, storage.

See /docs/05-build-plan.md Phase 2 for the spec.

Exports:
  - Chunker, Chunk — heading-aware markdown chunking with page mapping
  - Embedder — OpenAI text-embedding-3-large batcher
  - IngestStorage — tenant-scoped Supabase insert helpers
"""

from app.ingest.chunker import Chunk, Chunker
from app.ingest.embedder import Embedder
from app.ingest.storage import IngestStorage

__all__ = ["Chunk", "Chunker", "Embedder", "IngestStorage"]
