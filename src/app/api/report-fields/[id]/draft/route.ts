import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runDrafterForField } from "@/lib/drafts/orchestrator";
import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamSchema = z.object({ id: z.string().uuid() });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/report-fields/[id]/draft
 *
 * Fire-and-forget trigger for the Phase 4 Writer-Critic-Editor loop on a
 * single report_field. Returns 202 Accepted immediately; the UI polls
 * `GET /api/report-fields/[id]/drafts` for the new draft.
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const params = await context.params;
  const parsed = ParamSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const fieldId = parsed.data.id;

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  // Confirm the field exists for this tenant before we kick the worker.
  const { data: field, error } = await supabase
    .from("report_fields")
    .select("id")
    .eq("id", fieldId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!field) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { userId } = await auth();

  // Audit the trigger synchronously before we fire the worker.
  const { error: auditErr } = await supabase.from("audit_log").insert({
    tenant_id: tenantId,
    action: "draft.trigger",
    target_type: "report_field",
    target_id: fieldId,
    metadata: { triggered_by: userId ?? "system" },
  });
  if (auditErr) {
    logAction({
      tenant_id: tenantId,
      action: "draft.trigger",
      status: "error",
      metadata: {
        field_id: fieldId,
        reason: auditErr.message.slice(0, 120),
      },
    });
  } else {
    logAction({
      tenant_id: tenantId,
      action: "draft.trigger",
      status: "ok",
      metadata: { field_id: fieldId },
    });
  }

  // Fire-and-forget orchestrator. Errors surface via audit + log.
  void runDrafterForField(fieldId, tenantId, supabase).catch((err) => {
    const message = err instanceof Error ? err.message : "unknown";
    logAction({
      tenant_id: tenantId,
      action: "draft.trigger",
      status: "error",
      metadata: { field_id: fieldId, reason: message.slice(0, 120) },
    });
  });

  return NextResponse.json(
    { field_id: fieldId, draft_triggered: true },
    { status: 202 },
  );
}
