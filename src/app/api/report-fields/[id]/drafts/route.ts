import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamSchema = z.object({ id: z.string().uuid() });

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/report-fields/[id]/drafts
 *
 * Returns every draft for this field, newest first. Used by the three-pane
 * editor to render history and to let the user pick which draft to approve.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
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

  const { data, error } = await supabase
    .from("drafts")
    .select(
      [
        "id",
        "tenant_id",
        "report_field_id",
        "version",
        "content",
        "citations",
        "eval_scores",
        "eval_passed",
        "surfaced_to_user",
        "iterations",
        "tokens_in",
        "tokens_out",
        "cost_cents",
        "model_writer",
        "model_critic",
        "model_editor",
        "created_at",
      ].join(", "),
    )
    .eq("report_field_id", fieldId)
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  return NextResponse.json({ drafts: data ?? [] });
}
