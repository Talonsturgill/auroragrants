import { auth } from "@clerk/nextjs/server";
import { type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Returns a service-role Supabase client with `app.current_tenant` set to the
 * current Clerk organization's mapped tenant id. Use this on every server-side
 * query that reads or writes tenant-scoped data.
 *
 * RLS enforces tenant isolation at the database level via
 * `set_current_tenant(uuid)`. If no Clerk org is active, we clear the setting
 * so policies fail closed.
 */
export async function supabaseForTenant(): Promise<{
  supabase: SupabaseClient;
  tenantId: string | null;
}> {
  const supabase = supabaseAdmin();
  const { orgId } = await auth();

  if (!orgId) {
    await supabase.rpc("clear_current_tenant");
    return { supabase, tenantId: null };
  }

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("clerk_org_id", orgId)
    .maybeSingle();

  if (error || !tenant) {
    await supabase.rpc("clear_current_tenant");
    return { supabase, tenantId: null };
  }

  await supabase.rpc("set_current_tenant", { tenant_id: tenant.id });
  return { supabase, tenantId: tenant.id as string };
}
