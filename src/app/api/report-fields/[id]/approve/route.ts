import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamSchema = z.object({ id: z.string().uuid() });

const BodySchema = z
  .object({
    draft_id: z.string().uuid(),
    signer_attestation: z.literal(true),
  })
  .strict();

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/report-fields/[id]/approve
 *
 * Promotes a surfaced draft to the field's `current_value` and records the
 * approver. This is the HITL sign-off step. The signer attestation is a
 * legal requirement (False Claims Act exposure); we reject the request if
 * it is missing.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const params = await context.params;
  const paramsParsed = ParamSchema.safeParse(params);
  if (!paramsParsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const fieldId = paramsParsed.data.id;

  const body = await req.json().catch(() => ({}));
  const bodyParsed = BodySchema.safeParse(body);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: bodyParsed.error.flatten() },
      { status: 400 },
    );
  }

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Resolve Clerk user → users.id for the approver FK.
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  const approverUserId = userRow ? (userRow as { id: string }).id : null;

  // Fetch draft and confirm it belongs to this field + tenant + was surfaced.
  const { data: draft, error: draftErr } = await supabase
    .from("drafts")
    .select(
      "id, tenant_id, report_field_id, content, surfaced_to_user, version",
    )
    .eq("id", bodyParsed.data.draft_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (draftErr) {
    return NextResponse.json({ error: "draft_fetch_failed" }, { status: 500 });
  }
  if (!draft) {
    return NextResponse.json({ error: "draft_not_found" }, { status: 404 });
  }
  const draftRow = draft as {
    id: string;
    report_field_id: string;
    content: string;
    surfaced_to_user: boolean;
    version: number;
  };
  if (draftRow.report_field_id !== fieldId) {
    return NextResponse.json(
      { error: "draft_not_for_field" },
      { status: 400 },
    );
  }
  if (!draftRow.surfaced_to_user) {
    return NextResponse.json(
      { error: "draft_not_surfaced" },
      { status: 400 },
    );
  }

  const approvedAt = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("report_fields")
    .update({
      current_value: draftRow.content,
      human_approved: true,
      human_reviewed: true,
      approver_user_id: approverUserId,
      approved_at: approvedAt,
      draft_status: "approved",
      updated_at: approvedAt,
    })
    .eq("id", fieldId)
    .eq("tenant_id", tenantId);

  if (updateErr) {
    return NextResponse.json({ error: "approve_failed" }, { status: 500 });
  }

  const { error: auditErr } = await supabase.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: approverUserId,
    action: "field.approved",
    target_type: "report_field",
    target_id: fieldId,
    metadata: {
      draft_id: draftRow.id,
      version: draftRow.version,
      clerk_user_id: clerkUserId,
    },
  });
  if (auditErr) {
    logAction({
      tenant_id: tenantId,
      action: "field.approved",
      status: "error",
      metadata: {
        field_id: fieldId,
        reason: auditErr.message.slice(0, 120),
      },
    });
  } else {
    logAction({
      tenant_id: tenantId,
      action: "field.approved",
      status: "ok",
      metadata: { field_id: fieldId, draft_id: draftRow.id },
    });
  }

  return NextResponse.json({
    field_id: fieldId,
    draft_id: draftRow.id,
    human_approved: true,
    approver_user_id: approverUserId,
    approved_at: approvedAt,
  });
}
