import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FundersSchema = z.object({
  funder_ids: z.array(z.string().uuid()).min(0),
});

/** POST — replace all funder subscriptions for the current tenant. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = FundersSchema.safeParse(body);
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

  // Delete existing subscriptions for this tenant.
  const { error: delErr } = await supabase
    .from("tenant_funder_subscriptions")
    .delete()
    .eq("tenant_id", tenantId);

  if (delErr) {
    logAction({
      tenant_id: tenantId,
      action: "onboarding.funders",
      status: "error",
      metadata: { reason: delErr.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  if (parsed.data.funder_ids.length > 0) {
    const rows = parsed.data.funder_ids.map((fid) => ({
      tenant_id: tenantId,
      funder_id: fid,
    }));

    const { error: insErr } = await supabase
      .from("tenant_funder_subscriptions")
      .insert(rows);

    if (insErr) {
      logAction({
        tenant_id: tenantId,
        action: "onboarding.funders",
        status: "error",
        metadata: { reason: insErr.message.slice(0, 120) },
      });
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
  }

  logAction({
    tenant_id: tenantId,
    action: "onboarding.funders",
    status: "ok",
    metadata: { count: parsed.data.funder_ids.length },
  });

  return NextResponse.json({ subscribed: parsed.data.funder_ids.length });
}
