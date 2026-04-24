-- 0004_indexed_status.sql
-- Adds 'indexed' to parse_status and indexed_at column to documents.
-- Required by worker/app/ingest/storage.py mark_document_indexed().

begin;

-- Drop the auto-generated inline check constraint (PostgreSQL names it
-- {table}_{column}_check). Use dynamic SQL to handle name variations.
do $$
declare
  cname text;
begin
  select c.conname into cname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
  where t.relname = 'documents' and c.contype = 'c' and a.attname = 'parse_status'
  limit 1;

  if cname is not null then
    execute 'alter table documents drop constraint ' || quote_ident(cname);
  end if;
end;
$$;

alter table documents
  add constraint documents_parse_status_check
  check (parse_status in ('queued','parsing','parsed','indexed','failed'));

alter table documents
  add column if not exists indexed_at timestamptz;

commit;
