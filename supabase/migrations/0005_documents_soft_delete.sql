-- 0005_documents_soft_delete.sql
-- Adds deleted_at for soft-delete support used by the Documents API.

begin;

alter table documents
  add column if not exists deleted_at timestamptz;

-- Exclude soft-deleted rows from the existing RLS select policy.
drop policy if exists documents_select on documents;
create policy documents_select on documents
  for select using (
    tenant_id = current_setting('app.current_tenant', true)::uuid
    and deleted_at is null
  );

commit;
