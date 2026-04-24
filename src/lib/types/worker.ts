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
