import { notFound, redirect } from "next/navigation";

import { supabaseForTenant } from "@/lib/supabase/server";

import { Step1OrgInfo } from "../../_components/steps/step-1-org-info";
import { Step2Documents } from "../../_components/steps/step-2-documents";
import { Step3Awards } from "../../_components/steps/step-3-awards";
import { Step4Funders } from "../../_components/steps/step-4-funders";
import { Step5Team } from "../../_components/steps/step-5-team";
import { Step6Posture } from "../../_components/steps/step-6-posture";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ step: string }>;
}

export default async function OnboardingStepPage({ params }: PageProps) {
  const { step: stepParam } = await params;
  const step = Number.parseInt(stepParam, 10);

  if (Number.isNaN(step) || step < 1 || step > 6) {
    notFound();
  }

  // Load tenant data for pre-filling step 1.
  let tenant: Record<string, string | null> = {};
  let subscribedFunderIds: string[] = [];

  try {
    const { supabase, tenantId } = await supabaseForTenant();
    if (!tenantId) {
      redirect("/sign-in");
    }

    const { data } = await supabase
      .from("tenants")
      .select(
        "name, ein, org_type, primary_address, primary_contact_name, primary_contact_email, primary_phone",
      )
      .eq("id", tenantId)
      .maybeSingle();

    if (data) tenant = data as Record<string, string | null>;

    if (step === 4) {
      const { data: subs } = await supabase
        .from("tenant_funder_subscriptions")
        .select("funder_id")
        .eq("tenant_id", tenantId);
      subscribedFunderIds = (subs ?? []).map(
        (s: { funder_id: string }) => s.funder_id,
      );
    }
  } catch {
    // DB not available, render with empty defaults.
  }

  switch (step) {
    case 1:
      return (
        <Step1OrgInfo
          initialName={tenant.name ?? ""}
          initialEin={tenant.ein ?? ""}
          initialOrgType={tenant.org_type ?? ""}
          initialAddress={tenant.primary_address ?? ""}
          initialContactName={tenant.primary_contact_name ?? ""}
          initialContactEmail={tenant.primary_contact_email ?? ""}
          initialPhone={tenant.primary_phone ?? ""}
        />
      );
    case 2:
      return <Step2Documents />;
    case 3:
      return <Step3Awards />;
    case 4:
      return <Step4Funders initialSubscribedIds={subscribedFunderIds} />;
    case 5:
      return <Step5Team />;
    case 6:
      return <Step6Posture />;
    default:
      notFound();
  }
}
