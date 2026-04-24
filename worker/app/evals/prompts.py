"""Prompt loading helpers for the eval gate LLM judges.

The prompt files live in /worker/prompts/. Each file has a YAML
frontmatter block, a `# System` section, and a `# User` section. The
parser here mirrors the one in app.extract.extractor so both modules
have identical conventions.

We cache parsed prompts at import time because the files are part of
the repo and never change at runtime.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_PROMPTS_DIR = _REPO_ROOT / "worker" / "prompts"


@dataclass(frozen=True)
class PromptParts:
    """Parsed system + user-template pair for a prompt file."""

    system: str
    user_template: str


def _strip_frontmatter(raw: str) -> str:
    """Drop a leading `---`-delimited YAML frontmatter block if present."""
    if not raw.startswith("---"):
        return raw
    parts = raw.split("---", 2)
    if len(parts) != 3:
        return raw
    return parts[2].lstrip()


def load_prompt(name: str) -> PromptParts:
    """Load and parse `/worker/prompts/<name>.md` into system + user parts.

    Raises RuntimeError when the file cannot be parsed, so a malformed
    prompt surfaces during startup tests rather than at first request.
    """
    path = _PROMPTS_DIR / f"{name}.md"
    raw = _strip_frontmatter(path.read_text(encoding="utf-8"))
    match = re.search(r"(?ms)^# System\s*\n(.*?)\n# User\s*\n(.*)$", raw)
    if not match:
        raise RuntimeError(f"prompt file {name}.md is malformed: missing System/User headings")
    return PromptParts(system=match.group(1).strip(), user_template=match.group(2).strip())


# Cache prompts at import so each request skips the filesystem hit. Both
# files ship with the repo so failures here block worker startup, which
# is what we want.
FACTUALITY_PROMPT = load_prompt("factuality")
RUBRIC_SCORER_PROMPT = load_prompt("rubric_scorer")
