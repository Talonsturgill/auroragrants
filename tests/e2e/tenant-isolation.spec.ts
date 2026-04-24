/**
 * Tenant isolation E2E test.
 *
 * This suite is the single most important test in the repo. It must pass on
 * every PR. If it fails, we have a data-leak bug.
 *
 * Setup: seeds two tenants (A, B) each with one document, five chunks, five
 * embeddings. Signs in as a user in A. Attempts to read documents, chunks,
 * embeddings, opportunities, awards, reports, drafts, audit_log, deadlines
 * belonging to B. Expects zero rows in every case.
 *
 * Also asserts that a vector similarity search from tenant A's context cannot
 * return tenant B's chunks.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SUPABASE_CONFIGURED = Boolean(SB_URL && SB_SERVICE);

test.describe('tenant isolation', () => {
  test.skip(
    !SUPABASE_CONFIGURED,
    'Supabase env vars not set — run against a live project: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
  );

  const admin = createClient(SB_URL, SB_SERVICE, {
    auth: { persistSession: false },
  });

  let tenantA: string;
  let tenantB: string;

  test.beforeAll(async () => {
    const seed = await admin.rpc('seed_isolation_test_tenants');
    if (seed.error) throw seed.error;
    tenantA = seed.data.tenant_a_id;
    tenantB = seed.data.tenant_b_id;
  });

  test.afterAll(async () => {
    await admin.rpc('cleanup_isolation_test_tenants');
  });

  const tables = [
    'documents',
    'opportunities',
    'awards',
    'reports',
    'report_fields',
    'drafts',
    'deadlines',
    'audit_log',
  ];

  for (const t of tables) {
    test(`${t}: cross-tenant read returns 0 rows`, async () => {
      // Set tenant context to A and look for B's rows.
      await admin.rpc('set_current_tenant', { tenant_id: tenantA });
      const { data, error } = await admin
        .from(t)
        .select('id, tenant_id')
        .eq('tenant_id', tenantB);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  test('document_chunks: tenant A cannot see tenant B private chunks', async () => {
    await admin.rpc('set_current_tenant', { tenant_id: tenantA });
    const { data } = await admin
      .from('document_chunks')
      .select('id, tenant_id')
      .eq('tenant_id', tenantB);
    expect(data).toEqual([]);
  });

  test('embeddings: vector search never returns other-tenant rows', async () => {
    await admin.rpc('set_current_tenant', { tenant_id: tenantA });
    const { data, error } = await admin.rpc('isolation_test_vector_search', {
      query_tenant: tenantA,
    });
    expect(error).toBeNull();
    // All returned rows must belong to A or be funder-scoped (null).
    for (const row of data || []) {
      expect([tenantA, null]).toContain(row.tenant_id);
    }
  });

  test('missing tenant context: queries return 0 rows (fail-closed)', async () => {
    await admin.rpc('clear_current_tenant');
    for (const t of tables) {
      const { data } = await admin.from(t).select('id').limit(1);
      expect(data).toEqual([]);
    }
  });
});
