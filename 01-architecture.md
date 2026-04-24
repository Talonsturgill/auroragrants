# 01 — Architecture

## Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Vercel (Next.js 15)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  Marketing   │  │  App (auth)  │  │  API routes (thin)       │   │
│  │  /           │  │  /app/*      │  │  /api/*                  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────────┘
                         │ signed RPC, service-role JWT
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Fly.io (FastAPI)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  Parser svc  │  │  WCE loop    │  │  Eval harness            │   │
│  │  (Marker,    │  │  (Writer,    │  │  (factuality,            │   │
│  │   pdfplumber)│  │   Critic,    │  │   rubric, readability,   │   │
│  │              │  │   Editor)    │  │   hallucinated-program)  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Supabase (Postgres + pgvector)                   │
│  RLS-enforced tenant isolation, embeddings, documents, reports,     │
│  funders, opportunities, audit_log, storage                         │
└─────────────────────────────────────────────────────────────────────┘

          ┌──────────────────┐    ┌──────────────────┐
          │  Railway (cron)  │    │  External APIs   │
          │  Deadline agent, │    │  Anthropic,      │
          │  funder scraper, │    │  OpenAI embed,   │
          │  email/SMS       │    │  Cohere rerank,  │
          │                  │    │  Stripe, Clerk,  │
          │                  │    │  Resend, Postmark│
          │                  │    │  Twilio          │
          └──────────────────┘    └──────────────────┘
```

## Module boundaries

### Web (Next.js)
- Thin. No business logic beyond auth gating, form validation, and display.
- All heavy work (PDF parsing, extraction, drafting, eval) is RPC to FastAPI.
- Server components for data fetching. Client components for interactivity.
- shadcn/ui for every interactive element. No custom design system.

### API gateway (Next.js API routes)
- Validates request shape with Zod.
- Verifies Clerk session.
- Loads tenant from Clerk org metadata.
- Issues signed JWT to FastAPI with `tenant_id` claim.
- Never touches Supabase directly for tenant data. Always routes through FastAPI or uses Supabase client with RLS.

### Workers (FastAPI on Fly.io)
- Three services in one codebase, deployed as one container initially.
  - `parser` — PDF ingestion and chunking.
  - `wce` — Writer-Critic-Editor loop.
  - `evals` — factuality, rubric, readability, hallucination checks.
- Stateless. All state in Supabase. All secrets via env.
- Uses Supabase service-role key but enforces tenant scoping via `tenant_id` WHERE clause on every query and in every prompt.

### Cron (Railway)
- `deadline-agent` — runs every hour, scans `reports` and `opportunities` for upcoming deadlines, queues emails and SMS.
- `funder-scraper` — runs daily, polls Rasmuson, Denali Commission, ACF, MSHF, AHFC for RFP updates.
- `nightly-evals` — runs per tenant, samples 5 drafts, recomputes eval scores for drift detection.

### External APIs
- Anthropic Messages API — Sonnet 4.5 by default. Opus 4.5 for high-stakes Critic. Haiku 4.5 for classification. ZDR routing enabled on Tribal Sovereignty tier.
- OpenAI embeddings only. No OpenAI chat by default. GPT-5 is a per-tenant fallback.
- Cohere rerank-english-v3.
- Stripe Checkout and Billing Portal. No custom payment UI.
- Clerk for auth and org management.
- Resend for non-compliance email. Postmark for compliance-critical email (audit trail required).
- Twilio for SMS deadline reminders only.

## Multi-tenancy model

- One tenant = one customer organization.
- Clerk organization maps 1:1 to a `tenants` row via `clerk_org_id`.
- Every business table has `tenant_id UUID NOT NULL` with an RLS policy: `USING (tenant_id = current_setting('app.current_tenant')::uuid)`.
- Before every query, the API layer calls `SELECT set_config('app.current_tenant', $1, true)`.
- Test: a Playwright suite named `tenant-isolation.spec.ts` attempts cross-tenant reads and asserts they return zero rows. This suite must pass before every commit.

## Provider routing

- Per-tenant `llm_provider` enum: `anthropic` (default), `anthropic_zdr` (Sovereignty), `openai`, `google`.
- Per-tenant `llm_model_override` map: `{ writer: "claude-sonnet-4-5", critic: "claude-opus-4-5", classifier: "claude-haiku-4-5" }`.
- Sovereignty tier forces `anthropic_zdr`. No override.

## Failure modes and budgets

| Failure | User impact | Mitigation |
|---|---|---|
| PDF parser hangs on malformed NOFO | User sees loading spinner | 60s timeout, retry with pdfplumber, surface error |
| Claude rate limit | Draft generation fails | Exponential backoff to 4 retries, then fall back to GPT-5 with banner |
| Supabase down | App unusable | Vercel status banner, queue writes to local Redis (Railway) for retry |
| Stripe webhook lost | Subscription state stale | Nightly reconciliation job |
| Embedding cost spike | Unit economics break | Per-tenant monthly token budget, alert at 80%, hard-cap at 100% |

## Security posture

- No customer data in logs. PII-scrubbing middleware on every log line.
- All PDFs stored in Supabase Storage with signed URLs, 15-minute expiry.
- Database backups encrypted at rest (Supabase default) and weekly off-site to Fly.io volume for Sovereignty tier.
- No third-party analytics scripts in the authenticated app. Marketing site only.
- CSP headers enforced via `next.config.js`.
- All external API calls must include a `x-tenant-id` header for audit.

## Observability

- Sentry for errors (web + workers).
- Supabase logs for DB queries.
- Axiom or similar for structured logs (tenant_id, action, duration, tokens, cost).
- A `/admin` route restricted to founder email shows per-tenant token spend, eval drift, and deadline queue depth.
