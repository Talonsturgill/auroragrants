/**
 * TypeScript types mirroring the Phase 4 worker contracts for the
 * Writer-Critic-Editor loop and the evaluation harness gate. These are
 * duplicated by hand from the Python worker's Pydantic models; keep in sync
 * when the worker changes.
 *
 * Worker endpoints:
 *   POST /wce/draft-field  → DraftResponse
 *   POST /evals/gate       → EvalGateResponse
 */

export type SurfaceDecision = "surface" | "surface_with_flag" | "block";

export interface Citation {
  id: string;
  document_id: string;
  chunk_id: string;
  page_start: number | null;
  page_end: number | null;
  excerpt: string;
  section_heading: string | null;
}

export interface DraftContent {
  content: string;
  citations: Citation[];
  word_count: number;
  uncovered_claims: string[];
}

export interface RubricItemScore {
  score: number;
  max: number;
  reason?: string | null;
}

export interface CritiqueFix {
  id?: string;
  severity?: "low" | "medium" | "high";
  issue?: string;
  rubric_item_id?: string | null;
  suggestion?: string;
}

export interface Critique {
  rubric_scores: Record<string, RubricItemScore>;
  overall_score: number;
  fixes: CritiqueFix[];
  ready_to_surface: boolean;
}

export interface WceIterationTrace {
  iteration: number;
  writer_tokens_in: number;
  writer_tokens_out: number;
  critic_tokens_in: number;
  critic_tokens_out: number;
  editor_tokens_in: number;
  editor_tokens_out: number;
  overall_score: number;
  ready_to_surface: boolean;
  model_writer: string;
  model_critic: string;
  model_editor: string;
  duration_ms: number;
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

export interface WceTrace {
  retrieved_chunks: WceTraceChunk[];
  iterations: WceIterationTrace[];
  retrieval_query: string;
  high_stakes: boolean;
}

export interface DraftContext {
  report_field_id: string;
  funder: {
    id: string;
    name: string;
    rubric: unknown[];
  };
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
  critique: Critique;
  iterations: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
  surface_decision: SurfaceDecision;
  model_writer: string;
  model_critic: string;
  model_editor: string;
  wce_trace: WceTrace;
}

export interface EvalScores {
  factuality: number;
  rubric_adherence: number;
  hallucinated_programs: number;
  readability: number;
  word_count_compliance: number;
}

export interface EvalFailure {
  check: string;
  score: number;
  threshold: number;
  reason: string;
}

export interface EvalGateRequest {
  report_field_id: string;
  draft: DraftContent;
  retrieved_chunks: WceTraceChunk[];
  funder: {
    id: string;
    name: string;
    rubric: unknown[];
    known_programs: unknown[];
  };
  field: {
    word_count_max: number | null;
    word_count_min: number | null;
  };
}

export interface EvalGateResponse {
  scores: EvalScores;
  passed: boolean;
  failures: EvalFailure[];
}

export interface EvalGateParams {
  report_field_id: string;
  draft: DraftContent;
  retrieved_chunks: WceTraceChunk[];
  funder: {
    id: string;
    name: string;
    rubric: unknown[];
    known_programs: unknown[];
  };
  field: {
    word_count_max: number | null;
    word_count_min: number | null;
  };
}
