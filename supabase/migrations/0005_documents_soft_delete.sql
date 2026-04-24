-- 0005_documents_soft_delete.sql
-- Adds deleted_at for soft-delete support used by the Documents API.

begin;

alter table documents
  add column if not exists deleted_at timestamptz;

-- Rebuild the select policy to exclude soft-deleted rows.
-- The policy created by 0001's DO loop is named documents_sel_select.
drop policy if exists documents_sel_select on documents;
create policy documents_sel_select on documents
  for select using (
    tenant_id = current_tenant_id()
    and deleted_at is null
  );

commit;
