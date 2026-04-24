import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";
import {
  createUploadUrl,
  sanitizeFilename,
  signUploadToken,
  UPLOAD_TOKEN_TTL_SECONDS,
} from "@/lib/storage";
import { supabaseForTenant } from "@/lib/supabase/server";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
} from "@/lib/types/documents";

export const runtime = "nodejs";

const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.enum(ALLOWED_DOCUMENT_MIME_TYPES),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(MAX_DOCUMENT_SIZE_BYTES, {
      message: `File exceeds ${MAX_DOCUMENT_SIZE_BYTES} bytes`,
    }),
});

export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
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

  const { tenantId } = await supabaseForTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "no_tenant" }, { status: 403 });
  }

  try {
    const upload = await createUploadUrl(tenantId, parsed.data.filename);
    const token = await signUploadToken(
      tenantId,
      upload.storagePath,
      parsed.data.size_bytes,
    );
    const expiresAt = new Date(
      Date.now() + UPLOAD_TOKEN_TTL_SECONDS * 1000,
    ).toISOString();

    logAction({
      tenant_id: tenantId,
      action: "document.upload_url_issued",
      status: "ok",
      metadata: { size_bytes: parsed.data.size_bytes },
    });

    return NextResponse.json({
      signedUrl: upload.signedUrl,
      storagePath: upload.storagePath,
      token,
      expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    logAction({
      tenant_id: tenantId,
      action: "document.upload_url_issued",
      status: "error",
      metadata: { reason: message.slice(0, 120) },
    });
    return NextResponse.json({ error: "upload_url_failed" }, { status: 500 });
  }
}
