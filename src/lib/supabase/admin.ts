import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Server-only. Bypasses RLS, so callers must
 * set `app.current_tenant` via set_current_tenant() before any tenant-scoped
 * query, OR filter explicitly by tenant_id.
 */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
