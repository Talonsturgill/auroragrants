import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamSchema = z.object({ id: z.string().uuid() });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/reports/[id]/approve
 *
 * Flips `reports.status` to `ready_for_export` once every required
 * `report_fields` row for this report is `human_approved = true`. If any
 * required fields are still unapproved the endpoint returns 400 with a list
 * of their ids so the UI can show the user what is blocking approval.
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const params = await context.params;
  const parsed = ParamSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const reportId = parsed.data.id;

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 1. Report must exist + belong to this tenant.
  const { data: report, error: reportErr } = await supabase
    .from("reports")
    .select("id, tenant_id, status")
    .eq("id", reportId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (reportErr) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 2. All required fields must be approved.
  const { data: fields, error: fieldsErr } = await supabase
    .from("report_fields")
    .select("id, required, human_approved")
    .eq("report_id", reportId)
    .eq("tenant_id", tenantId);

  if (fieldsErr) {
    return NextResponse.json({ error: "fields_fetch_failed" }, { status: 500 });
  }

  const unapprovedIds = (fields ?? [])
    .filter((f) => {
      const row = f as { required: boolean; human_approved: boolean };
      return row.required && !row.human_approved;
    })
    .map((f) => (f as { id: string }).id);

  if (unapprovedIds.length > 0) {
    return NextResponse.json(
      {
        error: "unapproved_fields",
        unapproved_field_ids: unapprovedIds,
      },
      { status: 400 },
    );
  }

  // 3. Look up user id for the audit row (Clerk user → users.id).
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  const approverUserId = userRow ? (userRow as { id: string }).id : null;

  // 4. Flip status.
  const approvedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("reports")
    .update({
      status: "ready_for_export",
      approved_at: approvedAt,
      updated_at: approvedAt,
    })
    .eq("id", reportId)
    .eq("tenant_id", tenantId);

  if (updateErr) {
    return NextResponse.json({ error: "approve_failed" }, { status: 500 });
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: approverUserId,
    action: "report.approved",
    target_type: "report",
    target_id: reportId,
    metadata: { clerk_user_id: clerkUserId },
  });
  if (auditErr) {
    logAction({
      tenant_id: tenantId,
      action: "report.approved",
      status: "error",
      metadata: {
        report_id: reportId,
        reason: auditErr.message.slice(0, 120),
      },
    });
  } else {
    logAction({
      tenant_id: tenantId,
      action: "report.approved",
      status: "ok",
      metadata: { report_id: reportId },
    });
  }

  return NextResponse.json({
    report_id: reportId,
    status: "ready_for_export",
    approved_at: approvedAt,
  });
}
