"""
Phase 3 extractor golden-set eval harness.

Runs the extractor (real Anthropic call when ``RUN_REAL_EVALS=1``, or a
committed snapshot otherwise) against five synthetic award letters and
scores each extraction on two metrics.

Metrics per case:
  - schema_valid (bool): output validates against reporting_requirements.json
  - field_match_f1 (float, 0-1): F1 over a union of key-field multisets
    vs. ground truth.

Aggregate across the 5 cases:
  - schema_compliance = (# schema_valid) / 5
  - avg_field_f1 = mean(field_match_f1)

Acceptance gate (treated as "at least 4 of 5 schema-valid"):
  schema_compliance >= 0.90
  avg_field_f1      >= 0.75

See ``golden_extractor/README.md`` for how to add a new letter or
refresh the snapshots.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft7Validator, validate

from starter.evals.extractor_runner import GOLDEN_DIR, SCHEMA_PATH, run_extraction


LETTERS_DIR = GOLDEN_DIR / "letters"
GROUND_TRUTH_DIR = GOLDEN_DIR / "ground_truth"


# --- Loading --------------------------------------------------------------


def _case_ids() -> list[str]:
    ids = sorted(p.stem for p in LETTERS_DIR.glob("*.md"))
    assert ids, "no letters found in golden_extractor/letters"
    return ids


def _load_case(case_id: str) -> tuple[str, dict[str, Any]]:
    letter = (LETTERS_DIR / f"{case_id}.md").read_text()
    ground_truth = json.loads((GROUND_TRUTH_DIR / f"{case_id}.json").read_text())
    return letter, ground_truth


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    data = json.loads(SCHEMA_PATH.read_text())
    Draft7Validator.check_schema(data)
    return data


@pytest.fixture(scope="module")
def cases() -> list[tuple[str, str, dict[str, Any]]]:
    out: list[tuple[str, str, dict[str, Any]]] = []
    for cid in _case_ids():
        letter, gt = _load_case(cid)
        out.append((cid, letter, gt))
    return out


# --- Ground-truth self-check ---------------------------------------------


@pytest.mark.parametrize("case_id", _case_ids())
def test_ground_truth_validates_against_schema(case_id: str) -> None:
    """Every committed ground-truth JSON must itself validate.

    This guards against typos in the hand-written ground truth.
    """
    schema = json.loads(SCHEMA_PATH.read_text())
    data = json.loads((GROUND_TRUTH_DIR / f"{case_id}.json").read_text())
    validate(instance=data, schema=schema)


# --- Scoring --------------------------------------------------------------


def _multiset_f1(pred: list[Any], truth: list[Any]) -> float:
    """F1 over multisets. Both empty counts as 1.0."""
    pc = Counter(pred)
    tc = Counter(truth)
    if not pc and not tc:
        return 1.0
    tp = sum((pc & tc).values())
    fp = sum((pc - tc).values())
    fn = sum((tc - pc).values())
    if tp == 0:
        return 0.0
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    return 2 * precision * recall / (precision + recall)


def _set_f1(pred: set[Any], truth: set[Any]) -> float:
    if not pred and not truth:
        return 1.0
    tp = len(pred & truth)
    fp = len(pred - truth)
    fn = len(truth - pred)
    if tp == 0:
        return 0.0
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    return 2 * precision * recall / (precision + recall)


def _str_eq(a: Any, b: Any) -> float:
    if a is None or b is None:
        return 1.0 if a == b else 0.0
    return 1.0 if str(a).strip().lower() == str(b).strip().lower() else 0.0


def _int_eq(a: Any, b: Any) -> float:
    if a is None or b is None:
        return 1.0 if a == b else 0.0
    try:
        return 1.0 if int(a) == int(b) else 0.0
    except (TypeError, ValueError):
        return 0.0


def compute_field_match_f1(pred: dict[str, Any], truth: dict[str, Any]) -> float:
    """Weighted F1 across the key fields, each weighted equally.

    Fields compared:
      1. award_summary.program_name (case-insensitive exact)
      2. award_summary.funder_name (case-insensitive exact)
      3. award_summary.period_months (int exact)
      4. reports[*].report_type as multiset
      5. reports[*].due_offset_days as multiset
      6. narrative_sections[*].key across all reports as set
    """
    pred_summary = pred.get("award_summary", {}) or {}
    truth_summary = truth.get("award_summary", {}) or {}

    pred_reports = pred.get("reports", []) or []
    truth_reports = truth.get("reports", []) or []

    scores: list[float] = []

    scores.append(
        _str_eq(pred_summary.get("program_name"), truth_summary.get("program_name"))
    )
    scores.append(
        _str_eq(pred_summary.get("funder_name"), truth_summary.get("funder_name"))
    )
    scores.append(
        _int_eq(pred_summary.get("period_months"), truth_summary.get("period_months"))
    )

    scores.append(
        _multiset_f1(
            [r.get("report_type") for r in pred_reports],
            [r.get("report_type") for r in truth_reports],
        )
    )
    scores.append(
        _multiset_f1(
            [r.get("due_offset_days") for r in pred_reports],
            [r.get("due_offset_days") for r in truth_reports],
        )
    )

    pred_keys: set[str] = set()
    for r in pred_reports:
        for ns in r.get("narrative_sections", []) or []:
            k = ns.get("key")
            if k:
                pred_keys.add(k)
    truth_keys: set[str] = set()
    for r in truth_reports:
        for ns in r.get("narrative_sections", []) or []:
            k = ns.get("key")
            if k:
                truth_keys.add(k)
    scores.append(_set_f1(pred_keys, truth_keys))

    return sum(scores) / len(scores)


def score_case(
    case_id: str,
    letter: str,
    ground_truth: dict[str, Any],
    schema: dict[str, Any],
) -> tuple[bool, float]:
    extracted = run_extraction(letter, case_id)
    try:
        validate(instance=extracted, schema=schema)
        schema_valid = True
    except Exception:
        schema_valid = False
    f1 = compute_field_match_f1(extracted, ground_truth)
    return schema_valid, f1


# --- Per-case parametrized test (visibility) ------------------------------


@pytest.mark.parametrize("case_id", _case_ids())
def test_case_is_schema_valid(case_id: str, schema: dict[str, Any]) -> None:
    """Individual per-case visibility: every case should be schema-valid.

    Aggregate gate in ``test_aggregate_gate`` is the canonical acceptance
    criterion. This test gives a clearer error message when one case
    regresses.
    """
    letter, _gt = _load_case(case_id)
    extracted = run_extraction(letter, case_id)
    validate(instance=extracted, schema=schema)


# --- Aggregate gate -------------------------------------------------------


def test_aggregate_gate(
    cases: list[tuple[str, str, dict[str, Any]]],
    schema: dict[str, Any],
) -> None:
    """Acceptance: schema_compliance >= 0.90 and avg_field_f1 >= 0.75.

    With a 5-case set, 0.90 means at least 4 of 5 cases must validate.
    """
    valid_count = 0
    f1s: list[float] = []
    per_case: dict[str, dict[str, Any]] = {}

    for case_id, letter, gt in cases:
        schema_valid, f1 = score_case(case_id, letter, gt, schema)
        per_case[case_id] = {"schema_valid": schema_valid, "field_match_f1": f1}
        if schema_valid:
            valid_count += 1
        f1s.append(f1)

    n = len(cases)
    schema_compliance = valid_count / n
    avg_f1 = sum(f1s) / n if f1s else 0.0

    report = {
        "n": n,
        "schema_compliance": schema_compliance,
        "avg_field_f1": avg_f1,
        "per_case": per_case,
    }
    # Printed for CI log visibility (pytest -s or -rA)
    print(json.dumps(report, indent=2))

    assert schema_compliance >= 0.9, (
        f"schema_compliance {schema_compliance:.2f} below 0.90 target. "
        f"Per-case: {per_case}"
    )
    assert avg_f1 >= 0.75, (
        f"avg_field_f1 {avg_f1:.2f} below 0.75 target. "
        f"Per-case: {per_case}"
    )
