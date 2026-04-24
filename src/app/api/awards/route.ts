import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runExtractionForAward } from "@/lib/extract/orchestrator";
import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z
  .object({
    funder_id: z.string().uuid(),
    opportunity_id: z.string().uuid().nullable().optional(),
    source_document_id: z.string().uuid(),
    amount_usd: z.number().int().positive(),
    awarded_at: z.string().date(),
    period_start: z.string().date(),
    period_end: z.string().date(),
    program_name: z.string().min(1).max(200),
    award_number: z.string().max(100).nullable().optional(),
    cfda_number: z.string().max(100).nullable().optional(),
    uei: z.string().max(100).nullable().optional(),
  })
  .strict();

export async function GET(): Promise<NextResponse> {
  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("awards")
    .select(
      [
        "id",
        "tenant_id",
        "funder_id",
        "opportunity_id",
        "source_document_id",
        "award_number",
        "program_name",
        "amount_usd",
        "awarded_at",
        "period_start",
        "period_end",
        "cfda_number",
        "uei",
        "extraction_status",
        "extraction_error",
        "extraction_attempts",
        "extraction_completed_at",
        "created_at",
        "updated_at",
      ].join(", "),
    )
    .order("created_at", { ascending: false });

  if (error) {
    logAction({
      tenant_id: tenantId,
      action: "awards.list",
      status: "error",
      metadata: { reason: error.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  return NextResponse.json({ awards: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
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

  // 1. Source document must belong to this tenant and be ready (parsed or
  // indexed). We rely on RLS + explicit tenant_id filter.
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, parse_status, deleted_at, tenant_id")
    .eq("id", parsed.data.source_document_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (docErr) {
    return NextResponse.json({ error: "document_lookup_failed" }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "document_not_found" }, { status: 404 });
  }
  const docRow = doc as { parse_status: string; tenant_id: string };
  if (docRow.tenant_id !== tenantId) {
    // Belt and suspenders; RLS would already hide it, but defense in depth.
    return NextResponse.json({ error: "document_not_found" }, { status: 404 });
  }
  if (docRow.parse_status !== "indexed" && docRow.parse_status !== "parsed") {
    return NextResponse.json({ error: "document_not_ready" }, { status: 400 });
  }

  // 2. Funder must exist.
  const { data: funder, error: funderErr } = await supabase
    .from("funders")
    .select("id")
    .eq("id", parsed.data.funder_id)
    .maybeSingle();

  if (funderErr) {
    return NextResponse.json({ error: "funder_lookup_failed" }, { status: 500 });
  }
  if (!funder) {
    return NextResponse.json({ error: "funder_not_found" }, { status: 404 });
  }

  // 3. Insert award with pending extraction status.
  const insertRow = {
    tenant_id: tenantId,
    funder_id: parsed.data.funder_id,
    opportunity_id: parsed.data.opportunity_id ?? null,
    source_document_id: parsed.data.source_document_id,
    amount_usd: parsed.data.amount_usd,
    awarded_at: parsed.data.awarded_at,
    period_start: parsed.data.period_start,
    period_end: parsed.data.period_end,
    program_name: parsed.data.program_name,
    award_number: parsed.data.award_number ?? null,
    cfda_number: parsed.data.cfda_number ?? null,
    uei: parsed.data.uei ?? null,
    extraction_status: "pending",
  };

  const { data: award, error: insertErr } = await supabase
    .from("awards")
    .insert(insertRow)
    .select("*")
    .single();

  if (insertErr || !award) {
    logAction({
      tenant_id: tenantId,
      action: "award.created",
      status: "error",
      metadata: { reason: (insertErr?.message ?? "insert_failed").slice(0, 120) },
    });
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  const awardId = (award as { id: string }).id;

  logAction({
    tenant_id: tenantId,
    action: "award.created",
    status: "ok",
    metadata: { award_id: awardId, funder_id: parsed.data.funder_id },
  });

  // 4. Fire-and-forget extraction. We intentionally do NOT await so the
  // POST returns fast; the UI polls GET /api/awards/[id] for status.
  void runExtractionForAward(awardId, tenantId, supabase).catch((err) => {
    const message = err instanceof Error ? err.message : "unknown";
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.trigger",
      status: "error",
      metadata: { award_id: awardId, reason: message.slice(0, 120) },
    });
  });

  return NextResponse.json(award, { status: 201 });
}
