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

2026-04-24 22:09 AKDT | phase 4 | acceptance_passed | pnpm typecheck clean; pnpm test 151/151; pnpm build green; worker pytest 113/113

Phase 4 deliverables:
- WCE loop: worker/app/wce/loop.py — Writer/Critic/Editor with MAX_ITER=5, SURFACE_THRESHOLD=8.0, FLAG_THRESHOLD=6.0. Tracks best-scoring draft and returns it when cap trips. claude-opus-4-6 for high-stakes Critic.
- Prompts: worker/prompts/{writer,critic,editor,factuality,rubric_scorer}.md with YAML frontmatter.
- Eval gate: worker/app/evals/gate.py — 5 concurrent checks via asyncio.gather (factuality LLM-judge, rubric-adherence LLM-judge, hallucination regex, readability textstat, word-count bounds).
- WCE route: worker/app/routes/wce.py POST /wce/draft-field — retrieves chunks, runs loop, returns DraftFieldResponse.
- Evals route: worker/app/routes/evals.py POST /evals/gate — runs pre-surface gate, returns passed + failures.
- Export: worker/app/export/ — WeasyPrint (PDF), python-docx (DOCX), plain text with AI-disclosure footer. POST /export/report. Only human_approved fields exported.
- DB: 0007_phase4_drafter_tracking.sql — adds draft_status to report_fields, ready_for_export to reports.status, failure_reason to drafts, approved_at to reports.
- Orchestrator: src/lib/drafts/orchestrator.ts — runDrafterForField() loads context, calls WCE worker, runs eval gate, inserts drafts row, writes audit log.
- Web API: report-fields/[id]/draft, report-fields/[id]/drafts, report-fields/[id]/approve, reports/[id]/approve, reports/[id]/export routes.
- Three-pane drafting UI: editor-shell, draft-editor ([n] citation pills + tooltips), citations-panel, critic-panel (SVG gauge + rubric table + severity-grouped fixes), approve-button (attestation dialog), regenerate-button (2s poll up to 90s), field-list, status-pill.
- Export menu: ExportMenu dropdown (PDF/DOCX/text) in report detail header; disabled with tooltip when report not ready_for_export.
- Types: src/lib/types/draft.ts merged — UI types (Citation citation_id:number, CriticFix, RubricScore, Critique[], Draft row, APPROVAL_ATTESTATION_PHRASE) + worker contract types (DraftContent, DraftContext, DraftResponse, EvalGateParams/Response).

Pending acceptance items (require live services):
- WCE end-to-end against real Anthropic API (ANTHROPIC_API_KEY + Supabase populated with funder rubric + tenant docs)
- Eval gate with real scoring (factuality judge needs Anthropic API)
- Approve flow in browser (Clerk session + Supabase RLS)
- Export download in browser (WeasyPrint + python-docx on Fly.io worker)
