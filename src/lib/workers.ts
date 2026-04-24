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

async function signWorkerToken(tenantId: string): Promise<string> {
  if (!WORKER_JWT_SECRET) {
    throw new WorkerError(
      "WORKER_JWT_SECRET is not set",
      500,
      "missing_secret",
    );
  }
  const secret = new TextEncoder().encode(WORKER_JWT_SECRET);
  return new SignJWT({ tenant_id: tenantId })
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
}

async function workerPost<T>({
  tenantId,
  path,
  body,
  timeoutMs = 60_000,
}: WorkerPostOptions): Promise<T> {
  const token = await signWorkerToken(tenantId);
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
