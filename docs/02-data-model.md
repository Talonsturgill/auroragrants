# 02 — Data Model

Every table has `tenant_id UUID NOT NULL` unless noted. Every table has `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. RLS is enabled on every table. The canonical RLS policy is:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

## Core tables

### tenants
Not tenant-scoped. Top-level table.

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('default', 'sovereignty')) DEFAULT 'default',
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'churned')) DEFAULT 'active',
  ein TEXT,
  org_type TEXT CHECK (org_type IN ('501c3', 'tribal_gov', 'tribal_nonprofit', 'ancsa_regional_nonprofit', 'municipality', 'other')),
  llm_provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (llm_provider IN ('anthropic', 'anthropic_zdr', 'openai', 'google')),
  llm_model_overrides JSONB NOT NULL DEFAULT '{}',
  zdr_enabled BOOLEAN NOT NULL DEFAULT false,
  data_residency TEXT NOT NULL DEFAULT 'us-west-2',
  sovereignty_addendum_signed_at TIMESTAMPTZ,
  monthly_token_budget_cents INTEGER NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### users
Not tenant-scoped directly (Clerk-managed). Join table below scopes them.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_users (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')) DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
```

### funders
Shared across tenants. Read-only for tenants. Only maintainers can write.

```sql
CREATE TABLE funders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('foundation', 'federal', 'state', 'tribal', 'corporate')),
  scope TEXT NOT NULL CHECK (scope IN ('national', 'regional', 'alaska', 'alaska_region')),
  website TEXT,
  portal_url TEXT,
  portal_type TEXT CHECK (portal_type IN ('proprietary', 'grants_gov', 'submittable', 'fluxx', 'smartsimple', 'email', 'pdf')),
  description TEXT,
  eligibility JSONB NOT NULL DEFAULT '{}',
  award_range_usd INT4RANGE,
  reporting_cadence TEXT CHECK (reporting_cadence IN ('none', 'final_only', 'annual', 'semiannual', 'quarterly', 'monthly')),
  rubric JSONB NOT NULL DEFAULT '[]',
  known_programs JSONB NOT NULL DEFAULT '[]',
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `rubric` column is a JSONB array of:
```json
[
  {
    "id": "community_impact",
    "label": "Community impact",
    "weight": 0.2,
    "description": "Describe measurable impact on Alaska communities.",
    "scoring": [{"score": 0, "desc": "..."}, {"score": 1, "desc": "..."}, {"score": 2, "desc": "..."}]
  }
]
```

### opportunities
Live RFPs a tenant is tracking.

```sql
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  funder_id UUID NOT NULL REFERENCES funders(id),
  title TEXT NOT NULL,
  program_name TEXT,
  source_url TEXT,
  nofo_document_id UUID REFERENCES documents(id),
  deadline TIMESTAMPTZ,
  award_min_usd INTEGER,
  award_max_usd INTEGER,
  status TEXT NOT NULL CHECK (status IN ('tracked', 'drafting', 'submitted', 'awarded', 'declined', 'skipped')) DEFAULT 'tracked',
  extracted_requirements JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON opportunities (tenant_id, deadline);
```

### awards
Grants actually received.

```sql
CREATE TABLE awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id),
  funder_id UUID NOT NULL REFERENCES funders(id),
  award_number TEXT,
  program_name TEXT NOT NULL,
  amount_usd BIGINT NOT NULL,
  awarded_at DATE,
  period_start DATE,
  period_end DATE,
  cfda_number TEXT,
  uei TEXT,
  pass_through BOOLEAN NOT NULL DEFAULT false,
  indirect_cost_rate NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### reports
A single reporting instance against an award.

```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  award_id UUID NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('upcoming', 'drafting', 'ready_for_review', 'submitted', 'accepted', 'revision_requested')) DEFAULT 'upcoming',
  report_type TEXT CHECK (report_type IN ('progress', 'final', 'financial', 'sf425', 'ppr', 'narrative', 'programmatic')),
  submission_format TEXT CHECK (submission_format IN ('portal', 'email', 'pdf', 'docx', 'grants_gov')),
  signer_user_id UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON reports (tenant_id, due_at);
CREATE INDEX ON reports (tenant_id, status);
```

### report_fields
Each narrative or structured field on a report.

```sql
CREATE TABLE report_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('narrative', 'number', 'currency', 'percentage', 'date', 'select', 'multiselect', 'table')),
  required BOOLEAN NOT NULL DEFAULT true,
  word_count_max INTEGER,
  word_count_min INTEGER,
  current_value TEXT,
  current_value_json JSONB,
  draft_value TEXT,
  last_draft_at TIMESTAMPTZ,
  last_draft_eval JSONB,
  human_reviewed BOOLEAN NOT NULL DEFAULT false,
  human_approved BOOLEAN NOT NULL DEFAULT false,
  approver_user_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  source_rubric_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, key)
);
```

### documents
Any file a tenant uploads (past proposals, NOFOs, annual reports, 990s).

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('nofo', 'past_proposal', 'past_report', 'annual_report', '990', 'budget', 'logic_model', 'other')),
  page_count INTEGER,
  parser TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('queued', 'parsing', 'parsed', 'failed')) DEFAULT 'queued',
  parse_error TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### document_chunks
Parsed text chunks with positions. One row per chunk.

```sql
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  section_heading TEXT,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('prose', 'table', 'list', 'heading', 'caption')) DEFAULT 'prose',
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX ON document_chunks USING GIN (to_tsvector('english', content));
```

### embeddings
3072-dimensional OpenAI text-embedding-3-large vectors.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  embedding VECTOR(3072) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON embeddings (tenant_id);
```

### drafts
Every AI generation. Immutable. New rows on every regenerate.

```sql
CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_field_id UUID NOT NULL REFERENCES report_fields(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]',
  wce_trace JSONB NOT NULL DEFAULT '{}',
  eval_scores JSONB NOT NULL DEFAULT '{}',
  eval_passed BOOLEAN NOT NULL DEFAULT false,
  model_writer TEXT NOT NULL,
  model_critic TEXT NOT NULL,
  model_editor TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  surfaced_to_user BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_field_id, version)
);
```

### audit_log
Append-only. One row per security-relevant action.

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON audit_log (tenant_id, created_at DESC);
```

Logged actions at minimum: `tenant.created`, `user.invited`, `user.removed`, `document.uploaded`, `document.deleted`, `draft.generated`, `draft.approved`, `report.submitted`, `export.requested`, `tenant.exported`, `tenant.deleted`, `sovereignty.agreement_signed`, `llm.provider_changed`.

### deadlines
Denormalized for the deadline agent.

```sql
CREATE TABLE deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('opportunity', 'report')),
  source_id UUID NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  notified_30d BOOLEAN NOT NULL DEFAULT false,
  notified_14d BOOLEAN NOT NULL DEFAULT false,
  notified_7d BOOLEAN NOT NULL DEFAULT false,
  notified_48h_sms BOOLEAN NOT NULL DEFAULT false,
  notified_1d BOOLEAN NOT NULL DEFAULT false,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON deadlines (due_at, acknowledged);
```

### token_usage
Per-tenant token spend, bucketed daily.

```sql
CREATE TABLE token_usage (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  model TEXT NOT NULL,
  tokens_in BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  cost_cents BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, date, model)
);
```

## RLS policies

For every table above except `tenants`, `users`, and `funders`:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON <table> FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_insert ON <table> FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_update ON <table> FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_delete ON <table> FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

For `funders`: `SELECT` is public (all authenticated users). `INSERT/UPDATE/DELETE` is restricted to the founder role via a separate policy checking `current_setting('app.is_founder', true) = 'true'`.

For `tenants` and `users`: application-level checks only; service role manages these tables.

## Tenant context setter

Every request must start with:
```sql
SELECT set_config('app.current_tenant', $1, true);
```

If `app.current_tenant` is not set, every policy fails closed because `NULL::uuid = NULL::uuid` is NULL (not true) and the `USING` clause rejects the row.

## Tests (must exist before Phase 2 ends)

- `tenant-isolation.sql` — inserts 2 tenants, 2 documents, switches context, confirms cross-tenant read returns 0 rows.
- `rls-enforced-on-all-tables.sql` — queries `pg_tables` to confirm RLS is enabled on every business table.
- `no-embeddings-across-tenants.sql` — vector similarity query from tenant A cannot return tenant B rows.
