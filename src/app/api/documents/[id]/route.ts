import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";
import { sanitizeFilename } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PatchSchema = z.object({
  filename: z.string().min(1).max(255),
});

type RouteContext = { params: Promise<{ id: string }> };

async function resolveParams(context: RouteContext): Promise<{ id: string } | null> {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return null;
  return { id };
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const resolved = await resolveParams(context);
  if (!resolved) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("documents")
    .select("*, chunks:document_chunks(count)")
    .eq("id", resolved.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row = data as { chunks?: { count: number }[] | null };
  const chunk_count = Array.isArray(row.chunks) ? (row.chunks[0]?.count ?? 0) : 0;

  return NextResponse.json({ ...data, chunk_count });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const resolved = await resolveParams(context);
  if (!resolved) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", resolved.id);

  if (error) {
    logAction({
      tenant_id: tenantId,
      action: "document.deleted",
      status: "error",
      metadata: { reason: error.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  logAction({
    tenant_id: tenantId,
    action: "document.deleted",
    status: "ok",
    metadata: { id: resolved.id },
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const resolved = await resolveParams(context);
  if (!resolved) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    sanitizeFilename(parsed.data.filename);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid_filename" },
      { status: 400 },
    );
  }

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("documents")
    .update({ filename: parsed.data.filename, updated_at: new Date().toISOString() })
    .eq("id", resolved.id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "rename_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  logAction({
    tenant_id: tenantId,
    action: "document.renamed",
    status: "ok",
    metadata: { id: resolved.id },
  });

  return NextResponse.json(data);
}
