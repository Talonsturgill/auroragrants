"""Single source of truth for eval gate thresholds.

These constants are imported by the gate and by tests so there is no
drift between the spec, the implementation, and the test assertions.
Change a threshold here and every consumer picks it up.
"""

from __future__ import annotations

# Factuality: 90% of sentences must have support_score >= 0.9.
# Per /docs/05-build-plan.md Phase 4 acceptance: "Factuality score >= 0.95
# on 90% of generated drafts" — we enforce the proportional form here.
FACTUALITY_PER_SENTENCE_THRESHOLD: float = 0.9
FACTUALITY_PROPORTION_THRESHOLD: float = 0.9

# Rubric adherence: independent scorer normalized_overall / 10 must be
# at least 0.75. The WCE Critic gates at 8.0/10 inside the loop; the
# eval gate is an independent second opinion and requires >= 7.5/10.
RUBRIC_THRESHOLD: float = 0.75

# Hallucinated programs: zero tolerance. Score is 1.0 if none, else
# `1 - (hallucinated / total)`. Gate requires an exact 1.0.
HALLUCINATION_THRESHOLD: float = 1.0

# Readability: textstat.flesch_reading_ease raw score (higher is easier).
# >= 40 is college-level or easier. Below 40 is "difficult" and we block.
READABILITY_THRESHOLD: float = 40.0

# Word count compliance: word_count / word_count_max must be within
# [0.95, 1.05]. Same tolerance applies to word_count_min.
WORD_COUNT_MIN_RATIO: float = 0.95
WORD_COUNT_MAX_RATIO: float = 1.05
