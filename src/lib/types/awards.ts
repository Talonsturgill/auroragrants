/**
 * TypeScript types for the `awards` table and related API payloads.
 *
 * See docs/02-data-model.md and supabase/migrations/0006_phase3_awards_extraction.sql
 * for the canonical schema. The extraction lifecycle is:
 *   pending -> running -> ok
 *   pending -> running -> manual_review
 *   pending -> running -> failed
 */

export type ExtractionStatus =
  | "pending"
  | "running"
  | "ok"
  | "manual_review"
  | "failed";

export interface AwardFunderSummary {
  id: string;
  name: string;
  type: string;
  slug?: string | null;
}

export interface Award {
  id: string;
  tenant_id: string;
  funder_id: string;
  source_document_id: string | null;
  program_name: string;
  amount_usd: number;
  awarded_at: string | null;
  period_start: string | null;
  period_end: string | null;
  award_number: string | null;
  cfda_number: string | null;
  uei: string | null;
  extraction_status: ExtractionStatus;
  extraction_error: string | null;
  extraction_attempts: number;
  extraction_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AwardWithFunder extends Award {
  funders: AwardFunderSummary | null;
}

export interface AwardReportSummary {
  id: string;
  title: string;
  report_type: string | null;
  due_at: string;
  status: string;
}

export interface AwardSourceDocumentSummary {
  id: string;
  filename: string;
}
