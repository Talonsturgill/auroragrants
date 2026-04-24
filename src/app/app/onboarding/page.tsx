import { redirect } from "next/navigation";

import { supabaseForTenant } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /app/onboarding — redirects to the last incomplete step.
 * If onboarding_step is null or 0, go to step 1.
 */
export default async function OnboardingPage() {
  let step = 1;
  try {
    const { supabase, tenantId } = await supabaseForTenant();
    if (tenantId) {
      const { data } = await supabase
        .from("tenants")
        .select("onboarding_step, onboarding_completed_at")
        .eq("id", tenantId)
        .maybeSingle();

      if (data?.onboarding_completed_at) {
        redirect("/app");
      }
      if (data?.onboarding_step && data.onboarding_step >= 1) {
        step = Math.min(6, data.onboarding_step);
      }
    }
  } catch {
    // DB not available, fall through to step 1.
  }

  redirect(`/app/onboarding/step/${step}`);
}
