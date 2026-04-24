-- 0006_phase3_awards_extraction.sql
-- Phase 3: add extraction tracking to awards.
-- The extractor runs against a source document (usually the award letter)
-- and populates `extracted_requirements` with a JSON blob matching
-- /starter/evals/schemas/reporting_requirements.json.
--
-- Idempotent: safe to re-run.

begin;

-- Link an award to the source document it was extracted from.
alter table awards
  add column if not exists source_document_id uuid references documents(id);

-- Populated by the worker `/extract/requirements` endpoint.
alter table awards
  add column if not exists extracted_requirements jsonb not null default '{}';

-- Extraction lifecycle:
--   pending        - award created, extraction not yet started
--   running        - worker is processing
--   ok             - schema-valid JSON returned; reports/report_fields created
--   manual_review  - extraction returned invalid schema twice, flagged for human
--   failed         - upstream error (network, LLM provider, etc.)
do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
  where t.relname = 'awards' and c.contype = 'c' and a.attname = 'extraction_status'
  limit 1;
  if cname is not null then
    execute 'alter table awards drop constraint ' || quote_ident(cname);
  end if;
end;
$$;

alter table awards
  add column if not exists extraction_status text not null default 'pending';
alter table awards
  add constraint awards_extraction_status_check
  check (extraction_status in ('pending','running','ok','manual_review','failed'));

alter table awards
  add column if not exists extraction_error text;

alter table awards
  add column if not exists extraction_attempts integer not null default 0;

alter table awards
  add column if not exists extraction_completed_at timestamptz;

create index if not exists awards_tenant_extraction on awards (tenant_id, extraction_status);

commit;
