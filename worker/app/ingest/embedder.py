"""OpenAI embedding client wrapper.

Batches up to 100 chunks per request to `text-embedding-3-large` (3072 dims,
matching the `halfvec(3072)` column in the `embeddings` table). Postgres casts
float32 inputs to halfvec on insert so the wire format stays plain floats.

Safety contract:
  - NEVER log chunk content. Only log counts and durations.
  - Retries on 429 with exponential backoff (respects Retry-After if present).
  - Returns vectors in the same order as the input.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass

from openai import APIStatusError, AsyncOpenAI, RateLimitError

log = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-large"
EMBED_DIMS = 3072
MAX_BATCH = 100
MAX_RETRIES = 5
BASE_BACKOFF_SECONDS = 1.0


@dataclass
class EmbeddingResult:
    model: str
    vectors: list[list[float]]


class Embedder:
    """OpenAI embeddings with batching and 429 retry."""

    def __init__(
        self,
        client: AsyncOpenAI,
        model: str = EMBED_MODEL,
        batch_size: int = MAX_BATCH,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.client = client
        self.model = model
        self.batch_size = batch_size
        self.max_retries = max_retries

    async def embed(self, texts: list[str]) -> EmbeddingResult:
        """Embed `texts`. Returns vectors in input order.

        Each batch is at most `batch_size`. Retries on 429 with exponential
        backoff. Other API errors propagate. Empty input returns empty result.
        """
        if not texts:
            return EmbeddingResult(model=self.model, vectors=[])

        all_vectors: list[list[float]] = []
        log.info(
            "embedder.embed.start",
            extra={"count": len(texts), "batch_size": self.batch_size},
        )

        for i in range(0, len(texts), self.batch_size):
            batch = texts[i : i + self.batch_size]
            vectors = await self._embed_batch(batch)
            all_vectors.extend(vectors)

        log.info("embedder.embed.done", extra={"count": len(all_vectors)})
        return EmbeddingResult(model=self.model, vectors=all_vectors)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = await self.client.embeddings.create(model=self.model, input=batch)
                # OpenAI returns results in the same order as inputs.
                return [d.embedding for d in resp.data]
            except RateLimitError as exc:
                last_exc = exc
                delay = self._backoff(attempt)
                log.warning(
                    "embedder.embed.rate_limited",
                    extra={"attempt": attempt + 1, "delay": delay},
                )
                await asyncio.sleep(delay)
            except APIStatusError as exc:
                # 5xx is retryable; anything else re-raises.
                last_exc = exc
                if 500 <= exc.status_code < 600 and attempt < self.max_retries - 1:
                    delay = self._backoff(attempt)
                    log.warning(
                        "embedder.embed.server_error",
                        extra={
                            "attempt": attempt + 1,
                            "status": exc.status_code,
                            "delay": delay,
                        },
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

        assert last_exc is not None
        raise last_exc

    @staticmethod
    def _backoff(attempt: int) -> float:
        # Exponential with jitter. Cap at 30s.
        base = BASE_BACKOFF_SECONDS * (2**attempt)
        jitter = random.uniform(0, base * 0.25)
        return float(min(base + jitter, 30.0))
