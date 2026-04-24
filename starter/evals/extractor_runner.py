"""
Extractor runner helper for the Phase 3 golden-set eval harness.

Two modes:

1. Snapshot mode (default, used in CI):
   When the environment variable ``RUN_REAL_EVALS`` is not set to ``1``,
   ``run_extraction`` returns the contents of the committed
   ``snapshots/<case_id>.json`` verbatim. This lets CI exercise the
   scoring and schema-validation harness deterministically, without an
   Anthropic key or network access.

2. Real mode (for local founder runs):
   When ``RUN_REAL_EVALS=1`` and ``ANTHROPIC_API_KEY`` is set,
   ``run_extraction`` calls Claude via the Anthropic SDK with the
   Extractor prompt from ``/docs/07-prompts.md`` and returns the parsed
   JSON. Callers can inspect and, if happy, save the output as a new
   snapshot to pin CI.

This helper intentionally lives beside the test module and is not
imported by the worker. It is evaluation infrastructure.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).parent / "golden_extractor"
SNAPSHOT_DIR = GOLDEN_DIR / "snapshots"
SCHEMA_PATH = Path(__file__).parent / "schemas" / "reporting_requirements.json"


EXTRACTOR_SYSTEM_PROMPT = (
    "You extract federal and foundation grant reporting requirements from a "
    "parsed NOFO or award letter. You return JSON that exactly matches the "
    "schema supplied by the user. You never invent fields. When a requirement "
    "is absent from the source, you return null and include a short "
    "explanation in the \"uncertainties\" array.\n\n"
    "You cite page numbers for every field you extract. Your output will be "
    "validated by a JSON schema validator. If you cannot produce valid JSON, "
    "return an error object with an explanation."
)


def _user_prompt(parsed_document_text: str, json_schema: dict[str, Any]) -> str:
    return (
        "Parsed document:\n"
        "---\n"
        f"{parsed_document_text}\n"
        "---\n\n"
        "Extract the reporting requirements into this JSON schema:\n"
        f"{json.dumps(json_schema, indent=2)}\n\n"
        "Return only valid JSON. Include a \"citations\" array for each extracted "
        "field with the page number and a short quote from the source."
    )


def _load_snapshot(case_id: str) -> dict[str, Any]:
    path = SNAPSHOT_DIR / f"{case_id}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"No snapshot for case_id={case_id}. Run with RUN_REAL_EVALS=1 "
            f"to generate one, then commit it to {SNAPSHOT_DIR}."
        )
    return json.loads(path.read_text())


def _strip_code_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        if raw.endswith("```"):
            raw = raw[:-3]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return raw


def _call_anthropic(parsed_document_text: str) -> dict[str, Any]:
    import anthropic  # imported lazily so snapshot mode has no hard dep

    schema = json.loads(SCHEMA_PATH.read_text())
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=os.environ.get("EXTRACTOR_MODEL", "claude-sonnet-4-6"),
        max_tokens=8000,
        system=EXTRACTOR_SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": _user_prompt(parsed_document_text, schema)}
        ],
    )
    text = resp.content[0].text
    return json.loads(_strip_code_fences(text))


def run_extraction(letter_text: str, case_id: str) -> dict[str, Any]:
    """Return the extractor's output for one letter.

    ``case_id`` is the filename stem (e.g. ``01_rasmuson_legacy``) used to
    locate the committed snapshot. In snapshot mode the ``letter_text`` is
    not consumed, which is intentional. In real mode the snapshot is
    ignored and Claude is called with the letter text.
    """
    if os.environ.get("RUN_REAL_EVALS") == "1":
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "RUN_REAL_EVALS=1 but ANTHROPIC_API_KEY is not set."
            )
        return _call_anthropic(letter_text)
    return _load_snapshot(case_id)
