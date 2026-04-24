import { type NextRequest, NextResponse } from "next/server";

import { runExtractionForAward } from "@/lib/extract/orchestrator";
import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { data: award, error } = await supabase
    .from("awards")
    .select("id, extraction_status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!award) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const status = (award as { extraction_status: string }).extraction_status;
  if (status !== "failed" && status !== "manual_review") {
    return NextResponse.json(
      { error: "retry_not_allowed", extraction_status: status },
      { status: 409 },
    );
  }

  logAction({
    tenant_id: tenantId,
    action: "award.extraction.retry",
    status: "ok",
    metadata: { award_id: id, previous_status: status },
  });

  void runExtractionForAward(id, tenantId, supabase).catch((err) => {
    const message = err instanceof Error ? err.message : "unknown";
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.retry",
      status: "error",
      metadata: { award_id: id, reason: message.slice(0, 120) },
    });
  });

  return NextResponse.json({ ok: true, extraction_status: "running" });
}
