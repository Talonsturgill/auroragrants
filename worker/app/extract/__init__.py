"""Structured extraction of reporting requirements from parsed NOFOs.

See /docs/05-build-plan.md Phase 3 for the spec. The Extractor calls
Claude Sonnet with the canonical prompt in /worker/prompts/extractor.md
and validates the response against the JSON schema in
/starter/evals/schemas/reporting_requirements.json.
"""

from app.extract.extractor import ExtractionResult, extract_reporting_requirements

__all__ = ["ExtractionResult", "extract_reporting_requirements"]
