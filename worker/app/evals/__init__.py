"""Phase 4 evaluation gate.

This package implements the pre-surface gate every Writer-Critic-Editor
draft must pass before it is shown to a user. The gate runs AFTER the
WCE loop returns and computes five independent scores:

  1. Factuality (LLM judge over each cited sentence)
  2. Rubric adherence (LLM judge, independent of the WCE Critic)
  3. Hallucinated program citations (deterministic regex + entity link)
  4. Readability (textstat flesch_reading_ease)
  5. Word count compliance (deterministic math)

See /docs/06-eval-harness.md for the spec and /docs/07-prompts.md
(sections "Factuality verifier" and "Rubric scorer") for the judge
prompts. The reference implementation in /starter/evals/harness.py was
the prototype; this module is the production version.

Entry point: `run_eval_gate`. All thresholds are module-level constants
so tests and callers can introspect them.
"""

from app.evals.gate import EvalResult, EvalScores, run_eval_gate
from app.evals.thresholds import (
    FACTUALITY_PER_SENTENCE_THRESHOLD,
    FACTUALITY_PROPORTION_THRESHOLD,
    HALLUCINATION_THRESHOLD,
    READABILITY_THRESHOLD,
    RUBRIC_THRESHOLD,
    WORD_COUNT_MAX_RATIO,
    WORD_COUNT_MIN_RATIO,
)

__all__ = [
    "FACTUALITY_PER_SENTENCE_THRESHOLD",
    "FACTUALITY_PROPORTION_THRESHOLD",
    "HALLUCINATION_THRESHOLD",
    "READABILITY_THRESHOLD",
    "RUBRIC_THRESHOLD",
    "WORD_COUNT_MAX_RATIO",
    "WORD_COUNT_MIN_RATIO",
    "EvalResult",
    "EvalScores",
    "run_eval_gate",
]
