-- 0004_indexed_status.sql
-- Adds 'indexed' to parse_status and indexed_at column to documents.
-- Required by worker/app/ingest/storage.py mark_document_indexed().

begin;

alter table documents
  drop constraint if exists documents_parse_status_check;

alter table documents
  add constraint documents_parse_status_check
  check (parse_status in ('queued','parsing','parsed','indexed','failed'));

alter table documents
  add column if not exists indexed_at timestamptz;

commit;
