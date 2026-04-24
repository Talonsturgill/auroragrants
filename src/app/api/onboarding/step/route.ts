import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StepSchema = z.object({
  step: z.number().int().min(1).max(6),
});

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = StepSchema.safeParse(body);
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

  const { data, error } = await supabase
    .from("tenants")
    .update({
      onboarding_step: parsed.data.step,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenantId)
    .select("id, onboarding_step")
    .single();

  if (error) {
    logAction({
      tenant_id: tenantId,
      action: "onboarding.step",
      status: "error",
      metadata: { reason: error.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  logAction({
    tenant_id: tenantId,
    action: "onboarding.step",
    status: "ok",
    metadata: { step: parsed.data.step },
  });

  return NextResponse.json(data);
}
