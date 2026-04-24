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
  DraftContext,
  DraftResponse,
  EvalGateParams,
  EvalGateRequest,
  EvalGateResponse,
} from "@/lib/types/draft";
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
 * Phase 4: run the Writer-Critic-Editor loop on a single report_field.
 *
 * The worker runs retrieval, Writer, Critic, and Editor (see
 * /starter/wce/loop.py) and returns the final draft, citations, critique,
 * wce trace, and a surface_decision of "surface" | "surface_with_flag" |
 * "block". The orchestrator is responsible for writing a `drafts` row and
 * flipping `report_fields.draft_status`.
 *
 * A 30-second HTTP timeout covers a typical 1-to-3 iteration run. The worker
 * caps WCE iterations at 5 internally; long runs are expected to return
 * within the timeout because individual LLM calls stream fast.
 */
export async function draftReportField(
  fieldId: string,
  context: DraftContext,
  tenantId: string,
): Promise<DraftResponse> {
  const body = {
    tenant_id: tenantId,
    ...context,
    report_field_id: fieldId,
  };
  return workerPost<DraftResponse>({
    tenantId,
    path: "/wce/draft-field",
    body,
    timeoutMs: 30_000,
    extraClaims: { report_field_id: fieldId },
  });
}

/**
 * Phase 4: run the pre-surface evaluation gate against a completed draft.
 *
 * Returns the five check scores (factuality, rubric_adherence,
 * hallucinated_programs, readability, word_count_compliance), a boolean
 * `passed` summary, and a list of failures with thresholds. A draft that
 * fails the gate must NOT be surfaced to the user.
 */
export async function runEvalGate(
  params: EvalGateParams,
  tenantId: string,
): Promise<EvalGateResponse> {
  const body: EvalGateRequest = {
    report_field_id: params.report_field_id,
    draft: params.draft,
    retrieved_chunks: params.retrieved_chunks,
    funder: params.funder,
    field: params.field,
  };
  return workerPost<EvalGateResponse>({
    tenantId,
    path: "/evals/gate",
    body,
    timeoutMs: 30_000,
    extraClaims: { report_field_id: params.report_field_id },
  });
}
