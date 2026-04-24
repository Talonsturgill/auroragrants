/**
 * TypeScript types for the `documents` table and related API payloads.
 *
 * See docs/02-data-model.md for the canonical schema. The DB `parse_status`
 * enum currently contains ('queued', 'parsing', 'parsed', 'failed'). The UI
 * spec references "indexed" as the terminal success state; we treat "parsed"
 * and "indexed" as aliases. See docs/followups.md entry for this mismatch.
 */

export type ParseStatus = "queued" | "parsing" | "parsed" | "failed";

export type DocumentKind =
  | "nofo"
  | "past_proposal"
  | "past_report"
  | "annual_report"
  | "990"
  | "budget"
  | "logic_model"
  | "other";

export interface Document {
  id: string;
  tenant_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  sha256: string;
  kind: DocumentKind;
  page_count: number | null;
  parser: string | null;
  parse_status: ParseStatus;
  parse_error: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface DocumentWithChunkCount extends Document {
  chunk_count: number;
}

export interface UploadRequest {
  filename: string;
  content_type: string;
  size_bytes: number;
  kind?: DocumentKind;
}

export interface UploadResponse {
  signedUrl: string;
  storagePath: string;
  token: string;
  expiresAt: string;
}

export interface CreateDocumentRequest {
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  sha256: string;
  kind?: DocumentKind;
  upload_token: string;
}

export const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const ALLOWED_DOCUMENT_MIME_TYPES = ["application/pdf"] as const;

export type AllowedMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

export function isParseTerminal(status: ParseStatus): boolean {
  return status === "parsed" || status === "failed";
}

export function isParseInFlight(status: ParseStatus): boolean {
  return status === "queued" || status === "parsing";
}
