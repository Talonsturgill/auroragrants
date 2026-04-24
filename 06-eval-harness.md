# 06 — Evaluation Harness

Every AI-generated draft must pass this harness before surfacing to a user. No exceptions. The harness is implemented in `/starter/evals/` and wired into the WCE loop's Critic phase and into a post-loop gating function.

## The five checks

### 1. Factuality to source
Every sentence in the draft must be backed by a cited chunk from the tenant's documents or the funder rubric. A sentence is "backed" if:
- It contains an inline citation token `[n]` referring to a chunk in the draft's `citations` array.
- The cited chunk's cosine similarity to the sentence embedding is ≥ 0.6.
- An LLM verifier (Sonnet 4.5 as judge, cheaper than Opus) confirms the sentence is supported by the chunk.

**Score** = fraction of sentences that pass all three conditions.

**Threshold** = 0.95. Below threshold, the draft is not surfaced; the Writer re-runs with retrieval expanded.

### 2. Rubric adherence
For each rubric item on the funder, run a structured-output prompt that scores the draft 0–2 against that item's scoring criteria. Aggregate weighted score.

**Threshold** = weighted aggregate ≥ 1.3 (out of 2.0). Below threshold, the draft surfaces with a red-flag banner noting the weakest rubric items.

### 3. Hallucinated program citations
Regex-scan the draft for any mentions of programs, statutes, award numbers, or federal CFDA codes. Entity-link against:
- The funder's `known_programs` list.
- The tenant's `awards` table.
- A static list of 500+ federal programs compiled from grants.gov.

Any entity that does not resolve is a hallucinated citation. **Threshold** = zero hallucinations. Non-zero = block surface and regenerate.

### 4. Readability
Flesch-Kincaid grade level. Computed via `textstat` library.

**Target** = 10–14. Outside range = warning, not block.

### 5. Word count
Extract word count; compare to `report_fields.word_count_max` and `word_count_min`.

**Threshold** = within 95–105% of `word_count_max`. Outside = block and regenerate.

## Implementation

See `/starter/evals/` for the reference implementation. The main entry point is:

```python
# /starter/evals/harness.py
from dataclasses import dataclass
from typing import Literal

@dataclass
class EvalResult:
    factuality_score: float
    rubric_score: float
    rubric_breakdown: dict
    hallucinated_entities: list[str]
    readability_grade: float
    word_count: int
    word_count_ok: bool
    overall_pass: bool
    surface_decision: Literal["surface", "surface_with_flag", "block"]
    reasons: list[str]

def run_harness(draft, citations, report_field, tenant_docs, funder_rubric) -> EvalResult:
    ...
```

## Gating logic

```
if hallucinated_entities: return "block"
if not word_count_ok: return "block"
if factuality_score < 0.95: return "block"
if rubric_score < 1.3: return "surface_with_flag"
if readability_grade not in (10, 14): return "surface_with_flag"
return "surface"
```

## Logging

Every harness run writes to `drafts.eval_scores` as:

```json
{
  "factuality_score": 0.97,
  "rubric_score": 1.6,
  "rubric_breakdown": {
    "community_impact": 2,
    "organizational_capacity": 1,
    "project_feasibility": 2,
    "budget_appropriateness": 1
  },
  "hallucinated_entities": [],
  "readability_grade": 11.2,
  "word_count": 487,
  "word_count_ok": true,
  "overall_pass": true,
  "surface_decision": "surface",
  "reasons": []
}
```

## Nightly drift check

A `nightly-evals` cron samples 5 surfaced drafts per tenant per day and re-runs the harness with the current model versions. If pass rate drops below 90% for a tenant over a rolling 7-day window, alert the founder.

## Golden set

The harness itself is tested against a golden set of 20 hand-labeled drafts with known pass/fail expectations. The harness must match expected outcomes on ≥ 90% of the golden set in CI.
