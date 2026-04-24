import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OrgInfoSchema = z.object({
  name: z.string().min(1, "Organization name is required").max(200),
  ein: z.string().max(20).nullable().optional(),
  org_type: z
    .enum(["501c3", "tribal_gov", "tribal_nonprofit", "ancsa_regional_nonprofit", "municipality", "other"])
    .nullable()
    .optional(),
  primary_address: z.string().max(500).nullable().optional(),
  primary_contact_name: z.string().max(200).nullable().optional(),
  primary_contact_email: z.string().email().max(200).nullable().optional(),
  primary_phone: z.string().max(30).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = OrgInfoSchema.safeParse(body);
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
    name: parsed.data.name,
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.ein !== undefined) update.ein = parsed.data.ein;
  if (parsed.data.org_type !== undefined) update.org_type = parsed.data.org_type;
  if (parsed.data.primary_address !== undefined) {
    update.primary_address = parsed.data.primary_address;
  }
  if (parsed.data.primary_contact_name !== undefined) {
    update.primary_contact_name = parsed.data.primary_contact_name;
  }
  if (parsed.data.primary_contact_email !== undefined) {
    update.primary_contact_email = parsed.data.primary_contact_email;
  }
  if (parsed.data.primary_phone !== undefined) {
    update.primary_phone = parsed.data.primary_phone;
  }

  const { data, error } = await supabase
    .from("tenants")
    .update(update)
    .eq("id", tenantId)
    .select("*")
    .single();

  if (error) {
    logAction({
      tenant_id: tenantId,
      action: "onboarding.org_info",
      status: "error",
      metadata: { reason: error.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  logAction({
    tenant_id: tenantId,
    action: "onboarding.org_info",
    status: "ok",
  });

  return NextResponse.json(data);
}
