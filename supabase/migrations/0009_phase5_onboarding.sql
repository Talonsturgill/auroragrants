-- 0009_phase5_onboarding.sql
-- Phase 5B: onboarding wizard, funder subscriptions, sovereignty sub-flow.
--
-- Adds to tenants:
--   onboarding_completed_at timestamptz  (null = not done)
--   onboarding_step          int         (last completed step 1-6, resumable)
--   data_residency           text        ('shared'|'dedicated')
--   sovereignty_requested    boolean
--   tdua_signed_at           timestamptz
--   byok_key_arn             text
--   advisory_contact         text        (name + email free-form)
--
-- Adds table: tenant_funder_subscriptions (which funders a tenant tracks)
--
-- Idempotent: safe to re-run.

begin;

-- ----- tenants org-info columns added by Phase 5B ---------------------------
-- primary_phone already added in 0008. Add address and contact columns here.

alter table tenants
  add column if not exists primary_address text;

alter table tenants
  add column if not exists primary_contact_name text;

alter table tenants
  add column if not exists primary_contact_email text;

-- ----- tenants onboarding columns -------------------------------------------

alter table tenants
  add column if not exists onboarding_completed_at timestamptz;

alter table tenants
  add column if not exists onboarding_step int not null default 1;

-- data_residency here means 'shared' vs 'dedicated' infra posture (distinct
-- from the existing tenants.data_residency us-region column which tracks AWS
-- region). We use a different semantic: 'shared' = default hosted instance,
-- 'dedicated' = sovereignty deployment with dedicated infra.
-- Rename the new column to avoid collision with the existing column.
alter table tenants
  add column if not exists deployment_posture text
    check (deployment_posture in ('shared','dedicated')) default 'shared';

alter table tenants
  add column if not exists sovereignty_requested boolean not null default false;

alter table tenants
  add column if not exists tdua_signed_at timestamptz;

alter table tenants
  add column if not exists byok_key_arn text;

alter table tenants
  add column if not exists advisory_contact text;

-- ----- tenant_funder_subscriptions ------------------------------------------

create table if not exists tenant_funder_subscriptions (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  funder_id    uuid not null references funders(id) on delete cascade,
  subscribed_at timestamptz not null default now(),
  primary key (tenant_id, funder_id)
);

alter table tenant_funder_subscriptions enable row level security;

-- Use the same helper used in all other tenant-scoped tables.
drop policy if exists tfs_select on tenant_funder_subscriptions;
drop policy if exists tfs_insert on tenant_funder_subscriptions;
drop policy if exists tfs_update on tenant_funder_subscriptions;
drop policy if exists tfs_delete on tenant_funder_subscriptions;

create policy tfs_select on tenant_funder_subscriptions for select
  using (tenant_id = current_tenant_id());
create policy tfs_insert on tenant_funder_subscriptions for insert
  with check (tenant_id = current_tenant_id());
create policy tfs_update on tenant_funder_subscriptions for update
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());
create policy tfs_delete on tenant_funder_subscriptions for delete
  using (tenant_id = current_tenant_id());

commit;
