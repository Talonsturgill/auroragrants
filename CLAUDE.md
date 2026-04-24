# CLAUDE.md — AuroraGrants Build Plan

You are Claude Code. You are building **AuroraGrants**, an Alaska-specific AI grant-operations platform, in a single working session. The founder is a solo AI engineer. You are the only engineer. There is no team to hand work off to. Build the whole v1 today.

AuroraGrants is **open source** under Apache-2.0. It is **free for every organization**. There are no paid tiers. The Sovereignty deployment posture remains as an architectural and contractual commitment for tribal organizations, not a paywall.

Read this file first. Then read every file in `/docs/` in order. Then read `/starter/` for the three subsystems that have reference implementations. Then build.

## Non-negotiables

- **Open source, no paywall.** The entire codebase is Apache-2.0. Do not reintroduce Stripe, paid tiers, seat limits, or feature gating behind payment. Forks may commercialize if they want to, but the upstream product is free.
- **Human-in-the-loop by default.** Every AI-generated narrative or compliance field is a draft. The UI must label it "Draft — review before submission" and require an explicit user sign-off before export. This is a legal requirement (False Claims Act exposure), not a style choice. Do not remove the banner under any circumstances.
- **Citation-grounded output.** Every AI-generated sentence in a narrative must carry an inline `[source: doc_id, page, chunk]` tag rendered as a hover tooltip. If the Writer cannot cite a source, it must say so rather than invent one.
- **Tenant isolation is a correctness property, not a feature.** Every table has `tenant_id` with Supabase RLS enforced. Every query filters by tenant. Every embedding namespace is per-tenant. No exceptions.
- **Envelope compliance.** Stack is fixed. Do not swap components. If something is not in the envelope, it is not allowed.
- **No em dashes, semicolons, or colons in AI-generated user-facing content.** Use periods and commas. This is the founder's explicit style rule. It applies to prompts in `/docs/07-prompts.md` but not to code comments or docs.
- **Surgical precision.** Only change what the current task specifies. If you notice an unrelated issue, log it in `/docs/followups.md`, do not fix it inline.

## The stack (fixed)

- Frontend: Next.js 15 App Router, React 19, Tailwind, shadcn/ui, TypeScript
- Backend: Next.js API routes for thin endpoints, Python FastAPI for heavy PDF parsing and the Writer-Critic-Editor loop
- Database: Supabase Postgres with pgvector and Row Level Security
- Auth: Clerk with organization support
- Billing: none. The product is free. Do not add Stripe or any paywall.
- LLMs: Claude Sonnet 4.5 as primary, Claude Opus 4.5 for Critic on high-stakes drafts, Claude Haiku 4.5 for cheap classification, GPT-5 and Gemini 2.5 Pro wired as fallback providers behind a per-tenant flag
- Embeddings: OpenAI text-embedding-3-large
- Reranker: Cohere rerank-english-v3
- PDF parsing: Marker as primary, pdfplumber as fallback, LlamaParse only if table F1 on the golden set falls below 0.85
- Email: Resend for transactional, Postmark for compliance-critical
- SMS: Twilio for deadline reminders only
- Hosting: Vercel for web, Fly.io for Python workers, Railway for background jobs
- Storage: Supabase Storage with signed URLs

Do not introduce new dependencies without logging the reason in `/docs/followups.md` and pausing for founder review.

## The product in one paragraph

AuroraGrants helps Alaska nonprofits and tribal organizations manage post-award federal and foundation grant compliance reporting. It is free and open source under Apache-2.0. Any organization can use the hosted instance or self-host. Tribal organizations can additionally request a **Sovereignty deployment** with dedicated infrastructure, ZDR routing, BYOK encryption, offline export, and a pre-signed Tribal Data Use Agreement at no cost. The v1 hero is post-award compliance reporting. Proposal drafting ships as v1.1 in month 3. Funder discovery ships as v2 in month 6.

## What you are building today

The six-week build plan in `/docs/05-build-plan.md` is organized as six phases, not six calendar weeks. Execute all six phases in one session. Stop at each phase's go/no-go checkpoint, run the listed acceptance tests, and only proceed if they pass. The phases are:

1. Foundations (Next.js, Supabase, Clerk, marketing site shell, CI)
2. PDF parser bake-off and ingestion pipeline (parser evaluation, funder graph seed, embedding pipeline)
3. Compliance-report field extraction and dashboard (the v1 hero)
4. Compliance-report drafting with human-in-the-loop (Writer-Critic-Editor loop wired to real funder rubrics)
5. Deadline agent and first design-partner onboarding flow
6. Tribal Sovereignty deployment readiness (DPA wiring, ZDR routing, offline export/import, audit log, tenant export and delete)

## How to work

- Work one phase at a time. Do not start Phase 2 before Phase 1's acceptance tests pass.
- Write tests first for any business logic that touches tenant isolation, citations, or compliance-field extraction. Playwright for end-to-end, Vitest for unit, pytest for Python.
- Commit at every phase boundary with a message that names the phase and the passing acceptance tests.
- When something is ambiguous, prefer the simpler option and log the decision in `/docs/decisions.md`.
- When you finish a phase, append a status line to `/docs/build-log.md` with the phase number, the time, and the test results.

## Files in this repo

- `CLAUDE.md` — this file.
- `README.md` — public-facing repo description.
- `LICENSE` — Apache License 2.0.
- `NOTICE` — copyright and contributor notices.
- `/docs/00-mission.md` — what and why.
- `/docs/01-architecture.md` — system design and module boundaries.
- `/docs/02-data-model.md` — full Supabase schema with RLS policies.
- `/docs/03-sovereignty.md` — tribal data sovereignty requirements and the Sovereignty deployment's contractual and architectural posture.
- `/docs/04-funder-graph.md` — the 30 AK funders to seed, their rubrics, their reporting cadences, and their eligibility rules.
- `/docs/05-build-plan.md` — the six-phase plan with acceptance criteria per phase.
- `/docs/06-eval-harness.md` — the evaluation harness every AI output must pass before surfacing.
- `/docs/07-prompts.md` — the canonical Writer, Critic, Editor, Extractor, and Deadline prompts.
- `/docs/08-ui-spec.md` — page-by-page UI spec, including the Draft banner and citation tooltip contracts.
- `/docs/09-acceptance-criteria.md` — the single source of truth for "done."
- `/starter/rag/` — reference implementation of the hybrid BM25 plus vector retrieval with Cohere rerank.
- `/starter/wce/` — reference implementation of the Writer-Critic-Editor loop with score thresholds and iteration caps.
- `/starter/evals/` — reference implementation of the factuality, rubric-adherence, hallucinated-program, readability, and word-count checks.

Begin with `/docs/00-mission.md` and read forward.
