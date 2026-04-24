/**
 * Typed client for the Python FastAPI worker service.
 *
 * Every request is signed with a short-lived HS256 JWT containing a
 * `tenant_id` claim. The worker's middleware verifies the token against
 * `WORKER_JWT_SECRET` (same env var, shared secret). Tokens expire in 5
 * minutes and are per-request.
 *
 * Contract lives in `src/lib/types/worker.ts` and is duplicated from the
 * worker's Pydantic models by hand.
 */

import { SignJWT } from "jose";

import type {
  ExtractRequirementsRequest,
  ExtractRequirementsResponse,
  IngestRequest,
  IngestResponse,
  ParseMarkerRequest,
  ParsedDocument,
  ParserResult,
} from "@/lib/types/worker";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";
const WORKER_JWT_SECRET = process.env.WORKER_JWT_SECRET ?? "";
const WORKER_JWT_TTL_SECONDS = 300; // 5 minutes
const WORKER_JWT_ISSUER = "auroragrants-web";
const WORKER_JWT_AUDIENCE = "auroragrants-worker";

export class WorkerError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

async function signWorkerToken(
  tenantId: string,
  extraClaims: Record<string, string> = {},
): Promise<string> {
  if (!WORKER_JWT_SECRET) {
    throw new WorkerError(
      "WORKER_JWT_SECRET is not set",
      500,
      "missing_secret",
    );
  }
  const secret = new TextEncoder().encode(WORKER_JWT_SECRET);
  return new SignJWT({ tenant_id: tenantId, ...extraClaims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(WORKER_JWT_ISSUER)
    .setAudience(WORKER_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${WORKER_JWT_TTL_SECONDS}s`)
    .sign(secret);
}

interface WorkerPostOptions {
  tenantId: string;
  path: string;
  body: unknown;
  timeoutMs?: number;
  extraClaims?: Record<string, string>;
}

async function workerPost<T>({
  tenantId,
  path,
  body,
  timeoutMs = 60_000,
  extraClaims,
}: WorkerPostOptions): Promise<T> {
  const token = await signWorkerToken(tenantId, extraClaims);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new WorkerError(
        `worker ${path} returned ${res.status}: ${detail.slice(0, 200)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trigger the Marker parser on a document. Fire-and-forget from the caller's
 * perspective; the worker writes parse results back to Supabase itself.
 */
export async function parseMarker(
  documentId: string,
  signedUrl: string,
  tenantId: string,
): Promise<ParserResult> {
  const body: ParseMarkerRequest = {
    document_id: documentId,
    signed_url: signedUrl,
    tenant_id: tenantId,
  };
  return workerPost<ParserResult>({
    tenantId,
    path: "/parse/marker",
    body,
    timeoutMs: 120_000,
  });
}

/**
 * Chunk + embed + insert. Called by the parser pipeline on the worker after
 * a successful parse. Exposed here so the web app can retry a stuck ingest
 * when the UI requests a re-parse.
 */
export async function ingestDocument(
  documentId: string,
  parsed: ParsedDocument,
  tenantId: string,
): Promise<IngestResponse> {
  const body: IngestRequest = {
    document_id: documentId,
    tenant_id: tenantId,
    parsed,
  };
  return workerPost<IngestResponse>({
    tenantId,
    path: "/ingest",
    body,
    timeoutMs: 120_000,
  });
}

/**
 * Call the Python worker's extractor against a parsed-and-indexed document.
 * The worker runs the Claude-Sonnet Extractor prompt (see
 * /docs/07-prompts.md#extractor) and returns a schema-validated JSON blob
 * matching /starter/evals/schemas/reporting_requirements.json.
 *
 * The worker retries once on schema-validation failure before returning
 * schema_valid=false. HTTP errors surface as WorkerError.
 */
export async function extractRequirements(
  awardId: string,
  documentId: string,
  tenantId: string,
): Promise<ExtractRequirementsResponse> {
  const body: ExtractRequirementsRequest = {
    award_id: awardId,
    document_id: documentId,
    tenant_id: tenantId,
  };
  return workerPost<ExtractRequirementsResponse>({
    tenantId,
    path: "/extract/requirements",
    body,
    // Extractor runs LLM + schema-validate + retry. 90s is enough for a
    // 60-page award letter.
    timeoutMs: 90_000,
    extraClaims: { award_id: awardId },
  });
}

/**
 * Supported export formats for the Phase 4 export system. Kept in sync
 * with the worker's ExportReportRequest accept list.
 */
export type ExportFormat = "pdf" | "docx" | "text";

/**
 * Call the Python worker's export route for a `ready_for_export` report.
 *
 * Returns the raw `Blob` and a derived filename. The web API route proxies
 * this blob back to the browser with the appropriate Content-Disposition
 * header. The worker performs the heavy lift: rendering the PDF via
 * WeasyPrint, DOCX via python-docx, or plain text.
 *
 * Unlike the JSON endpoints, this helper reads the response as a binary
 * blob and pulls the filename from Content-Disposition.
 */
export async function exportReport(
  reportId: string,
  format: ExportFormat,
  tenantId: string,
): Promise<{ blob: Blob; filename: string }> {
  const token = await signWorkerToken(tenantId, { report_id: reportId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${WORKER_URL}/export/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({ report_id: reportId, format }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new WorkerError(
        `worker /export/report returned ${res.status}: ${detail.slice(0, 200)}`,
        res.status,
      );
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename =
      parseFilenameFromDisposition(disposition) ??
      defaultFilename(reportId, format);

    return { blob, filename };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the `filename` field out of a Content-Disposition header.
 * Tolerates both `filename="..."` and unquoted `filename=...` forms.
 */
export function parseFilenameFromDisposition(
  disposition: string,
): string | null {
  if (!disposition) return null;
  const quoted = disposition.match(/filename="([^"]+)"/i);
  if (quoted) return quoted[1];
  const bare = disposition.match(/filename=([^;]+)/i);
  if (bare) return bare[1].trim();
  return null;
}

function defaultFilename(reportId: string, format: ExportFormat): string {
  const ext = format === "text" ? "txt" : format;
  return `report-${reportId}.${ext}`;
}
