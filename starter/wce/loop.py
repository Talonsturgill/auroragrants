"""
Writer-Critic-Editor loop for grant narrative drafting.

The loop:
  1. Writer drafts the field given retrieved chunks, funder rubric, org context.
  2. Critic scores the draft and returns structured fixes.
  3. If Critic says ready_to_surface, exit.
  4. Otherwise, Editor applies fixes and we go back to step 2.
  5. Max iterations: 5. If not ready after 5, surface the best draft with a flag.

Model routing:
  - Writer: Claude Sonnet 4.5
  - Critic: Claude Opus 4.5 on high-stakes (federal award > $500k), else Sonnet 4.5
  - Editor: Claude Sonnet 4.5

Every call is logged to drafts.wce_trace.

Style rules enforced in prompts:
  - No em dashes, no semicolons, no colons except in headings
  - Plain active voice
  - Never invent facts; cite every sentence
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import anthropic

# These would be imported from the RAG starter in production.
from ..rag.retriever import HybridRetriever, RetrievedChunk


MODEL_WRITER = "claude-sonnet-4-5"
MODEL_CRITIC_STANDARD = "claude-sonnet-4-5"
MODEL_CRITIC_HIGH_STAKES = "claude-opus-4-5"
MODEL_EDITOR = "claude-sonnet-4-5"

MAX_ITERATIONS = 5
SURFACE_THRESHOLD = 8.0
FLAG_THRESHOLD = 6.0

PROMPTS_DIR = Path(__file__).parent.parent.parent / "worker" / "prompts"


@dataclass
class Draft:
    content: str
    citations: list[dict]
    word_count: int
    uncovered_claims: list[str] = field(default_factory=list)


@dataclass
class Critique:
    rubric_scores: dict[str, dict]
    overall_score: float
    fixes: list[dict]
    ready_to_surface: bool


@dataclass
class IterationTrace:
    iteration: int
    writer_tokens_in: int
    writer_tokens_out: int
    critic_tokens_in: int
    critic_tokens_out: int
    editor_tokens_in: int
    editor_tokens_out: int
    overall_score: float
    ready_to_surface: bool
    model_writer: str
    model_critic: str
    model_editor: str
    duration_ms: int


@dataclass
class WCEResult:
    draft: Draft
    critique: Critique
    iterations: list[IterationTrace]
    total_tokens_in: int
    total_tokens_out: int
    total_cost_cents: int
    final_iteration: int
    surface_decision: str  # "surface" | "surface_with_flag" | "block"


def _load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    return path.read_text() if path.exists() else ""


def _format_chunks(chunks: list[RetrievedChunk]) -> list[dict]:
    return [
        {
            "id": c.citation_id,
            "chunk_id": c.chunk_id,
            "document_id": c.document_id,
            "page_start": c.page_start,
            "page_end": c.page_end,
            "section": c.section_heading,
            "content": c.content,
            "source": c.source,
        }
        for c in chunks
    ]


def _json_from_response(response) -> dict:
    """Anthropic Messages API returns content as a list of blocks.
    Our prompts instruct 'return only JSON' so we expect a single text block."""
    txt = response.content[0].text if response.content else "{}"
    # Trim fences in case the model added them despite instructions
    txt = txt.strip()
    if txt.startswith("```"):
        txt = txt.split("\n", 1)[1] if "\n" in txt else txt[3:]
        if txt.endswith("```"):
            txt = txt[: -3]
        if txt.startswith("json"):
            txt = txt[4:]
        txt = txt.strip()
    return json.loads(txt)


def _estimate_cost_cents(model: str, tokens_in: int, tokens_out: int) -> int:
    # Prices in USD per million tokens as of 2025-2026 launch. Update via env vars in prod.
    prices = {
        "claude-sonnet-4-5": (3.00, 15.00),
        "claude-opus-4-5": (15.00, 75.00),
        "claude-haiku-4-5": (1.00, 5.00),
    }
    pin, pout = prices.get(model, (3.00, 15.00))
    cents = ((tokens_in / 1_000_000) * pin + (tokens_out / 1_000_000) * pout) * 100
    return int(round(cents))


class WCELoop:
    def __init__(
        self,
        anthropic_client: anthropic.Anthropic,
        retriever: HybridRetriever,
        zdr_enabled: bool = False,
    ):
        self.client = anthropic_client
        self.retriever = retriever
        self.zdr_enabled = zdr_enabled
        # ZDR routing is handled by the Anthropic organization the client is scoped to.
        # On Sovereignty tier, the caller constructs the client with an API key bound
        # to a ZDR-enabled organization.

    async def _writer(
        self,
        funder: dict,
        rubric: list[dict],
        field_meta: dict,
        org_context: dict,
        chunks: list[RetrievedChunk],
    ) -> tuple[Draft, int, int]:
        system = _load_prompt("writer") or (
            "You write grant compliance reporting narratives for Alaska "
            "nonprofits and tribal organizations. Ground every sentence in "
            "retrieved chunks. Never invent facts. Use plain active voice. "
            "Never use em dashes, semicolons, or colons except in headings. "
            "Every sentence must carry an inline [n] citation. Match the "
            "funder rubric. Stay within the word count cap."
        )
        user = json.dumps(
            {
                "funder_name": funder["name"],
                "rubric": rubric,
                "field_label": field_meta["label"],
                "field_type": field_meta["field_type"],
                "word_count_max": field_meta.get("word_count_max"),
                "word_count_min": field_meta.get("word_count_min"),
                "retrieved_chunks": _format_chunks(chunks),
                "org_context": org_context,
            }
        )
        resp = self.client.messages.create(
            model=MODEL_WRITER,
            max_tokens=4000,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parsed = _json_from_response(resp)
        draft = Draft(
            content=parsed["draft_content"],
            citations=parsed.get("citations", []),
            word_count=int(parsed.get("word_count", len(parsed["draft_content"].split()))),
            uncovered_claims=parsed.get("uncovered_claims", []),
        )
        return draft, resp.usage.input_tokens, resp.usage.output_tokens

    async def _critic(
        self,
        funder: dict,
        rubric: list[dict],
        field_meta: dict,
        draft: Draft,
        chunks: list[RetrievedChunk],
        high_stakes: bool,
    ) -> tuple[Critique, int, int, str]:
        system = _load_prompt("critic") or (
            "Evaluate grant narratives against a rubric. Score each rubric "
            "item 0 to 2. Return structured JSON with specific fixes. Reward "
            "concrete, quantified, cited claims. Penalize boilerplate and "
            "uncited assertions. Do not rewrite the draft."
        )
        user = json.dumps(
            {
                "funder_name": funder["name"],
                "rubric": rubric,
                "field_label": field_meta["label"],
                "word_count_max": field_meta.get("word_count_max"),
                "draft": draft.content,
                "citations": draft.citations,
                "retrieved_chunks": _format_chunks(chunks),
            }
        )
        model = MODEL_CRITIC_HIGH_STAKES if high_stakes else MODEL_CRITIC_STANDARD
        resp = self.client.messages.create(
            model=model,
            max_tokens=2000,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parsed = _json_from_response(resp)
        critique = Critique(
            rubric_scores=parsed.get("rubric_scores", {}),
            overall_score=float(parsed.get("overall_score", 0.0)),
            fixes=parsed.get("fixes", []),
            ready_to_surface=bool(parsed.get("ready_to_surface", False)),
        )
        return critique, resp.usage.input_tokens, resp.usage.output_tokens, model

    async def _editor(
        self, draft: Draft, critique: Critique, chunks: list[RetrievedChunk]
    ) -> tuple[Draft, int, int]:
        system = _load_prompt("editor") or (
            "Revise grant narratives to address the Critic's fixes. Preserve "
            "citations unless removing a sentence. Do not introduce new "
            "claims without a source chunk to cite. No em dashes, no "
            "semicolons, no colons except in headings."
        )
        user = json.dumps(
            {
                "original_draft": draft.content,
                "citations": draft.citations,
                "fixes": critique.fixes,
                "retrieved_chunks": _format_chunks(chunks),
            }
        )
        resp = self.client.messages.create(
            model=MODEL_EDITOR,
            max_tokens=4000,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parsed = _json_from_response(resp)
        revised = Draft(
            content=parsed["revised_content"],
            citations=parsed.get("citations", draft.citations),
            word_count=int(
                parsed.get("word_count", len(parsed["revised_content"].split()))
            ),
            uncovered_claims=draft.uncovered_claims,
        )
        return revised, resp.usage.input_tokens, resp.usage.output_tokens

    async def run(
        self,
        tenant_id: str,
        funder: dict,
        rubric: list[dict],
        field_meta: dict,
        org_context: dict,
        retrieval_query: str,
        funder_id: Optional[str] = None,
        high_stakes: bool = False,
        k_chunks: int = 5,
    ) -> WCEResult:
        chunks = await self.retriever.retrieve(
            tenant_id=tenant_id,
            query=retrieval_query,
            funder_id=funder_id,
            k=k_chunks,
        )

        iterations: list[IterationTrace] = []
        total_in = 0
        total_out = 0
        total_cents = 0
        best_draft: Optional[Draft] = None
        best_critique: Optional[Critique] = None
        best_score = -1.0

        draft, wi, wo = await self._writer(funder, rubric, field_meta, org_context, chunks)
        total_in += wi
        total_out += wo
        total_cents += _estimate_cost_cents(MODEL_WRITER, wi, wo)

        for i in range(1, MAX_ITERATIONS + 1):
            t0 = time.time()
            critique, ci, co, critic_model = await self._critic(
                funder, rubric, field_meta, draft, chunks, high_stakes
            )
            total_in += ci
            total_out += co
            total_cents += _estimate_cost_cents(critic_model, ci, co)

            if critique.overall_score > best_score:
                best_score = critique.overall_score
                best_draft = draft
                best_critique = critique

            ei, eo = 0, 0
            if critique.ready_to_surface or i == MAX_ITERATIONS:
                iterations.append(
                    IterationTrace(
                        iteration=i,
                        writer_tokens_in=(wi if i == 1 else 0),
                        writer_tokens_out=(wo if i == 1 else 0),
                        critic_tokens_in=ci,
                        critic_tokens_out=co,
                        editor_tokens_in=0,
                        editor_tokens_out=0,
                        overall_score=critique.overall_score,
                        ready_to_surface=critique.ready_to_surface,
                        model_writer=MODEL_WRITER,
                        model_critic=critic_model,
                        model_editor=MODEL_EDITOR,
                        duration_ms=int((time.time() - t0) * 1000),
                    )
                )
                break

            draft, ei, eo = await self._editor(draft, critique, chunks)
            total_in += ei
            total_out += eo
            total_cents += _estimate_cost_cents(MODEL_EDITOR, ei, eo)

            iterations.append(
                IterationTrace(
                    iteration=i,
                    writer_tokens_in=(wi if i == 1 else 0),
                    writer_tokens_out=(wo if i == 1 else 0),
                    critic_tokens_in=ci,
                    critic_tokens_out=co,
                    editor_tokens_in=ei,
                    editor_tokens_out=eo,
                    overall_score=critique.overall_score,
                    ready_to_surface=False,
                    model_writer=MODEL_WRITER,
                    model_critic=critic_model,
                    model_editor=MODEL_EDITOR,
                    duration_ms=int((time.time() - t0) * 1000),
                )
            )

        final_draft = best_draft or draft
        final_critique = best_critique or critique

        if final_critique.overall_score >= SURFACE_THRESHOLD and not any(
            f.get("severity") == "high" for f in final_critique.fixes
        ):
            decision = "surface"
        elif final_critique.overall_score >= FLAG_THRESHOLD:
            decision = "surface_with_flag"
        else:
            decision = "block"

        return WCEResult(
            draft=final_draft,
            critique=final_critique,
            iterations=iterations,
            total_tokens_in=total_in,
            total_tokens_out=total_out,
            total_cost_cents=total_cents,
            final_iteration=len(iterations),
            surface_decision=decision,
        )


# --- Tests ----------------------------------------------------------------
#
# pytest starter/wce/loop.py::test_loop_terminates_on_ready
#
# Required test scenarios:
#   1. Critic returns ready_to_surface=true on iter 1; loop exits; iterations == 1.
#   2. Critic never ready; loop runs 5 iterations; returns best draft by score.
#   3. High-stakes routing: when high_stakes=True, critic model is Opus.
#   4. Word count cap: Writer returns a draft over 105% of max; harness blocks it.
#   5. Zero citations: Writer returns draft with no [n] tokens; harness blocks.
#   6. Hallucinated program: Critic should flag; if it does not, the separate
#      hallucinated-program check in evals/harness.py blocks regardless.
