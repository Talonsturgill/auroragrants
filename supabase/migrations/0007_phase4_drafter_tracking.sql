-- 0007_phase4_drafter_tracking.sql
-- Phase 4: drafter lifecycle tracking.
--
-- The `drafts` table already exists from 0001_initial.sql. This migration
-- only adds missing columns and broadens the `reports.status` check
-- constraint to include `ready_for_export`.
--
-- Idempotent: safe to re-run.

begin;

-- ----- report_fields.draft_status ------------------------------------------
-- Lifecycle for the Writer-Critic-Editor loop on a single field:
--   idle              - no draft in progress
--   drafting          - worker is running WCE now
--   failed            - worker or eval-gate errored; see drafts.failure_reason
--   ready_for_review  - latest surfaced draft awaits human review
--   approved          - signer attested the field; see report_fields.approved_at

alter table report_fields
  add column if not exists draft_status text not null default 'idle';

do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
  where t.relname = 'report_fields'
    and c.contype = 'c'
    and a.attname = 'draft_status'
  limit 1;
  if cname is not null then
    execute 'alter table report_fields drop constraint ' || quote_ident(cname);
  end if;
end;
$$;

alter table report_fields
  add constraint report_fields_draft_status_check
  check (draft_status in ('idle','drafting','failed','ready_for_review','approved'));

-- Track when the signer attested so the export step can render the
-- AI-content disclosure footer with the right timestamps.
alter table report_fields
  add column if not exists human_reviewed boolean not null default false;

-- ----- reports.status: add ready_for_export --------------------------------
-- The Phase 4 signer flow transitions `reports.status` from
-- `ready_for_review` to `ready_for_export` after every required field is
-- approved. The existing check constraint in 0001 does not include
-- `ready_for_export`; drop and re-add with the expanded set.

do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
  where t.relname = 'reports'
    and c.contype = 'c'
    and a.attname = 'status'
  limit 1;
  if cname is not null then
    execute 'alter table reports drop constraint ' || quote_ident(cname);
  end if;
end;
$$;

alter table reports
  add constraint reports_status_check
  check (status in (
    'upcoming',
    'drafting',
    'ready_for_review',
    'ready_for_export',
    'submitted',
    'accepted',
    'revision_requested'
  ));

-- Track when the report was approved for export; separate from
-- submitted_at which records the actual submission to the funder.
alter table reports
  add column if not exists approved_at timestamptz;

-- ----- drafts.failure_reason ----------------------------------------------
-- Non-null when the surface decision was block or the eval gate failed.
-- Stores a short summary (under 500 chars) of why the draft is not being
-- shown to the user. See src/lib/drafts/orchestrator.ts#summarizeFailure.

alter table drafts
  add column if not exists failure_reason text;

commit;
