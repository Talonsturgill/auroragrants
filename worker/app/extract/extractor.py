"""Extractor service: parsed-document text in, structured JSON out.

This module loads the Extractor prompt (/worker/prompts/extractor.md) and
the ReportingRequirements JSON schema
(/starter/evals/schemas/reporting_requirements.json), calls Anthropic, and
validates the response against the schema. On first-attempt schema
violations the caller retries once with a "schema_errors" hint appended
to the user prompt. A third attempt is never made.

We never log the parsed document text or the raw LLM response. Log only
coarse metadata: attempt number, schema_valid bool, token counts, and a
sliced error message.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from anthropic import AsyncAnthropic
from jsonschema import Draft7Validator
from pydantic import BaseModel, ConfigDict, Field

log = logging.getLogger(__name__)

# Resolve the prompt and schema paths relative to the repo root. The worker
# lives at <repo>/worker/app/extract/; the prompt lives at <repo>/worker/
# prompts/ and the schema lives at <repo>/starter/evals/schemas/.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_PROMPT_PATH = _REPO_ROOT / "worker" / "prompts" / "extractor.md"
_SCHEMA_PATH = _REPO_ROOT / "starter" / "evals" / "schemas" / "reporting_requirements.json"

# Target model. Keep in sync with the YAML frontmatter in extractor.md.
_MODEL = "claude-sonnet-4-6"
# Max tokens for the response. The reporting requirements schema is
# bounded; 4096 is comfortably above the largest observed payloads in the
# golden set.
_MAX_TOKENS = 4096
# Deterministic extraction.
_TEMPERATURE = 0.0

# Error-message slice to log without leaking prompt or response content.
_ERR_SLICE = 200


class ExtractionResult(BaseModel):
    """Return envelope for the Extractor.

    `requirements` holds the model's JSON when `schema_valid` is True,
    otherwise it holds the best-effort parsed JSON (may be empty).
    `attempts` is the number of Anthropic round trips made (1 or 2).
    """

    model_config = ConfigDict(extra="forbid")

    requirements: dict[str, Any] = Field(default_factory=dict)
    attempts: int = Field(ge=1, le=2)
    schema_valid: bool
    schema_errors: list[str] | None = None
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass(frozen=True)
class _PromptParts:
    system: str
    user_template: str


def _load_prompt() -> _PromptParts:
    """Parse /worker/prompts/extractor.md into system + user sections.

    The file has a YAML frontmatter block delimited by `---`, then a
    `# System` section, then a `# User` section. We split on the two
    top-level headings.
    """
    raw = _PROMPT_PATH.read_text(encoding="utf-8")
    # Strip YAML frontmatter if present.
    if raw.startswith("---"):
        # Drop the first `---` line, then everything through the next `---`.
        parts = raw.split("---", 2)
        if len(parts) == 3:
            raw = parts[2].lstrip()
    # Split on the `# System` and `# User` markers.
    match = re.search(r"(?ms)^# System\s*\n(.*?)\n# User\s*\n(.*)$", raw)
    if not match:
        raise RuntimeError("extractor prompt file is malformed: missing System/User headings")
    system = match.group(1).strip()
    user_template = match.group(2).strip()
    return _PromptParts(system=system, user_template=user_template)


def _load_schema() -> dict[str, Any]:
    """Load the ReportingRequirements JSON schema from disk."""
    data: dict[str, Any] = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
    return data


# Cache prompt and schema at import time. Both are shipped with the repo,
# so re-reading them on every call is wasteful and could surface transient
# filesystem errors inside request handlers.
_PROMPT = _load_prompt()
_SCHEMA = _load_schema()
_VALIDATOR = Draft7Validator(_SCHEMA)


def _render_user(parsed_text: str, schema: dict[str, Any], hint: str | None = None) -> str:
    """Render the user prompt. `hint` is appended after a blank line."""
    body = _PROMPT.user_template.replace("{parsed_document_text}", parsed_text).replace(
        "{json_schema}", json.dumps(schema, indent=2)
    )
    if hint:
        body = f"{body}\n\nschema_errors:\n{hint}"
    return body


def _extract_json(text: str) -> dict[str, Any]:
    """Parse the model response as JSON. Tolerates a ```json fence.

    Returns an empty dict if nothing parses. The caller treats an empty
    dict as a schema violation and lets the retry loop handle it.
    """
    stripped = text.strip()
    # Strip a fenced block if present.
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        loaded: Any = json.loads(stripped)
    except json.JSONDecodeError:
        return {}
    if not isinstance(loaded, dict):
        return {}
    return loaded


def _validate(requirements: dict[str, Any]) -> list[str]:
    """Return a list of human-readable schema error messages. Empty = ok."""
    errors = sorted(_VALIDATOR.iter_errors(requirements), key=lambda e: list(e.absolute_path))
    return [f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}" for e in errors]


def _response_text(response: Any) -> str:
    """Pull the first text block out of an Anthropic Messages response."""
    content = getattr(response, "content", None) or []
    for block in content:
        # The SDK returns typed blocks; fall back to dict access for fakes.
        block_type = getattr(block, "type", None) or (
            block.get("type") if isinstance(block, dict) else None
        )
        if block_type == "text":
            text = getattr(block, "text", None)
            if text is None and isinstance(block, dict):
                text = block.get("text")
            if isinstance(text, str):
                return text
    return ""


def _usage_tokens(response: Any) -> tuple[int, int]:
    """Read input/output token counts from the response usage object."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return (0, 0)
    tokens_in = getattr(usage, "input_tokens", 0) or 0
    tokens_out = getattr(usage, "output_tokens", 0) or 0
    if isinstance(usage, dict):
        tokens_in = usage.get("input_tokens", tokens_in) or 0
        tokens_out = usage.get("output_tokens", tokens_out) or 0
    return int(tokens_in), int(tokens_out)


async def _call(client: AsyncAnthropic, user_body: str) -> Any:
    """One Anthropic call. Centralized so tests can patch easily."""
    return await client.messages.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        temperature=_TEMPERATURE,
        system=_PROMPT.system,
        messages=[{"role": "user", "content": user_body}],
    )


async def extract_reporting_requirements(
    parsed_text: str,
    client: AsyncAnthropic,
) -> ExtractionResult:
    """Extract ReportingRequirements JSON from parsed markdown text.

    Calls Anthropic once, validates against the schema, and retries at
    most once with a "schema_errors" hint if validation fails. Never
    makes a third attempt. Never logs `parsed_text` or the raw response.
    """
    tokens_in = 0
    tokens_out = 0
    last_errors: list[str] = []
    last_requirements: dict[str, Any] = {}

    for attempt in range(1, 3):
        hint = "\n".join(last_errors) if last_errors and attempt > 1 else None
        user_body = _render_user(parsed_text, _SCHEMA, hint=hint)

        try:
            response = await _call(client, user_body)
        except Exception as exc:
            log.warning(
                "extract.call_failed",
                extra={
                    "attempt": attempt,
                    "error_type": type(exc).__name__,
                    "error_slice": str(exc)[:_ERR_SLICE],
                },
            )
            raise

        attempt_in, attempt_out = _usage_tokens(response)
        tokens_in += attempt_in
        tokens_out += attempt_out

        text = _response_text(response)
        requirements = _extract_json(text)
        last_requirements = requirements

        if not requirements:
            last_errors = ["<root>: response was not valid JSON"]
        else:
            last_errors = _validate(requirements)

        log.info(
            "extract.attempt",
            extra={
                "attempt": attempt,
                "schema_valid": not last_errors,
                "tokens_in": attempt_in,
                "tokens_out": attempt_out,
                "error_slice": (last_errors[0][:_ERR_SLICE] if last_errors else ""),
            },
        )

        if not last_errors:
            return ExtractionResult(
                requirements=requirements,
                attempts=attempt,
                schema_valid=True,
                schema_errors=None,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            )

    return ExtractionResult(
        requirements=last_requirements,
        attempts=2,
        schema_valid=False,
        schema_errors=last_errors or ["unknown_schema_error"],
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
