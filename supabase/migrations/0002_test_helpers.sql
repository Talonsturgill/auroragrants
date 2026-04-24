-- Helpers for the tenant-isolation Playwright suite.
-- Safe to apply in any environment; callers are gated by the service role.
--
-- The suite at tests/e2e/tenant-isolation.spec.ts calls:
--   rpc.seed_isolation_test_tenants()
--   rpc.cleanup_isolation_test_tenants()
--   rpc.clear_current_tenant()
--   rpc.isolation_test_vector_search(query_tenant uuid)
-- set_current_tenant is defined in 0001_initial.sql.

create or replace function clear_current_tenant()
returns void
language sql
security definer
set search_path = public
as $$
  select set_config('app.current_tenant', '', true);
$$;

-- Seeds two tenants (A, B) plus one document and five chunks each with one
-- embedding each. Returns the two tenant UUIDs for the test to reference.
create or replace function seed_isolation_test_tenants()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_a uuid;
  tenant_b uuid;
  doc_a uuid;
  doc_b uuid;
  i integer;
begin
  insert into tenants (clerk_org_id, name, slug)
  values ('iso_test_a', 'Isolation Test A', 'iso-test-a')
  on conflict (clerk_org_id) do update set name = excluded.name
  returning id into tenant_a;

  insert into tenants (clerk_org_id, name, slug)
  values ('iso_test_b', 'Isolation Test B', 'iso-test-b')
  on conflict (clerk_org_id) do update set name = excluded.name
  returning id into tenant_b;

  insert into documents (tenant_id, filename, mime_type, size_bytes, storage_path, sha256, kind)
  values (tenant_a, 'a.pdf', 'application/pdf', 1, 'iso/a.pdf', 'sha-a', 'other')
  returning id into doc_a;

  insert into documents (tenant_id, filename, mime_type, size_bytes, storage_path, sha256, kind)
  values (tenant_b, 'b.pdf', 'application/pdf', 1, 'iso/b.pdf', 'sha-b', 'other')
  returning id into doc_b;

  for i in 0..4 loop
    insert into document_chunks (tenant_id, document_id, chunk_index, content)
    values (tenant_a, doc_a, i, 'tenant a chunk ' || i);
    insert into document_chunks (tenant_id, document_id, chunk_index, content)
    values (tenant_b, doc_b, i, 'tenant b chunk ' || i);
  end loop;

  return json_build_object('tenant_a_id', tenant_a, 'tenant_b_id', tenant_b);
end;
$$;

create or replace function cleanup_isolation_test_tenants()
returns void
language sql
security definer
set search_path = public
as $$
  delete from tenants where clerk_org_id in ('iso_test_a', 'iso_test_b');
$$;

-- Returns document_chunks that would be retrievable by query_tenant under RLS.
-- The RLS policy filters to rows where tenant_id = current_tenant_id() OR
-- tenant_id IS NULL. This function sets the tenant context then returns any
-- chunks visible, so the test can assert none of them leak another tenant.
create or replace function isolation_test_vector_search(query_tenant uuid)
returns table (chunk_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.current_tenant', query_tenant::text, true);
  return query
    select id, document_chunks.tenant_id
    from document_chunks
    limit 100;
end;
$$;

-- Tighten execution to the service role only. Anon / authenticated roles must
-- not be able to reset tenant context or seed tenants.
revoke all on function clear_current_tenant() from public;
revoke all on function seed_isolation_test_tenants() from public;
revoke all on function cleanup_isolation_test_tenants() from public;
revoke all on function isolation_test_vector_search(uuid) from public;
grant execute on function clear_current_tenant() to service_role;
grant execute on function seed_isolation_test_tenants() to service_role;
grant execute on function cleanup_isolation_test_tenants() to service_role;
grant execute on function isolation_test_vector_search(uuid) to service_role;
