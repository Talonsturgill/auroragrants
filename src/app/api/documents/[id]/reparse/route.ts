import { type NextRequest, NextResponse } from "next/server";

import { logAction } from "@/lib/observability";
import { createDownloadUrl } from "@/lib/storage";
import { supabaseForTenant } from "@/lib/supabase/server";
import { parseMarker, WorkerError } from "@/lib/workers";

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

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, storage_path, parse_status, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!doc || doc.deleted_at) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Flip status back to queued so the UI shows the in-flight state.
  const { error: updateErr } = await supabase
    .from("documents")
    .update({
      parse_status: "queued",
      parse_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // Sign a short-lived download URL and hand it to the worker. The worker
  // owns the actual parse + chunk + embed lifecycle and will update the row.
  try {
    const download = await createDownloadUrl(
      tenantId,
      doc.storage_path as string,
      // 15 min matches docs/01-architecture.md's PDF signed URL posture.
      15 * 60,
    );

    // Fire-and-forget: we do not await the parse itself, but the JWT and
    // URL signing complete before the response returns.
    void parseMarker(id, download.signedUrl, tenantId).catch((err) => {
      const message =
        err instanceof WorkerError ? `${err.status} ${err.message}` : String(err);
      logAction({
        tenant_id: tenantId,
        action: "document.reparse",
        status: "error",
        metadata: { reason: message.slice(0, 120) },
      });
    });
  } catch (err) {
    logAction({
      tenant_id: tenantId,
      action: "document.reparse",
      status: "error",
      metadata: {
        reason: (err instanceof Error ? err.message : "unknown").slice(0, 120),
      },
    });
    return NextResponse.json({ error: "worker_unavailable" }, { status: 502 });
  }

  logAction({
    tenant_id: tenantId,
    action: "document.reparse",
    status: "ok",
    metadata: { id },
  });

  return NextResponse.json({ ok: true, parse_status: "queued" });
}
