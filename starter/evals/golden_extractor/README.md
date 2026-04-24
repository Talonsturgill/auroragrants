# Phase 3 Extractor Golden Set

This directory holds the Phase 3 acceptance-test fixtures for the
AuroraGrants extractor. The extractor reads a parsed NOFO or award
letter and returns structured JSON matching
`/starter/evals/schemas/reporting_requirements.json`.

## Acceptance target

Per `/docs/05-build-plan.md` Phase 3, the extractor must hit:

- Extraction JSON schema compliance >= 0.90 on the test set.
- avg field-match F1 >= 0.75 on the same set.

The build plan calls for 10 letters. This starter golden set contains
5. With 5 cases, the 0.90 schema-compliance target rounds to "at
least 4 of 5 cases must validate." The remaining 5 letters can be added
incrementally without changing the harness.

## Layout

```
golden_extractor/
  letters/            5 synthetic award letters in Markdown
  ground_truth/       expected extractor output per letter, hand-written
  snapshots/          frozen extractor output per letter, used in CI
  README.md           this file
```

Every file is keyed by the same 2-digit case id, e.g.
`01_rasmuson_legacy.md`, `ground_truth/01_rasmuson_legacy.json`,
`snapshots/01_rasmuson_legacy.json`.

## The 5 cases

| ID | Funder | Program | Amount | Period | Cadence |
|----|--------|---------|-------:|-------:|---------|
| 01 | Rasmuson Foundation | Legacy Grant | $100,000 | 12 mo | 1 final narrative |
| 02 | Bureau of Indian Affairs | Tribal Youth Initiative (CFDA 15.141) | $250,000 | 24 mo | quarterly PPR + final + semi-annual SF-425 |
| 03 | Alaska DHSS (Behavioral Health) | Tribal Behavioral Health | $500,000 | 36 mo | annual progress + annual financial |
| 04 | Alaska Community Foundation | Arts Project Fund | $25,000 | 6 mo | 1 final report |
| 05 | HRSA | Rural Health Care Services Outreach (CFDA 93.912) | $750,000 | 36 mo | annual PPR + semi-annual SF-425 + final comprehensive |

## Running the harness

### Snapshot mode (default, used in CI)

No API key required. Reads the committed `snapshots/*.json` as the
extractor's output and scores it against the ground truth. This is a
self-test of the scoring and schema validation.

```
pytest starter/evals/test_extractor.py -v
```

### Real mode (for local founder runs)

Calls Claude via the Anthropic SDK using the Extractor prompt from
`/docs/07-prompts.md`. Use this when changing the extractor prompt or
model to measure the real metrics.

```
RUN_REAL_EVALS=1 ANTHROPIC_API_KEY=sk-ant-... pytest starter/evals/test_extractor.py -v
```

The model is configurable via `EXTRACTOR_MODEL` (default
`claude-sonnet-4-5`).

## Adding a new letter

1. Write `letters/NN_<slug>.md`. It should read like a real award
   letter. 300-600 words. Do not include a literal JSON block. Follow
   the house style (no em dashes, no semicolons, no colons in body).
2. Hand-write `ground_truth/NN_<slug>.json`. It must validate against
   `/starter/evals/schemas/reporting_requirements.json`. The harness
   asserts this at collection time, so a schema error will fail
   `test_ground_truth_validates_against_schema`.
3. Run in real mode once to capture the extractor's actual output.
   Inspect it. If it matches expectations, copy it to
   `snapshots/NN_<slug>.json` and commit. If it does not match and the
   mismatch is an extractor bug rather than a ground-truth flaw, log
   the bug and fix the extractor before committing a snapshot.
4. Commit all three files together so CI stays consistent.

## Scoring

Two metrics per extraction:

- `schema_valid` (bool) -- jsonschema validation passed.
- `field_match_f1` (float 0-1) -- mean of six equally weighted
  sub-scores:
  1. `award_summary.program_name` (case-insensitive exact)
  2. `award_summary.funder_name` (case-insensitive exact)
  3. `award_summary.period_months` (int exact)
  4. `reports[*].report_type` (multiset F1)
  5. `reports[*].due_offset_days` (multiset F1)
  6. union of `narrative_sections[*].key` across all reports (set F1)

Aggregate:

- `schema_compliance = (# schema_valid) / N`
- `avg_field_f1 = mean(field_match_f1)`

The test `test_aggregate_gate` asserts
`schema_compliance >= 0.9 and avg_field_f1 >= 0.75`. A per-case
parametrized test prints individual failures for easier triage.
