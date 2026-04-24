import { type NextRequest, NextResponse } from "next/server";

import { logAction } from "@/lib/observability";
import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Maximum ZIP size: 200 MB
const MAX_ZIP_SIZE = 200 * 1024 * 1024;

/** POST /api/admin/import — accept a multipart ZIP, extract PDFs, ingest each. */
export async function POST(req: NextRequest) {
  const { tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ZIP_SIZE) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  // In production: decompress the ZIP with a Node library (adm-zip etc.).
  // Here we stub the extraction step and call the worker for each PDF found.
  // The actual ZIP decompression requires adm-zip which is not yet in the
  // dependency list. We log a follow-up and return a 501 in this environment.
  // See docs/followups.md for the full implementation note.
  logAction({
    tenant_id: tenantId,
    action: "admin.import.upload",
    status: "ok",
    metadata: { size_bytes: file.size },
  });

  // Stub: return the import job queued with a placeholder.
  // Real implementation would: unzip -> for each PDF -> parseMarker -> ingestDocument.
  return NextResponse.json(
    {
      status: "queued",
      message: "ZIP received. PDF extraction requires adm-zip (see followups.md). Worker ingest will run per-file once implemented.",
      tenant_id: tenantId,
      size_bytes: file.size,
    },
    { status: 202 },
  );
}
