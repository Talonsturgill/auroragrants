-- AuroraGrants initial schema.
-- Every business table has tenant_id + RLS.
-- See /docs/02-data-model.md for the full spec.
--
-- Run: supabase db push

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ----- core ----------------------------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text unique not null,
  name text not null,
  slug text unique not null,
  tier text not null check (tier in ('free','solo','team','institutional','sovereignty')) default 'free',
  status text not null check (status in ('active','paused','churned')) default 'active',
  ein text,
  org_type text check (org_type in ('501c3','tribal_gov','tribal_nonprofit','ancsa_regional_nonprofit','municipality','other')),
  llm_provider text not null default 'anthropic' check (llm_provider in ('anthropic','anthropic_zdr','openai','google')),
  llm_model_overrides jsonb not null default '{}',
  zdr_enabled boolean not null default false,
  data_residency text not null default 'us-west-2',
  sovereignty_addendum_signed_at timestamptz,
  monthly_token_budget_cents integer not null default 10000,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);

create table tenant_users (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')) default 'editor',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- ----- funders (shared reference data) --------------------------------------

create table funders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  type text not null check (type in ('foundation','federal','state','tribal','corporate')),
  scope text not null check (scope in ('national','regional','alaska','alaska_region')),
  website text,
  portal_url text,
  portal_type text check (portal_type in ('proprietary','grants_gov','submittable','fluxx','smartsimple','email','pdf')),
  description text,
  eligibility jsonb not null default '{}',
  award_min_usd integer,
  award_max_usd integer,
  reporting_cadence text check (reporting_cadence in ('none','final_only','annual','semiannual','quarterly','monthly')),
  rubric jsonb not null default '[]',
  known_programs jsonb not null default '[]',
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----- tenant-scoped -------------------------------------------------------

create table documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funder_id uuid references funders(id),
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null,
  sha256 text not null,
  kind text not null check (kind in ('nofo','past_proposal','past_report','annual_report','990','budget','logic_model','tdua','other')),
  page_count integer,
  parser text,
  parse_status text not null check (parse_status in ('queued','parsing','parsed','failed')) default 'queued',
  parse_error text,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  funder_id uuid references funders(id),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  page_start integer,
  page_end integer,
  section_heading text,
  content text not null,
  content_type text not null check (content_type in ('prose','table','list','heading','caption')) default 'prose',
  token_count integer,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  check ((tenant_id is not null) or (funder_id is not null))
);

create index document_chunks_tsv_idx on document_chunks using gin (to_tsvector('english', content));
create index document_chunks_tenant_idx on document_chunks (tenant_id);

create table embeddings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  funder_id uuid references funders(id),
  document_chunk_id uuid not null references document_chunks(id) on delete cascade,
  model text not null default 'text-embedding-3-large',
  embedding vector(3072) not null,
  created_at timestamptz not null default now(),
  check ((tenant_id is not null) or (funder_id is not null))
);

create index embeddings_hnsw on embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_tenant_idx on embeddings (tenant_id);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  funder_id uuid not null references funders(id),
  title text not null,
  program_name text,
  source_url text,
  nofo_document_id uuid references documents(id),
  deadline timestamptz,
  award_min_usd integer,
  award_max_usd integer,
  status text not null check (status in ('tracked','drafting','submitted','awarded','declined','skipped')) default 'tracked',
  extracted_requirements jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_tenant_deadline on opportunities (tenant_id, deadline);

create table awards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid references opportunities(id),
  funder_id uuid not null references funders(id),
  award_number text,
  program_name text not null,
  amount_usd bigint not null,
  awarded_at date,
  period_start date,
  period_end date,
  cfda_number text,
  uei text,
  pass_through boolean not null default false,
  indirect_cost_rate numeric(5,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  award_id uuid not null references awards(id) on delete cascade,
  title text not null,
  period_start date not null,
  period_end date not null,
  due_at timestamptz not null,
  submitted_at timestamptz,
  status text not null check (status in ('upcoming','drafting','ready_for_review','submitted','accepted','revision_requested')) default 'upcoming',
  report_type text check (report_type in ('progress','final','financial','sf425','ppr','narrative','programmatic')),
  submission_format text check (submission_format in ('portal','email','pdf','docx','grants_gov')),
  signer_user_id uuid references users(id),
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reports_tenant_due on reports (tenant_id, due_at);
create index reports_tenant_status on reports (tenant_id, status);

create table report_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  key text not null,
  label text not null,
  field_type text not null check (field_type in ('narrative','number','currency','percentage','date','select','multiselect','table')),
  required boolean not null default true,
  word_count_max integer,
  word_count_min integer,
  current_value text,
  current_value_json jsonb,
  draft_value text,
  last_draft_at timestamptz,
  last_draft_eval jsonb,
  human_reviewed boolean not null default false,
  human_approved boolean not null default false,
  approver_user_id uuid references users(id),
  approved_at timestamptz,
  source_rubric_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, key)
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_field_id uuid not null references report_fields(id) on delete cascade,
  version integer not null,
  content text not null,
  citations jsonb not null default '[]',
  wce_trace jsonb not null default '{}',
  eval_scores jsonb not null default '{}',
  eval_passed boolean not null default false,
  model_writer text not null,
  model_critic text not null,
  model_editor text not null,
  iterations integer not null,
  tokens_in integer not null,
  tokens_out integer not null,
  cost_cents integer not null,
  surfaced_to_user boolean not null default false,
  created_at timestamptz not null default now(),
  unique (report_field_id, version)
);

create table deadlines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_type text not null check (source_type in ('opportunity','report')),
  source_id uuid not null,
  due_at timestamptz not null,
  notified_30d boolean not null default false,
  notified_14d boolean not null default false,
  notified_7d boolean not null default false,
  notified_48h_sms boolean not null default false,
  notified_1d boolean not null default false,
  acknowledged boolean not null default false,
  acknowledged_by uuid references users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deadlines_due_ack on deadlines (due_at, acknowledged);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}',
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_tenant_time on audit_log (tenant_id, created_at desc);

create table token_usage (
  tenant_id uuid not null references tenants(id) on delete cascade,
  date date not null,
  model text not null,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_cents bigint not null default 0,
  primary key (tenant_id, date, model)
);

create table prompt_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade, -- null = global
  name text not null,
  version integer not null,
  content text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, name, version)
);

-- Deletion receipts survive tenant deletion for our own audit.
create table deletion_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null,
  tenant_name text not null,
  deleted_at timestamptz not null default now(),
  final_audit_export_sha256 text,
  reason text
);

-- ----- RLS helpers ----------------------------------------------------------

create or replace function set_current_tenant(tenant_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select set_config('app.current_tenant', tenant_id::text, true);
$$;

create or replace function current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_tenant', true), '')::uuid;
$$;

-- ----- enable RLS and apply policies ---------------------------------------

alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table embeddings enable row level security;
alter table opportunities enable row level security;
alter table awards enable row level security;
alter table reports enable row level security;
alter table report_fields enable row level security;
alter table drafts enable row level security;
alter table deadlines enable row level security;
alter table audit_log enable row level security;
alter table token_usage enable row level security;
alter table prompt_versions enable row level security;

-- Tenant-scoped tables get standard isolation.
do $$
declare t text;
begin
  for t in select unnest(array[
    'documents','opportunities','awards','reports','report_fields',
    'drafts','deadlines','audit_log','token_usage'
  ]) loop
    execute format($p$
      create policy %I_select on %I for select
        using (tenant_id = current_tenant_id());
      create policy %I_insert on %I for insert
        with check (tenant_id = current_tenant_id());
      create policy %I_update on %I for update
        using (tenant_id = current_tenant_id())
        with check (tenant_id = current_tenant_id());
      create policy %I_delete on %I for delete
        using (tenant_id = current_tenant_id());
    $p$, t||'_sel', t, t||'_ins', t, t||'_upd', t, t||'_del', t);
  end loop;
end$$;

-- document_chunks and embeddings: readable when either tenant matches OR funder-scoped.
create policy chunks_select on document_chunks for select
  using (tenant_id = current_tenant_id() or tenant_id is null);
create policy chunks_insert on document_chunks for insert
  with check (
    tenant_id = current_tenant_id()
    or (tenant_id is null and current_setting('app.is_founder', true) = 'true')
  );
create policy chunks_update on document_chunks for update
  using (tenant_id = current_tenant_id());
create policy chunks_delete on document_chunks for delete
  using (tenant_id = current_tenant_id());

create policy embeddings_select on embeddings for select
  using (tenant_id = current_tenant_id() or tenant_id is null);
create policy embeddings_insert on embeddings for insert
  with check (
    tenant_id = current_tenant_id()
    or (tenant_id is null and current_setting('app.is_founder', true) = 'true')
  );
create policy embeddings_update on embeddings for update
  using (tenant_id = current_tenant_id());
create policy embeddings_delete on embeddings for delete
  using (tenant_id = current_tenant_id());

-- prompt_versions: null tenant (global) readable by all; tenant override readable by owner.
create policy prompts_select on prompt_versions for select
  using (tenant_id is null or tenant_id = current_tenant_id());
create policy prompts_mod on prompt_versions for all
  using (
    (tenant_id is null and current_setting('app.is_founder', true) = 'true')
    or tenant_id = current_tenant_id()
  )
  with check (
    (tenant_id is null and current_setting('app.is_founder', true) = 'true')
    or tenant_id = current_tenant_id()
  );

-- funders: public read for authenticated users; writes founder-only.
alter table funders enable row level security;
create policy funders_select on funders for select using (true);
create policy funders_write on funders for all
  using (current_setting('app.is_founder', true) = 'true')
  with check (current_setting('app.is_founder', true) = 'true');

-- updated_at triggers
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'tenants','documents','opportunities','awards','reports','report_fields','funders','deadlines'
  ]) loop
    execute format(
      'create trigger %I_uat before update on %I
       for each row execute procedure set_updated_at();',
      t, t
    );
  end loop;
end$$;
