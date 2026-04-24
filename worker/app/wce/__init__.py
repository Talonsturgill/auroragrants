"""Writer-Critic-Editor loop for grant narrative drafting.

See /docs/05-build-plan.md Phase 4 for the spec. The loop calls the
canonical Writer/Critic/Editor prompts in /worker/prompts/*.md and
returns a grounded, rubric-scored draft with a surface decision.
"""

from app.wce.loop import (
    Critique,
    Draft,
    IterationTrace,
    WCEResult,
    run_wce_loop,
)

__all__ = [
    "Critique",
    "Draft",
    "IterationTrace",
    "WCEResult",
    "run_wce_loop",
]
