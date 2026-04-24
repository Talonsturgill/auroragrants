import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";
import { exportReport, WorkerError } from "@/lib/workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ParamSchema = z.object({ id: z.string().uuid() });

const BodySchema = z
  .object({
    format: z.enum(["pdf", "docx", "text"]),
  })
  .strict();

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/reports/[id]/export
 *
 * Proxies the report-export request to the Python worker, streams the
 * rendered binary back to the browser, and writes a `report.exported`
 * audit row. The report must belong to the caller's tenant and be in
 * `ready_for_export` state. The approve endpoint flips status to
 * `ready_for_export`; see /src/app/api/reports/[id]/approve/route.ts.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const params = await context.params;
  const parsedParams = ParamSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const reportId = parsedParams.data.id;

  const payload = await req.json().catch(() => ({}));
  const parsedBody = BodySchema.safeParse(payload);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }
  const { format } = parsedBody.data;

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 1. Report must exist and belong to this tenant. RLS enforces
  // isolation, but we also explicitly filter and verify below so the
  // 404/403 split is stable regardless of RLS state.
  const { data: report, error: reportErr } = await supabase
    .from("reports")
    .select("id, tenant_id, status")
    .eq("id", reportId)
    .maybeSingle();

  if (reportErr) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const reportRow = report as {
    id: string;
    tenant_id: string;
    status: string;
  };
  if (reportRow.tenant_id !== tenantId) {
    // RLS would already hide this row; belt and suspenders.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 2. Must be ready for export. Agent C's approve endpoint sets this.
  if (reportRow.status !== "ready_for_export") {
    return NextResponse.json(
      { error: "not_ready", status: reportRow.status },
      { status: 409 },
    );
  }

  // 3. Proxy to the worker. Network or format errors surface as 502/500.
  let blob: Blob;
  let filename: string;
  try {
    const result = await exportReport(reportId, format, tenantId);
    blob = result.blob;
    filename = result.filename;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    logAction({
      tenant_id: tenantId,
      action: "report.exported",
      status: "error",
      metadata: {
        report_id: reportId,
        format,
        reason: message.slice(0, 120),
      },
    });
    if (err instanceof WorkerError) {
      return NextResponse.json(
        { error: "worker_error", status: err.status },
        { status: err.status === 409 ? 409 : 502 },
      );
    }
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }

  // 4. Audit row. Unlike the approve endpoint we do not block the
  // response on the audit insert; we log and continue so the user
  // still gets their download even if audit tooling is degraded.
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  const actorUserId = userRow ? (userRow as { id: string }).id : null;

  const { error: auditErr } = await supabase.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: actorUserId,
    action: "report.exported",
    target_type: "report",
    target_id: reportId,
    metadata: { format, filename },
  });
  if (auditErr) {
    logAction({
      tenant_id: tenantId,
      action: "report.exported",
      status: "error",
      metadata: {
        report_id: reportId,
        format,
        reason: auditErr.message.slice(0, 120),
      },
    });
  } else {
    logAction({
      tenant_id: tenantId,
      action: "report.exported",
      status: "ok",
      metadata: { report_id: reportId, format },
    });
  }

  // 5. Stream the blob back with the right content type and disposition.
  const contentType = blob.type || defaultContentType(format);

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function defaultContentType(format: "pdf" | "docx" | "text"): string {
  if (format === "pdf") return "application/pdf";
  if (format === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "text/plain; charset=utf-8";
}
