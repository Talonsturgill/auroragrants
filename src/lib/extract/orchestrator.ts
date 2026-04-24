/**
 * Phase 3 extraction orchestrator.
 *
 * Given an `awards` row that already has a `source_document_id` pointing at
 * a parsed-and-indexed document, kick off the worker extractor and, on
 * success, write the resulting reports + report_fields rows.
 *
 * Callers are expected to pass an already tenant-scoped Supabase client
 * (the one returned by `supabaseForTenant()`), so every query here runs
 * under RLS.
 *
 * Lifecycle writes go through the scoped client. See
 * `/supabase/migrations/0006_phase3_awards_extraction.sql` for the
 * extraction_status state machine.
 */

import { type SupabaseClient } from "@supabase/supabase-js";

import { logAction } from "@/lib/observability";
import type {
  ExtractedReport,
  ExtractedRequirements,
  ExtractRequirementsResponse,
} from "@/lib/types/worker";
import { extractRequirements, WorkerError } from "@/lib/workers";

export type ExtractionStatus =
  | "pending"
  | "running"
  | "ok"
  | "manual_review"
  | "failed";

interface AwardRow {
  id: string;
  tenant_id: string;
  source_document_id: string | null;
  period_start: string | null;
  period_end: string | null;
  extraction_attempts: number;
}

/**
 * Compute a report's due_at from period_end and the extractor's due_offset_days.
 * Phase 3 uses a single reporting period per award; more nuanced schedules
 * are Phase 5.
 */
export function computeDueAt(
  periodEnd: string,
  dueOffsetDays: number,
): string {
  const base = new Date(`${periodEnd}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`invalid period_end: ${periodEnd}`);
  }
  base.setUTCDate(base.getUTCDate() + dueOffsetDays);
  return base.toISOString();
}

/**
 * Public entry-point. Idempotent with respect to status transitions: if the
 * extractor succeeds, `extraction_status` lands on 'ok' and linked reports
 * + report_fields exist. On failure, status is 'failed' or 'manual_review'
 * and `extraction_error` describes what happened.
 */
export async function runExtractionForAward(
  awardId: string,
  tenantId: string,
  supabase: SupabaseClient,
): Promise<{ status: ExtractionStatus; error?: string }> {
  // Pull the award to get the source document + period. This also confirms
  // the row exists under the current tenant (RLS + explicit filter).
  const { data: award, error: fetchErr } = await supabase
    .from("awards")
    .select(
      "id, tenant_id, source_document_id, period_start, period_end, extraction_attempts",
    )
    .eq("id", awardId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchErr || !award) {
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.start",
      status: "error",
      metadata: {
        award_id: awardId,
        reason: (fetchErr?.message ?? "award_not_found").slice(0, 120),
      },
    });
    return { status: "failed", error: "award_not_found" };
  }

  const typedAward = award as AwardRow;
  if (!typedAward.source_document_id) {
    await setFailed(
      supabase,
      awardId,
      tenantId,
      "missing_source_document",
    );
    return { status: "failed", error: "missing_source_document" };
  }
  if (!typedAward.period_end) {
    await setFailed(supabase, awardId, tenantId, "missing_period_end");
    return { status: "failed", error: "missing_period_end" };
  }

  // Transition to running and bump attempts.
  const attempts = (typedAward.extraction_attempts ?? 0) + 1;
  const { error: runErr } = await supabase
    .from("awards")
    .update({
      extraction_status: "running",
      extraction_attempts: attempts,
      extraction_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", awardId)
    .eq("tenant_id", tenantId);

  if (runErr) {
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.start",
      status: "error",
      metadata: {
        award_id: awardId,
        reason: runErr.message.slice(0, 120),
      },
    });
    return { status: "failed", error: "status_update_failed" };
  }

  logAction({
    tenant_id: tenantId,
    action: "award.extraction.start",
    status: "ok",
    metadata: { award_id: awardId, attempt: attempts },
  });

  // Call the worker.
  let response: ExtractRequirementsResponse;
  try {
    response = await extractRequirements(
      awardId,
      typedAward.source_document_id,
      tenantId,
    );
  } catch (err) {
    const message =
      err instanceof WorkerError
        ? `worker_error_${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown_worker_error";
    await setFailed(supabase, awardId, tenantId, message);
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.complete",
      status: "error",
      metadata: { award_id: awardId, reason: message.slice(0, 120) },
    });
    return { status: "failed", error: message };
  }

  // Schema-invalid. The worker already retried internally once, so flag for
  // humans.
  if (!response.schema_valid) {
    const errSummary = (response.schema_errors ?? [])
      .slice(0, 3)
      .join("; ")
      .slice(0, 400);
    const message = `schema_validation_failed: ${errSummary || "unknown"}`;
    const { error: updErr } = await supabase
      .from("awards")
      .update({
        extraction_status: "manual_review",
        extraction_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", awardId)
      .eq("tenant_id", tenantId);
    if (updErr) {
      logAction({
        tenant_id: tenantId,
        action: "award.extraction.complete",
        status: "error",
        metadata: { award_id: awardId, reason: updErr.message.slice(0, 120) },
      });
    }
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.complete",
      status: "error",
      metadata: {
        award_id: awardId,
        outcome: "manual_review",
        attempts: response.attempts,
      },
    });
    return { status: "manual_review", error: message };
  }

  // Happy path. Persist requirements + synthesize reports / fields.
  try {
    await persistExtraction(supabase, typedAward, response.requirements);
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist_failed";
    await setFailed(supabase, awardId, tenantId, `persist_failed: ${message}`);
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.complete",
      status: "error",
      metadata: { award_id: awardId, reason: message.slice(0, 120) },
    });
    return { status: "failed", error: message };
  }

  const { error: okErr } = await supabase
    .from("awards")
    .update({
      extraction_status: "ok",
      extraction_completed_at: new Date().toISOString(),
      extraction_error: null,
      extracted_requirements: response.requirements,
      updated_at: new Date().toISOString(),
    })
    .eq("id", awardId)
    .eq("tenant_id", tenantId);

  if (okErr) {
    logAction({
      tenant_id: tenantId,
      action: "award.extraction.complete",
      status: "error",
      metadata: { award_id: awardId, reason: okErr.message.slice(0, 120) },
    });
    return { status: "failed", error: okErr.message };
  }

  logAction({
    tenant_id: tenantId,
    action: "award.extraction.complete",
    status: "ok",
    metadata: {
      award_id: awardId,
      outcome: "ok",
      reports: response.requirements.reports.length,
      attempts: response.attempts,
      tokens_in: response.tokens_in,
      tokens_out: response.tokens_out,
    },
  });

  return { status: "ok" };
}

async function setFailed(
  supabase: SupabaseClient,
  awardId: string,
  tenantId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("awards")
    .update({
      extraction_status: "failed",
      extraction_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", awardId)
    .eq("tenant_id", tenantId);
}

/**
 * Fan the extractor's reports[] out into `reports` rows and their
 * `report_fields` children. Writes use the RLS-scoped supabase client.
 *
 * Throws if any insert fails so the caller can flip status to 'failed'.
 */
async function persistExtraction(
  supabase: SupabaseClient,
  award: AwardRow,
  requirements: ExtractedRequirements,
): Promise<void> {
  if (!award.period_start || !award.period_end) {
    throw new Error("award missing period_start or period_end");
  }
  const periodStart = award.period_start;
  const periodEnd = award.period_end;

  for (const report of requirements.reports) {
    await insertReportWithFields(supabase, award, report, periodStart, periodEnd);
  }
}

async function insertReportWithFields(
  supabase: SupabaseClient,
  award: AwardRow,
  report: ExtractedReport,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const dueAt = computeDueAt(periodEnd, report.due_offset_days);

  const { data: reportRow, error: reportErr } = await supabase
    .from("reports")
    .insert({
      tenant_id: award.tenant_id,
      award_id: award.id,
      title: report.title,
      period_start: periodStart,
      period_end: periodEnd,
      due_at: dueAt,
      status: "upcoming",
      report_type: report.report_type,
      submission_format: report.format,
    })
    .select("id")
    .single();

  if (reportErr || !reportRow) {
    throw new Error(
      `reports insert failed: ${reportErr?.message ?? "no row returned"}`,
    );
  }
  const reportId = (reportRow as { id: string }).id;

  if (report.narrative_sections.length === 0) return;

  const fieldRows = report.narrative_sections.map((section) => ({
    tenant_id: award.tenant_id,
    report_id: reportId,
    key: section.key,
    label: section.label,
    field_type: section.field_type,
    required: section.required,
    word_count_max: section.word_count_max ?? null,
    word_count_min: section.word_count_min ?? null,
  }));

  const { error: fieldsErr } = await supabase
    .from("report_fields")
    .insert(fieldRows);

  if (fieldsErr) {
    throw new Error(`report_fields insert failed: ${fieldsErr.message}`);
  }
}
