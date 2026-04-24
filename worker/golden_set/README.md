# Golden set — parser bake-off

This folder holds the ground-truth labels and fixtures used by the Phase 2
parser bake-off described in `/docs/05-build-plan.md`.

The goal is to pick one of Marker, pdfplumber, or Unstructured as the
primary PDF parser for AuroraGrants by scoring each of them against ten
hand-labeled Alaska NOFOs.

## Layout

```
worker/golden_set/
  README.md                         this file
  ground_truth.yaml                 labels for the 10 real NOFOs
  pdfs/                             drop the real PDFs here (gitignored)
  fixtures/
    build_synthetic.py              pure-stdlib PDF generator
    synthetic_nofo.pdf              4-page synthetic fixture
    synthetic_nofo.ground_truth.yaml labels for the fixture
```

## Running the bake-off

From the repo root:

```
python worker/scripts/parser_bakeoff.py
```

This loads `ground_truth.yaml`, iterates every PDF in `pdfs/` plus the
synthetic fixture, calls each parser that is importable, and writes
`worker/parser_scorecard.md`.

Flags:

- `--dry-run` — skip parsing, just confirm the scaffolding works.
- `--only marker|pdfplumber|unstructured` — run one parser.
- `--pdfs-dir <path>` — point at a different directory of PDFs.

The bake-off always exits 0. It is a benchmark, not a gate. The CI gate
lives in `/docs/06-eval-harness.md`.

## The 10 target NOFOs

The list mirrors the build plan in `/docs/05-build-plan.md` and uses the
slugs from `/docs/04-funder-graph.md` where available.

| # | Slug | Funder | Source |
|---|------|--------|--------|
| 1 | `rasmuson-legacy-loi` | Rasmuson Foundation Legacy LOI | https://rasmuson.org/find-funding/legacy-grants/ |
| 2 | `rasmuson-tier-1-instructions` | Rasmuson Foundation Tier 1 | https://rasmuson.org/find-funding/tier-1-grants/ |
| 3 | `denali-commission-program-1` | Denali Commission program announcement (first) | https://denali.gov/grants/ |
| 4 | `denali-commission-program-2` | Denali Commission program announcement (second) | https://denali.gov/grants/ |
| 5 | `hud-icdbg-nofo` | HUD ICDBG NOFO | https://www.hud.gov/program_offices/public_indian_housing/ih/grants/icdbg |
| 6 | `ihs-bh-aide-nofo` | IHS Behavioral Health Aide | https://www.ihs.gov/behavioralhealth/ |
| 7 | `ahfc-qap` | AHFC Qualified Allocation Plan | https://www.ahfc.us/pros/grants-financing/low-income-housing-tax-credit |
| 8 | `mshf-healthy-impact-guidelines` | Mat-Su Health Foundation Healthy Impact | https://www.healthymatsu.org/how-we-fund/grant-programs |
| 9 | `acf-social-justice-fund` | Alaska Community Foundation Social Justice Fund | https://alaskacf.org/grants/ |
| 10 | `epa-ppg-nofo` | EPA Tribal Performance Partnership Grants | https://www.epa.gov/grants |

## How to add the real PDFs

1. Download each PDF from the source URL above.
2. Rename it to `<slug>.pdf` (the slug column in the table).
3. Place it in `worker/golden_set/pdfs/`.
4. Open `ground_truth.yaml` and update any field that does not match the
   downloaded PDF (page count, headings, tables, deadline).
5. Run `python worker/scripts/parser_bakeoff.py` from the repo root.
6. Review `worker/parser_scorecard.md`.

The `pdfs/` directory is intentionally empty in git. The PDFs are
downloaded at evaluation time so the repo stays small and so we avoid
caching a stale copy of a NOFO that has since been revised by its funder.

## Ground-truth labeling conventions

- Headings are labeled in the order they appear in the document. The
  scorer checks each expected heading as a substring match and is
  case-insensitive.
- Tables are labeled at the detection level. An expected table at page 3
  with `n_rows: 4, n_cols: 2` means "the parser should identify a table
  on page 3 with roughly that shape." Exact row/col counts are a
  tie-breaker, not a pass-fail.
- `eligibility_keywords` is a small set of anchor phrases that must
  appear somewhere in the extracted text.
- `deadline: "rolling"` means no fixed deadline. `null` means unknown at
  labeling time and the NOFO sets a specific date.

## Updating labels

If a funder publishes a new version of a NOFO, update the ground truth
and bump the `version:` field at the top of `ground_truth.yaml`. The
scorecard records the ground-truth version it was run against.
