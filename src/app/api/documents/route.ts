import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import { verifyUploadToken } from "@/lib/storage";
import { supabaseForTenant } from "@/lib/supabase/server";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
  type Document,
  type DocumentKind,
  type DocumentWithChunkCount,
} from "@/lib/types/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const CreateSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_DOCUMENT_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MAX_DOCUMENT_SIZE_BYTES),
  storage_path: z.string().min(1),
  sha256: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  kind: z
    .enum([
      "nofo",
      "past_proposal",
      "past_report",
      "annual_report",
      "990",
      "budget",
      "logic_model",
      "other",
    ])
    .default("nofo"),
  upload_token: z.string().min(10),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? `${DEFAULT_PAGE_SIZE}`, 10) ||
        DEFAULT_PAGE_SIZE,
    ),
  );
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
  );

  const { supabase, tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("documents")
    .select("*, chunks:document_chunks(count)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logAction({
      tenant_id: tenantId,
      action: "documents.list",
      status: "error",
      metadata: { reason: error.message.slice(0, 120) },
    });
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  type DocRow = Document & { chunks?: { count: number }[] | null };
  const documents: DocumentWithChunkCount[] = ((data ?? []) as DocRow[]).map(
    (doc) => ({
      ...doc,
      chunk_count: Array.isArray(doc.chunks) ? (doc.chunks[0]?.count ?? 0) : 0,
    }),
  );

  return NextResponse.json({ documents, limit, offset });
}

export async function POST(req: NextRequest) {
  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
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

  // Validate the upload token to confirm the signer issued it for this
  // tenant's storage path. This is the tenant-spoofing guard described in
  // the task spec.
  const claims = await verifyUploadToken(parsed.data.upload_token);
  if (!claims) {
    return NextResponse.json({ error: "invalid_upload_token" }, { status: 400 });
  }
  if (claims.tenant_id !== tenantId) {
    return NextResponse.json({ error: "tenant_mismatch" }, { status: 403 });
  }
  if (claims.storage_path !== parsed.data.storage_path) {
    return NextResponse.json({ error: "path_mismatch" }, { status: 400 });
  }
  if (claims.size_bytes !== parsed.data.size_bytes) {
    return NextResponse.json({ error: "size_mismatch" }, { status: 400 });
  }
  if (!parsed.data.storage_path.startsWith(`tenants/${tenantId}/`)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const insert = {
    tenant_id: tenantId,
    filename: parsed.data.filename,
    mime_type: parsed.data.mime_type,
    size_bytes: parsed.data.size_bytes,
    storage_path: parsed.data.storage_path,
    sha256: parsed.data.sha256,
    kind: parsed.data.kind as DocumentKind,
    parse_status: "queued" as const,
  };

  const { data, error } = await supabase
    .from("documents")
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    logAction({
      tenant_id: tenantId,
      action: "document.uploaded",
      status: "error",
      metadata: { reason: (error?.message ?? "insert_failed").slice(0, 120) },
    });
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  logAction({
    tenant_id: tenantId,
    action: "document.uploaded",
    status: "ok",
    metadata: { size_bytes: parsed.data.size_bytes, kind: parsed.data.kind },
  });

  return NextResponse.json(data, { status: 201 });
}
