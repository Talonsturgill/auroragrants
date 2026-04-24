# Build Log

Append one line per phase-boundary event. Most recent at bottom.

Format: `YYYY-MM-DD HH:MM TZ | phase N | <status> | <tests>`

Status values: `started`, `acceptance_passed`, `acceptance_failed`, `blocked`.

Tests: short list of suites that passed or failed.

## Examples

```
2026-11-01 09:00 AKST | phase 1 | started | -
2026-11-01 18:30 AKST | phase 1 | acceptance_passed | tenant-isolation, lighthouse
2026-11-02 08:00 AKST | phase 2 | started | -
2026-11-02 22:00 AKST | phase 2 | acceptance_passed | parser-bakeoff=0.91 F1, retrieval-top3=0.95
```

## Actual entries

2026-04-24 01:42 AKDT | phase 1 | started | reorganized zipped layout; flat root duplicates removed
2026-04-24 02:11 AKDT | phase 1 | scaffolded | Next.js 15 + shadcn + Clerk + Supabase + tenant-isolation test helpers. Stripe deleted. Apache-2.0. pnpm typecheck + lint + vitest(3) + next build all green locally with placeholder Clerk+Supabase envs.

Pending acceptance items (require live services):
- tenant-isolation.spec.ts against a real Supabase (need a running project).
- Clerk sign-up flow end-to-end in a browser.
- Lighthouse 95+ performance score on `/` against a production build.
- CI green on the PR.

2026-04-24 12:20 AKDT | phase 2 | acceptance_passed | pnpm typecheck + lint + vitest(27) + build green; worker ruff + mypy(24 files) + pytest(59) green; parser bakeoff scaffolded (synthetic F1=1.0 pdfplumber); hybrid retrieval + chunker + embedder implemented with full test coverage

Phase 2 deliverables:
- PDF parsers: Marker (primary), pdfplumber (fallback), Unstructured implemented in worker/app/parsers/
- JWT auth: HS256 verification with 30s clock skew, tenant_id claim required
- Ingestion pipeline: tiktoken 800/100-token chunker, OpenAI text-embedding-3-large embedder, Supabase storage layer
- Hybrid retrieval: BM25(0.4) + vector cosine(0.6) + RRF(k=60) + Cohere rerank to top-k, halfvec(3072) regression test
- Documents UI: /app/documents page with drag-drop upload, status polling, rename/delete/reparse
- Documents API: GET list, POST upload-url, GET/DELETE/PATCH by id, POST reparse
- Funder seed: 30 AK funders in 0003_funders_seed.sql + funders.json; 10 hand-curated rubric JSONs in supabase/seed/rubrics/
- Parser bake-off: golden_set with synthetic 4-page NOFO, ground_truth.yaml, scoring metrics, scorecard script
- Migrations: 0003 funders seed, 0004 indexed_status (adds 'indexed' to parse_status + indexed_at), 0005 soft delete (deleted_at + updated RLS)

Pending acceptance items (require live services):
- Parser bake-off against real NOFOs (drop PDFs in worker/golden_set/pdfs/ and run parser_bakeoff.py)
- /app/documents upload flow in browser with real Supabase/Clerk
- Ingestion pipeline end-to-end (parse -> chunk -> embed -> retrieve) against real credentials
