/**
 * TypeScript types for the Writer-Critic-Editor `drafts` table and the
 * supporting Critic evaluation output shapes.
 *
 * These shapes mirror `supabase/migrations/0001_initial.sql` (the `drafts`
 * table) and the JSON returned by the FastAPI WCE service. Agent C's API
 * routes serialize drafts exactly as typed here so that the UI can render
 * citations, critic rubric tables, and evaluation scorecards without guessing.
 *
 * Keep this file dependency-free. It is imported by both server components
 * (pages) and client components (panels, buttons).
 */

/**
 * Surface decision from the WCE loop after Critic scoring.
 *
 * - `surface` means the draft passed the score threshold (>= 8.0) and all
 *   pre-surface eval checks.
 * - `surface_with_flag` means the draft scored in the 6.0 to 7.9 band or one
 *   of the eval checks tripped, but the draft is still shown with a red-flag
 *   banner warning.
 * - `block` means the draft did not clear 6.0 or failed a hard eval gate.
 *   The UI renders a quality-gate blocking card instead of the draft body.
 */
export type SurfaceDecision = "surface" | "surface_with_flag" | "block";

/**
 * A single citation attached to a draft. The Writer returns one entry per
 * `[n]` token it used. `citation_id` is the 1-indexed integer that appears
 * inline in `content`. `excerpt` is the truncated chunk text used to build
 * the hover tooltip.
 */
export interface Citation {
  /** 1-indexed integer matching the `[n]` token in the draft body. */
  citation_id: number;
  /** UUID of the source `document_chunks` row. */
  chunk_id: string;
  /** UUID of the source `documents` row. */
  document_id: string;
  /** Document title shown in the tooltip and citations panel. */
  document_title: string;
  /** First printed page the chunk appears on. */
  page_start: number;
  /** Last printed page the chunk appears on. */
  page_end: number;
  /** Enclosing heading in the source doc, if known. */
  section_heading?: string | null;
  /** Chunk excerpt rendered verbatim in the tooltip. */
  excerpt: string;
  /** Whether the chunk came from tenant or funder documents. */
  source: "tenant" | "funder";
}

/**
 * Severity levels for Critic-returned fixes. `high` flags a blocking issue,
 * `medium` is a strong recommendation, `low` is a nit.
 */
export type FixSeverity = "high" | "medium" | "low";

/**
 * A single fix recommendation from the Critic. Free-form `description` is
 * what the reviewer sees. `target_span` is an optional character offset
 * range into `draft.content` the Critic wants changed.
 */
export interface CriticFix {
  id: string;
  severity: FixSeverity;
  description: string;
  target_span?: { start: number; end: number } | null;
  rubric_item_id?: string | null;
}

/**
 * One row in the Critic's rubric scoring table. `score` is 0-2 inclusive.
 */
export interface RubricScore {
  /** Stable id from the funder rubric. */
  rubric_item_id: string;
  /** Human-readable label for the rubric row. */
  label: string;
  /** 0 (missing) to 2 (fully addressed). */
  score: 0 | 1 | 2;
  /** One-sentence justification the Critic must cite its score with. */
  justification: string;
}

/**
 * Full Critic output as persisted in `drafts.wce_trace` and surfaced to the
 * right-pane Critic panel.
 */
export interface Critique {
  rubric_scores: RubricScore[];
  overall_score: number; // 0 to 10
  fixes: CriticFix[];
  ready_to_surface: boolean;
}

/**
 * Pre-surface evaluation scorecard. These numbers are all 0 to 1 and come
 * from `/starter/evals/`. See `/docs/06-eval-harness.md`.
 */
export interface EvalScores {
  factuality?: number;
  rubric_adherence?: number;
  hallucinated_program?: number;
  readability?: number;
  word_count_ok?: boolean;
  /** Names of the evaluation checks that did not pass. */
  failed_checks?: string[];
}

/**
 * One `drafts` row as returned by `/api/report-fields/[id]/drafts`. `content`
 * is plain text with inline `[n]` tokens. `citations` is the lookup table.
 */
export interface Draft {
  id: string;
  tenant_id: string;
  report_field_id: string;
  version: number;
  content: string;
  citations: Citation[];
  wce_trace: {
    critique?: Critique;
    iterations?: unknown[];
    surface_decision?: SurfaceDecision;
    surface_reasons?: string[];
  };
  eval_scores: EvalScores;
  eval_passed: boolean;
  model_writer: string;
  model_critic: string;
  model_editor: string;
  iterations: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
  surfaced_to_user: boolean;
  created_at: string;
}

/**
 * Response body of POST `/api/report-fields/[id]/draft`. The route queues
 * a WCE job and returns the job id for the client to poll.
 */
export interface DraftGenerationJob {
  job_id: string;
  report_field_id: string;
  queued_at: string;
}

/**
 * Response body of POST `/api/report-fields/[id]/approve`. Mirrors the
 * persisted state machine on `report_fields`.
 */
export interface ApproveResponse {
  report_field_id: string;
  human_approved: true;
  approver_user_id: string;
  approved_at: string;
}

/**
 * Request body expected by the approve route. The UI must collect an
 * explicit attestation before sending this.
 */
export interface ApproveRequest {
  signer_attestation: true;
}

/**
 * The exact attestation phrase the reviewer must type into the approval
 * dialog. Kept as a constant so tests and the UI stay in sync.
 */
export const APPROVAL_ATTESTATION_PHRASE = "I certify this is accurate.";

// ---------------------------------------------------------------------------
// WCE worker contract types — used by orchestrator.ts and workers.ts.
// These mirror the FastAPI Pydantic models at POST /wce/draft-field and
// POST /evals/gate. `citations` and `wce_trace` are opaque JSON blobs that
// pass straight through to the DB; we type them broadly to avoid duplicating
// the richer UI Citation shape above.
// ---------------------------------------------------------------------------

export interface DraftContent {
  content: string;
  /** Raw citation array from the worker. Stored as JSONB, not re-typed here. */
  citations: object[];
  word_count: number;
  uncovered_claims: string[];
}

export interface WceTraceChunk {
  document_id: string;
  chunk_id: string;
  chunk_index?: number;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  content: string;
  score?: number;
}

export interface DraftContext {
  report_field_id: string;
  funder: { id: string; name: string; rubric: unknown[] };
  field: {
    id: string;
    key: string;
    label: string;
    field_type: string;
    word_count_max: number | null;
    word_count_min: number | null;
    description?: string | null;
  };
  org_context: {
    tenant_id: string;
    name: string;
    org_type: string | null;
    ein: string | null;
  };
  retrieval_query: string;
  high_stakes: boolean;
}

export interface DraftResponse {
  draft: DraftContent;
  /** WCE Critic output stored as JSONB. `overall_score` is read by the orchestrator. */
  critique: { overall_score?: number; [key: string]: unknown };
  iterations: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
  surface_decision: SurfaceDecision;
  model_writer: string;
  model_critic: string;
  model_editor: string;
  wce_trace: {
    retrieved_chunks?: WceTraceChunk[];
    iterations?: unknown[];
    surface_decision?: SurfaceDecision;
    surface_reasons?: string[];
    retrieval_query?: string;
    high_stakes?: boolean;
  } | null;
}

export interface EvalGateParams {
  report_field_id: string;
  draft: DraftContent;
  retrieved_chunks: WceTraceChunk[];
  funder: { id: string; name: string; rubric: unknown[]; known_programs: unknown[] };
  field: { word_count_max: number | null; word_count_min: number | null };
}

export type EvalGateRequest = EvalGateParams;

export interface EvalGateResponse {
  /** Eval check scores stored as JSONB. */
  scores: object;
  passed: boolean;
  failures: Array<{ check: string; score?: number; threshold?: number; reason?: string }>;
}
