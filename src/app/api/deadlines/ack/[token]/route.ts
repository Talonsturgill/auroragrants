import { type NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { logAction } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * GET /api/deadlines/ack/[token]
 *
 * Token-based deadline acknowledgement. No login required. The token is
 * included in every notification email. On success, sets
 * deadlines.acknowledged = true and redirects to the report page.
 *
 * Responses:
 *   302 -> /app/reports/{report_id}?acknowledged=1   (first ack)
 *   200 "Already acknowledged."                      (idempotent)
 *   404 "Deadline not found."                        (bad token)
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const { token } = await context.params;

  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return new NextResponse("Deadline not found.", { status: 404 });
  }

  const supabase = supabaseAdmin();

  // Look up deadline by ack_token.
  const { data: deadline, error: lookupErr } = await supabase
    .from("deadlines")
    .select("id, tenant_id, source_id, source_type, acknowledged, acknowledged_at")
    .eq("ack_token", token)
    .maybeSingle();

  if (lookupErr) {
    logAction({
      action: "deadline.ack",
      status: "error",
      metadata: { token, reason: lookupErr.message.slice(0, 120) },
    });
    return new NextResponse("Internal error.", { status: 500 });
  }

  if (!deadline) {
    return new NextResponse("Deadline not found.", { status: 404 });
  }

  const dl = deadline as {
    id: string;
    tenant_id: string;
    source_id: string;
    source_type: string;
    acknowledged: boolean;
    acknowledged_at: string | null;
  };

  if (dl.acknowledged) {
    return new NextResponse("Already acknowledged.", { status: 200 });
  }

  // Acknowledge the deadline.
  const acknowledgedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("deadlines")
    .update({ acknowledged: true, acknowledged_at: acknowledgedAt, updated_at: acknowledgedAt })
    .eq("id", dl.id);

  if (updateErr) {
    logAction({
      action: "deadline.ack",
      status: "error",
      metadata: {
        deadline_id: dl.id,
        tenant_id: dl.tenant_id,
        reason: updateErr.message.slice(0, 120),
      },
    });
    return new NextResponse("Internal error.", { status: 500 });
  }

  // Write audit log.
  await supabase.from("audit_log").insert({
    tenant_id: dl.tenant_id,
    user_id: null,
    action: "deadline.acknowledged",
    target_type: "deadline",
    target_id: dl.id,
    metadata: { ack_token: token, via: "email_link" },
  });

  logAction({
    tenant_id: dl.tenant_id,
    action: "deadline.acknowledged",
    status: "ok",
    metadata: { deadline_id: dl.id },
  });

  // Redirect to the report page if this is a report-source deadline.
  const appBaseUrl = env.APP_URL.replace(/\/$/, "");
  if (dl.source_type === "report" && dl.source_id) {
    return NextResponse.redirect(
      `${appBaseUrl}/app/reports/${dl.source_id}?acknowledged=1`,
      { status: 302 },
    );
  }

  // Fallback: redirect to the deadlines list.
  return NextResponse.redirect(`${appBaseUrl}/app/deadlines?acknowledged=1`, { status: 302 });
}
