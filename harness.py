"""
Evaluation harness: the gate every AI-generated draft must pass before it
is surfaced to a user.

Checks (in order; first-failing returns "block"):
  1. Word count within 95-105% of max (block)
  2. No hallucinated program/entity citations (block)
  3. Factuality-to-source >= 0.95 (block)
  4. Rubric adherence >= 1.3 of 2.0 (flag if below, do not block)
  5. Readability Flesch-Kincaid grade 10-14 (flag if outside, do not block)

Wire this into the WCE loop as a post-loop gate. The Critic inside the loop
also evaluates rubric adherence, but this harness is an independent second
opinion using a different prompt and, optionally, a different model.

Usage:
    result = run_harness(
        draft=wce_result.draft,
        report_field=report_field_row,
        funder_rubric=funder.rubric,
        tenant_chunks=chunks_passed_to_writer,
        known_programs=funder.known_programs + tenant.awards.program_names,
        llm=anthropic_client,
    )
    if result.surface_decision == "block":
        ...regenerate...
    elif result.surface_decision == "surface_with_flag":
        ...show red-flag banner to user...
    else:
        ...surface normally...
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from typing import Literal, Optional

import anthropic
from openai import AsyncOpenAI
import textstat


SurfaceDecision = Literal["surface", "surface_with_flag", "block"]


@dataclass
class EvalResult:
    factuality_score: float
    factuality_detail: list[dict]
    rubric_score: float
    rubric_breakdown: dict
    hallucinated_entities: list[str]
    readability_grade: float
    word_count: int
    word_count_ok: bool
    word_count_max: Optional[int]
    word_count_min: Optional[int]
    overall_pass: bool
    surface_decision: SurfaceDecision
    reasons: list[str] = field(default_factory=list)


# --- Sentence + citation parsing ---------------------------------------

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_CITATION = re.compile(r"\[(\d+)\]")


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def _extract_citations(sentence: str) -> list[int]:
    return [int(m) for m in _CITATION.findall(sentence)]


# --- Check 1: word count ----------------------------------------------

def _check_word_count(
    content: str, word_max: Optional[int], word_min: Optional[int]
) -> tuple[int, bool]:
    # Strip citation tokens before counting
    stripped = _CITATION.sub("", content)
    count = len(stripped.split())
    if word_max is not None and count > int(word_max * 1.05):
        return count, False
    if word_min is not None and count < int(word_min * 0.95):
        return count, False
    return count, True


# --- Check 2: hallucinated programs/entities --------------------------

_PROGRAM_PATTERNS = [
    re.compile(r"\bCFDA[ #:]*([\d\.]+)", re.IGNORECASE),
    re.compile(r"\b([A-Z]{2,6})-(\d{4,})\b"),  # award numbers like DW-36839-21
    re.compile(r"\bPublic Law[ #]*(\d+-\d+)\b", re.IGNORECASE),
    re.compile(r"\b(2 CFR \d+\.\d+)\b"),
]


def _find_entities(content: str) -> list[str]:
    found: list[str] = []
    for pat in _PROGRAM_PATTERNS:
        for m in pat.finditer(content):
            found.append(m.group(0))
    # Capitalized proper-noun sequences that look like program names
    for m in re.finditer(
        r"\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,4})\b(?=\s+(?:Program|Grant|Act|Fund|Initiative))",
        content,
    ):
        found.append(m.group(1) + " " + content[m.end():m.end()+8].split()[0])
    return list(dict.fromkeys(found))


def _check_hallucinated_entities(
    content: str, known_entities: set[str]
) -> list[str]:
    extracted = _find_entities(content)
    hallucinated = []
    for e in extracted:
        if not any(e.lower() in k.lower() or k.lower() in e.lower() for k in known_entities):
            hallucinated.append(e)
    return hallucinated


# --- Check 3: factuality-to-source ------------------------------------

FACTUALITY_PROMPT = """You are a strict factuality judge. For each sentence, \
assess whether the cited chunk supports the sentence's factual claims.

Return a score 0 to 1 for each sentence. 1 = fully supported. 0 = not supported.
Do not give partial credit for topically related but factually different content.
Return JSON only: {"results": [{"sentence_index": int, "score": float, "reason": str}]}
"""


async def _factuality_llm_verify(
    pairs: list[dict], llm: anthropic.Anthropic, model: str = "claude-sonnet-4-5"
) -> list[dict]:
    resp = llm.messages.create(
        model=model,
        max_tokens=2000,
        system=FACTUALITY_PROMPT,
        messages=[{"role": "user", "content": json.dumps({"pairs": pairs})}],
    )
    raw = resp.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw[:-3]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw).get("results", [])


async def _check_factuality(
    content: str,
    citations: list[dict],
    embedder: AsyncOpenAI,
    llm: anthropic.Anthropic,
) -> tuple[float, list[dict]]:
    """Combines embedding similarity + LLM verification.
    Score = fraction of sentences with support_score >= 0.7 AND cosine >= 0.6.
    Sentences with no citation get a 0.
    """
    sentences = _split_sentences(content)
    if not sentences:
        return 0.0, []

    citation_map = {c["id"]: c for c in citations}
    pairs_for_llm = []
    for idx, sent in enumerate(sentences):
        cited = _extract_citations(sent)
        if not cited:
            pairs_for_llm.append(
                {"sentence_index": idx, "sentence": sent, "chunk_content": "",
                 "no_citation": True}
            )
            continue
        # Use first citation for verification
        chunk = citation_map.get(cited[0])
        if not chunk:
            pairs_for_llm.append(
                {"sentence_index": idx, "sentence": sent, "chunk_content": "",
                 "no_citation": True}
            )
            continue
        pairs_for_llm.append(
            {"sentence_index": idx, "sentence": sent,
             "chunk_content": chunk.get("excerpt") or chunk.get("content", ""),
             "no_citation": False}
        )

    llm_results = await _factuality_llm_verify(pairs_for_llm, llm)
    # Compute embedding similarity in parallel
    sent_embs = await embedder.embeddings.create(
        model="text-embedding-3-large",
        input=[p["sentence"] for p in pairs_for_llm],
    )
    chunk_embs = await embedder.embeddings.create(
        model="text-embedding-3-large",
        input=[p["chunk_content"] or " " for p in pairs_for_llm],
    )

    def _cosine(a, b):
        import math
        dot = sum(x*y for x, y in zip(a, b))
        na = math.sqrt(sum(x*x for x in a))
        nb = math.sqrt(sum(x*x for x in b))
        return dot / (na * nb) if na and nb else 0.0

    detail = []
    passed = 0
    for i, p in enumerate(pairs_for_llm):
        if p["no_citation"]:
            detail.append({"sentence_index": i, "pass": False, "reason": "no citation"})
            continue
        llm_hit = next((r for r in llm_results if r["sentence_index"] == i), None)
        llm_score = float(llm_hit["score"]) if llm_hit else 0.0
        cosine = _cosine(sent_embs.data[i].embedding, chunk_embs.data[i].embedding)
        ok = llm_score >= 0.7 and cosine >= 0.6
        detail.append(
            {"sentence_index": i, "llm_score": llm_score, "cosine": cosine,
             "pass": ok,
             "reason": llm_hit["reason"] if llm_hit else "no llm result"}
        )
        if ok:
            passed += 1

    score = passed / len(pairs_for_llm) if pairs_for_llm else 0.0
    return score, detail


# --- Check 4: rubric adherence (independent) --------------------------

RUBRIC_PROMPT = """You score a grant narrative against a rubric. You are \
independent from any Critic in the drafting loop. Score each rubric item 0 to 2.
Return JSON only: {"scores": {"<rubric_id>": {"score": int, "justification": str}}}
"""


async def _check_rubric(
    content: str, rubric: list[dict], llm: anthropic.Anthropic,
    model: str = "claude-sonnet-4-5",
) -> tuple[float, dict]:
    resp = llm.messages.create(
        model=model,
        max_tokens=1500,
        system=RUBRIC_PROMPT,
        messages=[{"role": "user", "content": json.dumps(
            {"rubric": rubric, "narrative": content}
        )}],
    )
    raw = resp.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw[:-3]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    parsed = json.loads(raw).get("scores", {})
    total_w = sum(r.get("weight", 1.0) for r in rubric) or 1.0
    weighted = 0.0
    breakdown = {}
    for r in rubric:
        rid = r["id"]
        item = parsed.get(rid, {"score": 0, "justification": "no score"})
        s = float(item["score"])
        w = float(r.get("weight", 1.0 / len(rubric)))
        weighted += s * w
        breakdown[rid] = item
    # Normalize to 0-2
    normalized = weighted / total_w * (total_w / (total_w or 1.0))
    return normalized, breakdown


# --- Check 5: readability ---------------------------------------------

def _check_readability(content: str) -> float:
    stripped = _CITATION.sub("", content)
    return float(textstat.flesch_kincaid_grade(stripped))


# --- Orchestrator -----------------------------------------------------

async def run_harness(
    draft_content: str,
    citations: list[dict],
    report_field: dict,
    funder_rubric: list[dict],
    known_entities: set[str],
    llm: anthropic.Anthropic,
    embedder: AsyncOpenAI,
) -> EvalResult:
    reasons: list[str] = []

    # 1. Word count
    word_count, wc_ok = _check_word_count(
        draft_content,
        report_field.get("word_count_max"),
        report_field.get("word_count_min"),
    )
    if not wc_ok:
        reasons.append(
            f"word_count {word_count} outside 95-105% of max "
            f"{report_field.get('word_count_max')}"
        )

    # 2. Hallucinated entities
    hallucinated = _check_hallucinated_entities(draft_content, known_entities)
    if hallucinated:
        reasons.append(f"hallucinated_entities: {hallucinated}")

    # 3. Factuality
    factuality_score, factuality_detail = await _check_factuality(
        draft_content, citations, embedder, llm
    )
    if factuality_score < 0.95:
        reasons.append(f"factuality {factuality_score:.2f} below 0.95")

    # 4. Rubric
    rubric_score, rubric_breakdown = await _check_rubric(
        draft_content, funder_rubric, llm
    )

    # 5. Readability
    readability = _check_readability(draft_content)

    # Gating
    if hallucinated or not wc_ok or factuality_score < 0.95:
        decision: SurfaceDecision = "block"
    elif rubric_score < 1.3 or not (10.0 <= readability <= 14.0):
        decision = "surface_with_flag"
        if rubric_score < 1.3:
            reasons.append(f"rubric {rubric_score:.2f} below 1.3")
        if not (10.0 <= readability <= 14.0):
            reasons.append(f"readability grade {readability:.1f} outside 10-14")
    else:
        decision = "surface"

    overall_pass = decision == "surface"

    return EvalResult(
        factuality_score=factuality_score,
        factuality_detail=factuality_detail,
        rubric_score=rubric_score,
        rubric_breakdown=rubric_breakdown,
        hallucinated_entities=hallucinated,
        readability_grade=readability,
        word_count=word_count,
        word_count_ok=wc_ok,
        word_count_max=report_field.get("word_count_max"),
        word_count_min=report_field.get("word_count_min"),
        overall_pass=overall_pass,
        surface_decision=decision,
        reasons=reasons,
    )


# --- Tests ----------------------------------------------------------------
#
# pytest starter/evals/harness.py
#
# Required tests:
#   test_word_count_block: draft 150% of max -> block.
#   test_hallucinated_program_block: draft mentions "Fictional 2024 Act" -> block.
#   test_factuality_block: draft cites [1] but content does not support it -> block.
#   test_rubric_flag: all factual but low rubric adherence -> surface_with_flag.
#   test_readability_flag: grade 6 -> surface_with_flag.
#   test_surface: everything passes -> surface.
#
# Golden set: /starter/evals/golden/*.json, 20 hand-labeled drafts.
# CI must match expected outcomes on >= 90% of golden set.
