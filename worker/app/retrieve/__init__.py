"""Hybrid retrieval: BM25 + pgvector + Cohere rerank.

Exports:
  - HybridRetriever — production version of `starter/rag/retriever.py`
  - RetrieveRequest, RetrieveResponse, RetrievedChunk — route contracts
"""

from app.retrieve.hybrid import HybridRetriever
from app.retrieve.models import RetrievedChunk, RetrieveRequest, RetrieveResponse

__all__ = [
    "HybridRetriever",
    "RetrieveRequest",
    "RetrieveResponse",
    "RetrievedChunk",
]
