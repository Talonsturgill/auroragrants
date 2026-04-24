/**
 * Types mirroring the Python worker's Pydantic models. These are duplicated
 * by hand from `/worker/` contracts rather than codegen'd, per the Phase 2
 * task spec. Keep in sync when the worker changes.
 */

export interface ParserPageMapping {
  page: number;
  start_offset: number;
  end_offset: number;
}

export interface ParsedDocumentTable {
  page: number;
  rows: string[][];
  caption?: string | null;
}

export interface ParsedDocumentHeading {
  level: number;
  text: string;
  page: number;
}

export interface ParsedDocument {
  document_id: string;
  parser: "marker" | "pdfplumber" | "unstructured";
  page_count: number;
  markdown: string;
  pages: ParserPageMapping[];
  tables: ParsedDocumentTable[];
  headings: ParsedDocumentHeading[];
  token_count: number;
}

export interface ParserResult {
  ok: boolean;
  document_id: string;
  parsed?: ParsedDocument;
  error?: string;
  error_code?:
    | "timeout"
    | "parse_failed"
    | "file_too_large"
    | "unsupported"
    | "internal";
  duration_ms: number;
}

export interface RetrievedChunk {
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  content: string;
  score: number;
}

export interface ParseMarkerRequest {
  document_id: string;
  signed_url: string;
  tenant_id: string;
}

export interface IngestRequest {
  document_id: string;
  tenant_id: string;
  parsed: ParsedDocument;
}

export interface IngestResponse {
  ok: boolean;
  chunks_inserted: number;
  embeddings_inserted: number;
  error?: string;
}

/**
 * Extraction contracts. Mirror the worker's Pydantic models for the
 * `/extract/requirements` endpoint. The `requirements` object matches
 * /starter/evals/schemas/reporting_requirements.json when schema_valid is
 * true.
 */
export interface ExtractRequirementsRequest {
  award_id: string;
  document_id: string;
  tenant_id: string;
}

export interface ExtractedNarrativeSection {
  key: string;
  label: string;
  field_type:
    | "narrative"
    | "number"
    | "currency"
    | "percentage"
    | "date"
    | "select"
    | "multiselect"
    | "table";
  required: boolean;
  word_count_max?: number | null;
  word_count_min?: number | null;
  description?: string | null;
}

export interface ExtractedReport {
  title: string;
  report_type:
    | "progress"
    | "final"
    | "financial"
    | "sf425"
    | "ppr"
    | "narrative"
    | "programmatic";
  due_offset_days: number;
  period_months: number;
  format: "portal" | "email" | "pdf" | "docx" | "grants_gov";
  narrative_sections: ExtractedNarrativeSection[];
}

export interface ExtractedAwardSummary {
  program_name: string;
  funder_name: string;
  award_min_usd: number | null;
  award_max_usd: number | null;
  period_months?: number | null;
  cfda_number?: string | null;
  eligibility_summary?: string;
}

export interface ExtractedRequirements {
  award_summary: ExtractedAwardSummary;
  reports: ExtractedReport[];
  citations: Array<{ field: string; page: number; quote: string }>;
  uncertainties: Array<{ field: string; reason: string }>;
}

export interface ExtractRequirementsResponse {
  requirements: ExtractedRequirements;
  attempts: 1 | 2;
  schema_valid: boolean;
  schema_errors: string[] | null;
  tokens_in: number;
  tokens_out: number;
}
