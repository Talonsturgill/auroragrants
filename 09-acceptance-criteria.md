# 09 — Acceptance Criteria

This is the single source of truth for "done." A phase is not complete until every box here is checked. A commit that adds new features must not uncheck any box.

## Cross-cutting

- [ ] RLS enabled on every business table.
- [ ] `tenant-isolation.spec.ts` passes: cross-tenant reads return zero rows.
- [ ] No PII or customer content in logs. Verified by a grep over 1 week of production logs.
- [ ] Draft banner visible on every draft editor page.
- [ ] Every exported document carries the AI-content disclosure footer.
- [ ] CI passes: lint, typecheck, unit, Playwright, Python pytest.
- [ ] Lighthouse performance ≥ 90 on marketing and ≥ 85 on `/app/reports`.
- [ ] Every AI call records tokens and cost to `token_usage`.
- [ ] Sentry captures errors from web and workers.

## Phase 1 — Foundations

- [ ] Next.js 15 App Router scaffold with TypeScript and Tailwind.
- [ ] shadcn/ui installed with the baseline component set.
- [ ] Supabase project with `pgvector` enabled.
- [ ] Schema migration applied matching `/docs/02-data-model.md`.
- [ ] RLS policies in place on every business table.
- [ ] Clerk auth configured with organizations.
- [ ] `/api/webhooks/clerk` creates a `tenants` row on organization creation.
- [ ] Stripe products created (Solo, Team, Institutional, Sovereignty).
- [ ] `/api/billing/checkout` returns a valid Stripe Checkout URL.
- [ ] `/api/webhooks/stripe` updates `tenants.tier` on subscription change.
- [ ] Marketing site renders with hero, problem, who, tiers, sovereignty, founder note, waitlist form, footer.
- [ ] Authenticated app shell with sidebar navigation.
- [ ] GitHub Actions workflow lints, typechecks, runs tests, deploys to Vercel.

## Phase 2 — Parser bake-off and ingestion

- [ ] FastAPI worker deployed to Fly.io with three parser endpoints.
- [ ] 10 NOFOs hand-labeled as ground truth in YAML.
- [ ] `parser_bakeoff.py` produces a scorecard.
- [ ] Winner selected: at least one parser with ≥0.85 table F1 and ≥0.90 heading hierarchy.
- [ ] Document upload flow working end-to-end.
- [ ] Chunking produces 800-token chunks with 100-token overlap preserving headings.
- [ ] Embeddings inserted into `embeddings` with correct `tenant_id`.
- [ ] 30 funder seed PDFs ingested and chunked.
- [ ] Hybrid retrieval (BM25 + vector + rerank) returns correct chunk in top 3 on 20-query test set.
- [ ] Tenant isolation verified on embedding queries.

## Phase 3 — Extraction and dashboard

- [ ] Extractor prompt produces JSON matching schema on 90% of 10 test award letters.
- [ ] Award creation populates `reports` and `report_fields` correctly.
- [ ] `/app/reports` dashboard renders in under 500ms for 50-report tenant.
- [ ] Report detail page shows all fields with correct status.
- [ ] Extraction failures route to "manual review required" and alert founder.

## Phase 4 — Compliance drafting with HITL

- [ ] Writer-Critic-Editor loop wired and running.
- [ ] Score threshold 8.0 enforced. 6.0–7.9 surfaces with red-flag banner. Under 6.0 blocks surface.
- [ ] Max 5 iterations enforced.
- [ ] Factuality score ≥ 0.95 on 90% of 50-draft test set.
- [ ] Zero hallucinated program citations on 100-draft stress test.
- [ ] Word count compliance within 95–105%.
- [ ] Inline citations render with hover tooltips showing source chunk.
- [ ] "Mark field approved" requires signer attestation confirmation.
- [ ] "Approve report and prepare export" requires all required fields approved.
- [ ] Export produces PDF, DOCX, and clipboard text with AI disclosure footer.
- [ ] End-to-end time on a real Rasmuson Legacy interim report is under 30 minutes for a design partner.

## Phase 5 — Deadlines and onboarding

- [ ] Deadline cron runs hourly and sends 30d, 14d, 7d, 48h SMS, 1d notifications idempotently.
- [ ] Weekly Deadline Radar digest delivered on Monday 9am Alaska Time.
- [ ] Acknowledgement links work without login.
- [ ] Onboarding wizard 6 steps (or 10 for Sovereignty) completable in 45 minutes with founder support.
- [ ] Onboarding state persists across resume.
- [ ] White-glove ZIP import works for design partner data migration.

## Phase 6 — Sovereignty

- [ ] Sovereignty provisioning script creates dedicated Supabase in under 30 minutes.
- [ ] Offline export ZIP round-trips via import without loss.
- [ ] ZDR headers verified on Anthropic responses for Sovereignty tenants.
- [ ] BYOK key registered and confirmed on Storage PUT.
- [ ] TDUA signed and hashed in audit log.
- [ ] Audit log CSV export validates.
- [ ] 30-day deletion dry-run produces deletion receipt.

## Business readiness (runs in parallel to Phases 4–6)

- [ ] Alaska LLC formed.
- [ ] Alaska business license.
- [ ] Municipality of Anchorage business license.
- [ ] ToS, Privacy Policy, DPA drafted.
- [ ] TDUA template drafted.
- [ ] AK counsel has reviewed contracts.
- [ ] E&O, cyber, GL insurance quoted (bind before first Institutional contract).
- [ ] Foraker Partner application submitted.
- [ ] 10 warm-intro emails sent.
- [ ] 20 discovery calls completed.
- [ ] 2 design-partner LOIs signed.

## Ship checklist (before first paying tenant)

- [ ] All Phase 1–5 criteria met.
- [ ] Sovereignty criteria met only if a Sovereignty tenant is being onboarded.
- [ ] Production Supabase and Vercel projects live.
- [ ] Stripe in live mode.
- [ ] Public DNS pointing to Vercel with SSL.
- [ ] Status page at status.arcticintelligence.ai with an "operational" indicator.
- [ ] Backup policy documented and tested (nightly Supabase backup + weekly off-site to Fly.io volume).
- [ ] On-call runbook for common incidents (LLM outage, parser hang, Stripe webhook failure, Clerk outage).
- [ ] Founder has run through the full onboarding flow as a test user.
- [ ] Founder has drafted and submitted one real compliance report via the product.
