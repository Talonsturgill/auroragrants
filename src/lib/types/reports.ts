/**
 * TypeScript types for the `reports` and `report_fields` tables and helpers
 * used by the Phase 3 Reports dashboard.
 *
 * See supabase/migrations/0001_initial.sql for the canonical schema.
 */

export type ReportStatus =
  | "upcoming"
  | "drafting"
  | "ready_for_review"
  | "ready_for_export"
  | "submitted"
  | "accepted"
  | "revision_requested";

export const REPORT_STATUSES: ReportStatus[] = [
  "upcoming",
  "drafting",
  "ready_for_review",
  "ready_for_export",
  "submitted",
  "accepted",
  "revision_requested",
];

export type ReportType =
  | "progress"
  | "final"
  | "financial"
  | "sf425"
  | "ppr"
  | "narrative"
  | "programmatic";

export type SubmissionFormat =
  | "portal"
  | "email"
  | "pdf"
  | "docx"
  | "grants_gov";

export type FieldType =
  | "narrative"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "select"
  | "multiselect"
  | "table";

export type FieldStatus =
  | "not_started"
  | "drafting"
  | "ready_for_review"
  | "approved"
  | "submitted"
  | "revision_requested";

export interface ReportField {
  id: string;
  tenant_id: string;
  report_id: string;
  key: string;
  label: string;
  field_type: FieldType;
  required: boolean;
  word_count_max: number | null;
  word_count_min: number | null;
  current_value: string | null;
  current_value_json: unknown;
  draft_value: string | null;
  last_draft_at: string | null;
  last_draft_eval: unknown;
  human_reviewed: boolean;
  human_approved: boolean;
  approver_user_id: string | null;
  approved_at: string | null;
  source_rubric_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  tenant_id: string;
  award_id: string;
  title: string;
  period_start: string;
  period_end: string;
  due_at: string;
  submitted_at: string | null;
  status: ReportStatus;
  report_type: ReportType | null;
  submission_format: SubmissionFormat | null;
  signer_user_id: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Derive a user-facing status for a report_field from the persisted values.
 *
 * Precedence, per the Phase 3 spec:
 *   1. approved if human_approved is true
 *   2. ready_for_review if current_value is set and not human_approved
 *   3. drafting if draft_value is set
 *   4. not_started otherwise
 *
 * current_value is the promoted, human-visible value. draft_value is the
 * most recent model-generated attempt. Both may coexist; current_value wins
 * because once a draft has been promoted it is waiting on human review.
 */
export function deriveFieldStatus(field: {
  human_approved: boolean;
  current_value: string | null;
  draft_value: string | null;
}): FieldStatus {
  if (field.human_approved) return "approved";
  if (field.current_value != null && field.current_value !== "") {
    return "ready_for_review";
  }
  if (field.draft_value != null && field.draft_value !== "") {
    return "drafting";
  }
  return "not_started";
}
