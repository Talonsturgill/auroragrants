# 05 — Build Plan

Six phases. Execute in order. Each phase has a go/no-go checkpoint. Do not proceed without passing the checkpoint.

## Phase 1 — Foundations

### Scope
Next.js 15 App Router scaffold. Supabase project with RLS. Clerk auth with orgs. Marketing site shell at `/`. Authenticated app shell at `/app`. CI pipeline (GitHub Actions). No billing: the product is free.

### Tasks
1. `npx create-next-app@latest auroragrants --typescript --tailwind --app --src-dir --eslint --turbopack`
2. Install shadcn/ui: `npx shadcn@latest init`. Add `button card input label textarea select dialog dropdown-menu tabs toast table alert badge skeleton`.
3. Create Supabase project. Enable `pgvector`. Run the schema migration from `/docs/02-data-model.md`.
4. Enable RLS on every business table. Install the tenant context setter middleware in `/lib/supabase/server.ts`.
5. Integrate Clerk. Configure organizations. Map `clerk_org_id` to `tenants.clerk_org_id` via a webhook handler at `/api/webhooks/clerk`.
6. Marketing site `/` with sections: hero, problem, who-it-is-for, open-source commitments, sovereignty posture, founder note, notify-me form.
7. Authenticated app shell at `/app` with sidebar navigation: Dashboard, Deadlines, Opportunities, Awards, Reports, Documents, Settings.
8. GitHub Actions: lint, typecheck, unit tests, Playwright. A deploy step to Vercel is optional and only runs when `VERCEL_TOKEN` is configured.
9. Sentry wired for web and workers (env-gated noop when DSN absent). Axiom tracked as a follow-up.
10. Environment variable matrix documented in `.env.example`.

### Acceptance criteria
- A new user can sign up, create an organization in Clerk, and see an empty `/app` dashboard.
- The RLS isolation test (`tenant-isolation.spec.ts`) passes: creates two tenants, attempts cross-tenant read, expects zero rows.
- Marketing site renders at `/` without authentication and scores 95+ on Lighthouse performance.
- CI runs on a PR and blocks merge on any failure.

### Go/no-go
- [ ] Isolation test passes.
- [ ] Lighthouse 95+ on marketing.
- [ ] CI blocks merge on failure.

---

## Phase 2 — PDF parser bake-off and ingestion

### Scope
FastAPI service with three parser endpoints (Marker, pdfplumber, Unstructured). Golden set of 10 real Alaska NOFOs. Parser scorecard. Winner wired into the primary ingestion pipeline. Document upload flow. Embedding pipeline.

### Tasks
1. Create `/worker/` FastAPI service with Docker. Deploy to Fly.io.
2. Endpoints:
   - `POST /parse/marker` — returns structured markdown + page mapping.
   - `POST /parse/pdfplumber` — returns text + tables + page mapping.
   - `POST /parse/unstructured` — returns Unstructured's element list.
3. Golden set: 10 NOFOs in `/worker/golden_set/`. Suggested: Rasmuson Legacy LOI, 2 Denali program announcements, ICDBG NOFO, IHS BH Aide, AHFC QAP, Rasmuson Tier 1 instructions, MSHF guidelines, ACF Social Justice Fund, EPA PPG. Hand-labeled ground truth in `/worker/golden_set/ground_truth.yaml` with expected headings, table rows, and key fields (deadline, award range, eligibility).
4. Scorecard script `/worker/scripts/parser_bakeoff.py` computes table F1, heading hierarchy accuracy, and token efficiency per parser. Writes `parser_scorecard.md`.
5. Upload flow: `/app/documents` page with drag-drop. File uploads to Supabase Storage signed URL. A row is inserted into `documents` with `parse_status = 'queued'`. A Railway cron picks up queued rows and calls the chosen parser.
6. Chunking: after parsing, split into chunks of ~800 tokens with 100-token overlap. Preserve heading hierarchy. Insert into `document_chunks`.
7. Embedding: for each chunk, call OpenAI `text-embedding-3-large`. Insert into `embeddings`. Batch calls to reduce cost.
8. Funder seed: run the ingestion pipeline against the 30 funder guidelines PDFs from `/docs/04-funder-graph.md` and flag those chunks as funder-scoped, not tenant-scoped.
9. Hybrid retrieval: see `/starter/rag/` for the reference implementation.

### Acceptance criteria
- At least one parser achieves ≥0.85 table F1 and ≥0.90 heading hierarchy accuracy on the golden set.
- A user can upload a 60-page NOFO PDF and see its chunks + embeddings within 90 seconds.
- A test query (e.g., "What is the word count cap for the narrative section?") against an ingested Rasmuson Legacy PDF returns the correct chunk in the top 3 with citation metadata.

### Go/no-go
- [ ] Parser winner identified and wired.
- [ ] Golden-set ingestion completes end-to-end.
- [ ] Retrieval returns correct chunk on test query.

---

## Phase 3 — Compliance-report field extraction and dashboard

### Scope
Upload a NOFO or award letter. Extract reporting requirements. Populate `reports` and `report_fields`. Show a dashboard of upcoming reports.

### Tasks
1. `POST /api/awards` to register an award with an uploaded source document.
2. Extraction prompt (see `/docs/07-prompts.md#extractor`): given a parsed NOFO, return structured JSON with:
   - `reporting_cadence` (quarterly, annual, etc.)
   - `reports[]`: array of expected reports with `due_offset_days`, `period_months`, `format`, `narrative_sections[]`
   - Each `narrative_section`: `key`, `label`, `word_count_max`, `required`
3. On award creation, run extraction, create rows in `reports` with computed `due_at` based on `period_start` + `due_offset_days`.
4. For each report, create `report_fields` rows from the extracted narrative sections plus standard fields (program metrics, budget actuals, SF-425 if federal).
5. Dashboard at `/app/reports`: table of upcoming reports sorted by `due_at`, grouped by status. Filter by funder, award, status.
6. Report detail page at `/app/reports/[id]`: list of `report_fields` with status (not started, drafting, ready for review, approved, submitted).
7. Validation: the extractor must return JSON matching the schema in `/starter/evals/schemas/reporting_requirements.json`. On failure, retry once, then flag as "manual review required" and email the founder.

### Acceptance criteria
- Extraction JSON schema compliance ≥ 0.90 on a test set of 10 award letters.
- On uploading a real award letter, the correct set of reports with correct `due_at` appears in the dashboard.
- The dashboard correctly shows upcoming reports sorted by deadline.

### Go/no-go
- [ ] Schema compliance ≥ 0.90.
- [ ] Real award letter produces correct report schedule.
- [ ] Dashboard renders under 500ms for a tenant with 50 reports.

---

## Phase 4 — Compliance-report drafting with HITL

### Scope
Writer-Critic-Editor loop wired to real funder rubrics. Citation-grounded drafts. Evaluation harness enforced pre-surface. Draft banner and sign-off flow.

### Tasks
1. Wire the reference WCE loop from `/starter/wce/` into the `wce` FastAPI service.
2. `POST /api/report-fields/[id]/draft` triggers WCE on a single field.
3. Writer prompt: see `/docs/07-prompts.md#writer`. Retrieval: call the RAG service (`/starter/rag/`) to get top-5 chunks from the tenant's documents, plus the funder rubric.
4. Critic prompt: see `/docs/07-prompts.md#critic`. Scores each rubric item 0–2, scores overall 0–10, returns structured JSON of fixes.
5. Editor prompt: see `/docs/07-prompts.md#editor`. Applies Critic's fixes, preserves citations.
6. Score threshold: ≥ 8.0 surfaces to user. 6.0–7.9 surfaces with red-flag banner. < 6.0 does not surface.
7. Max iterations: 5.
8. On success, insert a `drafts` row with `content`, `citations`, `wce_trace`, `eval_scores`, and set `surfaced_to_user = true`.
9. Evaluation harness pre-surface: factuality, rubric adherence, hallucinated-program, readability, word count. See `/starter/evals/`.
10. UI:
    - Three-pane layout: left = field list, center = draft editor, right = critic feedback and citation panel.
    - Persistent banner: "Draft — review before submission."
    - Inline citations rendered as `[1]`, `[2]` with hover tooltip showing chunk excerpt and source doc.
    - "Regenerate" button on each field.
    - "Mark field approved" button requires the user to be the designated signer. Sets `human_approved = true`, `approver_user_id`, `approved_at`.
    - "Approve report and prepare export" button requires all required fields approved. Generates a PDF and DOCX export with the AI-content disclosure footer.
11. Export formats: PDF (WeasyPrint), DOCX (python-docx), funder-portal-ready plain text blocks (clipboard-friendly).
12. Audit log: every generate, approve, and export writes a row.

### Acceptance criteria
- On a real Rasmuson Legacy interim-report scenario, a design partner can draft and approve a full report in under 30 minutes end-to-end.
- Factuality score ≥ 0.95 on 90% of generated drafts across a 50-draft test set.
- Zero hallucinated program citations in a 100-draft stress test (regex + entity linking).
- Draft banner is visible at all times on every draft editor page.
- Approved export carries the AI-content disclosure footer.

### Go/no-go
- [ ] 30-minute end-to-end time achieved.
- [ ] Factuality ≥ 0.95 on 90% of drafts.
- [ ] Zero hallucinated program citations.

---

## Phase 5 — Deadline agent and onboarding flow

### Scope
Deadline agent cron job. First design-partner onboarding wizard. Weekly Deadline Radar email for every tenant.

### Tasks
1. Railway cron `deadline-agent` runs every hour:
   - For each row in `deadlines` where `due_at - now()` is within 30d, 14d, 7d, or 48h and the corresponding `notified_*` column is false, queue an email via Resend.
   - For 48h unacknowledged, queue a Twilio SMS to the organization's primary phone if provided.
   - Update the `notified_*` columns idempotently.
2. Deadline Radar weekly email: for each tenant, send a Monday 9am Alaska Time digest of the next 10 deadlines for funders they've subscribed to. No tier gating.
3. Acknowledgement link in email: unique signed URL that sets `deadlines.acknowledged = true` without requiring login.
4. Onboarding wizard at `/app/onboarding`:
   - Step 1: Organization info (name, EIN, org type, primary address, primary contact, phone).
   - Step 2: Upload past documents (annual report, 990, last 3 grant reports, logic model).
   - Step 3: Register active awards (manually or by uploading award letters).
   - Step 4: Choose funders to track (from the 30-funder graph).
   - Step 5: Invite team members.
   - Step 6: Deployment posture choice. Default is the shared hosted instance. Tribal organizations can request a Sovereignty deployment here.
5. Sovereignty-deployment additional steps (shown only when posture = sovereignty):
   - Step 7: TDUA signing (e-signature via HelloSign or similar, or manual PDF upload).
   - Step 8: Data residency selection.
   - Step 9: BYOK key registration.
   - Step 10: Advisory council contact.
6. White-glove import tool for design partners: founder can upload a ZIP on behalf of a tenant, map fields, and trigger ingestion.

### Acceptance criteria
- A design partner completes onboarding in under 45 minutes with founder support.
- Deadline emails land in inbox with acknowledgement links working.
- Weekly Deadline Radar email sends on schedule.
- Onboarding can be resumed if interrupted.

### Go/no-go
- [ ] Design partner A onboarded and actively drafting.
- [ ] Deadline emails sending and being acknowledged.
- [ ] Weekly digest delivered on the right schedule.

---

## Phase 6 — Tribal Sovereignty deployment readiness

### Scope
Dedicated Supabase provisioning, ZDR routing, offline export/import, BYOK, audit log export, 30-day deletion, TDUA flow.

### Tasks
1. Sovereignty provisioning script: given a tenant slug, provision a dedicated Supabase project via the Management API, run the schema migration, seed funders, and issue a `tenant_provisioning_complete` event. Update `tenants.data_residency` and connection metadata.
2. Provider routing: when `tenants.llm_provider = 'anthropic_zdr'`, route all Anthropic calls through the ZDR-enabled organization. Header verification: test that the response headers indicate ZDR scope.
3. Offline export: `POST /api/tenants/export` generates a signed download URL for a ZIP containing CSVs per table, documents, and parsed chunks. Hashes recorded in `audit_log`.
4. Offline import: `POST /api/tenants/import` accepts the same ZIP, validates schema version, inserts with conflict resolution strategy chosen by the user (overwrite, skip, merge).
5. BYOK: integrate AWS KMS customer-managed key references on Supabase Storage bucket for Sovereignty tenants. Verify encryption headers on object PUT.
6. Audit log export: `GET /api/tenants/audit-log.csv` returns the full audit log as CSV, scoped by tenant.
7. 30-day deletion: `POST /api/tenants/delete` triggers the full flow described in `/docs/03-sovereignty.md#30-day-deletion`.
8. TDUA flow: PDF template stored at `/public/tdua/v1.pdf`. Signed copy stored in `documents` with `kind = 'tdua'`. Hash recorded in `audit_log`.
9. Admin dashboard at `/admin/sovereignty` (founder-only) shows Sovereignty tenant provisioning status, ZDR verification timestamp, TDUA signature status.

### Acceptance criteria
- A Sovereignty tenant can be provisioned end-to-end in under 30 minutes of founder work.
- Export ZIP round-trips via import without data loss on a seeded tenant.
- ZDR headers confirmed in Anthropic responses for Sovereignty tenants.
- Audit log export is a valid CSV with every security-relevant action present.
- 30-day deletion dry-run completes without error and produces a deletion receipt.

### Go/no-go
- [ ] Provisioning script works on a test Sovereignty tenant.
- [ ] Export round-trip lossless.
- [ ] ZDR headers verified.
- [ ] Deletion receipt generated.

---

## Post-Phase-6

At this point v1 is shippable. Remaining month-1 items:
- Legal: ToS, Privacy Policy, DPA, TDUA reviewed by AK counsel.
- Foraker Group partnership application submitted.
- 10 warm-intro emails sent.
- At least one Alaska organization using the hosted instance in production.
- At least one tribal organization committed to a Sovereignty deployment.
- Self-hosting guide published at `docs/self-hosting.md`.
- Public status page at status.arcticintelligence.ai.
