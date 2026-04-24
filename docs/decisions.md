# Decisions Log

When Claude Code encounters ambiguity, records the decision here rather than guessing twice. Format: date, phase, decision, rationale.

## Template

```
## YYYY-MM-DD — Phase N — <short title>

**Decision:** <what was decided>
**Rationale:** <why>
**Alternatives considered:** <what else>
**Reversible?** <yes/no and under what conditions>
```

## Examples to follow

## 2026-11-01 — Phase 1 — Clerk vs Supabase Auth

**Decision:** Clerk.
**Rationale:** Clerk has first-class Organizations primitive that maps cleanly to `tenants`. Supabase Auth would require custom org-membership tables and more middleware.
**Alternatives considered:** Supabase Auth with custom org schema; Auth.js with database adapter.
**Reversible?** Yes at high cost. Would require rewriting auth middleware and migrating user IDs.

## 2026-11-01 — Phase 2 — Parser primary

**Decision:** <TBD after bake-off>
**Rationale:** <after running parser_bakeoff.py>
**Alternatives considered:** Marker, pdfplumber, Unstructured, LlamaParse.
**Reversible?** Yes. Parser is a pluggable service.

## 2026-04-24 — Phase 1 — Open source, Apache-2.0, no paid tiers

**Decision:** The entire product is open source under Apache-2.0. There are no paid tiers. Stripe is deleted from the codebase. The Sovereignty deployment remains as a posture for tribal organizations, not a paywall.
**Rationale:** Founder directive. The reporting burden on Alaska tribes and nonprofits is a public problem. Closing the fix behind a paywall would contradict the CARE-aligned sovereignty commitments and the "public tool for a public problem" framing. Apache-2.0 gives a patent grant, broad enterprise compatibility, and wide commercial adoption.
**Alternatives considered:** (a) MIT — no patent grant. (b) AGPL-3.0 — strong copyleft, protects against proprietary cloud forks but narrows enterprise adoption. (c) BSL → Apache-2.0 — commercial-first, converts later. (d) Keep the hybrid OSS-core / paid-SaaS model. The founder chose full free OSS with Apache-2.0.
**Reversible?** Apache-2.0 is a permanent grant to anyone who already received the code. Future versions could relicense, but existing contributors and users keep their rights to the current code forever. Reintroducing paid tiers would require removing the no-paywall commitment from CLAUDE.md and a new decision entry here.

## 2026-04-24 — Phase 1 — Next.js scaffold at repo root, not /web/

**Decision:** The Next.js 15 app lives at the repo root. The FastAPI worker lives at `/worker/`. Starters at `/starter/`. Docs at `/docs/`. Supabase at `/supabase/`.
**Rationale:** The canonical layout in the shipped `.github/workflows/ci.yml` runs `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` at repo root with no working-directory override. Moving the web app under `/web/` would have required rewriting CI and every starter import path.
**Alternatives considered:** Monorepo with `/web/` and `/worker/` siblings. More explicit but requires CI rewrites and is not what the seed layout assumed.
**Reversible?** Yes. Migration to `/web/` is mechanical if we ever want Turborepo or Nx.

## 2026-04-24 — Phase 2 — Add openai, cohere, supabase, tiktoken to requirements-ci.txt

**Decision:** The ingest and retrieve modules import `openai`, `cohere`, `supabase`, and `tiktoken` at module top-level. These are already pinned in `worker/requirements.txt` at the versions the Phase 2 tests run against. To keep `pytest -q` green in the `worker` CI job without duplicating code with lazy imports, we mirror those pins into `worker/requirements-ci.txt` (openai 1.57.4, cohere 5.13.3, supabase 2.10.0, tiktoken 0.8.0).
**Rationale:** The tests use respx + mocked clients and never hit a real API, but the modules they import still need the SDK types at import time. Lazy-importing inside every function adds complexity for no observable benefit when respx already isolates the network.
**Alternatives considered:** (a) Keep requirements-ci.txt minimal and lazy-import each SDK inside functions. Rejected: adds 4 `import` lines per function, fragments mypy types, and costs clarity. (b) Gate tests with `pytest.importorskip` so CI silently skips them. Rejected: the task explicitly requires >=20 tests passing, not skipping.
**Reversible?** Yes, trivially.
