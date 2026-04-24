import { type NextRequest, NextResponse } from "next/server";

import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
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
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!award) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Linked reports for the dashboard / client polling loop.
  const { data: reports, error: reportsErr } = await supabase
    .from("reports")
    .select(
      "id, title, period_start, period_end, due_at, status, report_type, submission_format, submitted_at, signed_at, created_at",
    )
    .eq("award_id", id)
    .order("due_at", { ascending: true });

  if (reportsErr) {
    return NextResponse.json({ error: "reports_fetch_failed" }, { status: 500 });
  }

  // Source document chunk count — useful for the UI "extracted from N chunks"
  // readout and to confirm the document is actually indexed.
  const src = (award as { source_document_id: string | null })
    .source_document_id;
  let chunkCount = 0;
  if (src) {
    const { count } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", src);
    chunkCount = count ?? 0;
  }

  return NextResponse.json({
    ...award,
    reports: reports ?? [],
    chunk_count: chunkCount,
  });
}
