import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SovereigntySchema = z.object({
  data_residency: z.enum(["us-west-2", "us-gov-west-1"]).optional(),
  byok_key_arn: z.string().max(500).nullable().optional(),
  advisory_contact: z.string().max(500).nullable().optional(),
  tdua_signed: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = SovereigntySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const update: Record<string, unknown> = {
    sovereignty_requested: true,
    deployment_posture: "dedicated",
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.data_residency) {
    update.data_residency = parsed.data.data_residency;
  }
  if (parsed.data.byok_key_arn !== undefined) {
    update.byok_key_arn = parsed.data.byok_key_arn;
  }
  if (parsed.data.advisory_contact !== undefined) {
    update.advisory_contact = parsed.data.advisory_contact;
  }
  if (parsed.data.tdua_signed) {
    update.tdua_signed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("tenants")
    .update(update)
    .eq("id", tenantId)
    .select("id, sovereignty_requested, data_residency, byok_key_arn, advisory_contact, tdua_signed_at")
    .single();

  if (error) {
    logAction({
      tenant_id: tenantId,
      action: "onboarding.sovereignty",
      status: "error",
      metadata: { reason: error.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  logAction({
    tenant_id: tenantId,
    action: "onboarding.sovereignty",
    status: "ok",
  });

  return NextResponse.json(data);
}
