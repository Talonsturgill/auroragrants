/**
 * Phase 4 drafting orchestrator.
 *
 * Given a `report_fields` row, the orchestrator loads the field + its parent
 * `reports`, `awards`, `funders`, and `tenants` context, kicks off the
 * worker's Writer-Critic-Editor loop, runs the evaluation gate on the
 * resulting draft, and writes a `drafts` row plus audit entries.
 *
 * Every query here runs against the tenant-scoped supabase client returned
 * by `supabaseForTenant()`, so RLS is in play. We still include explicit
 * `.eq("tenant_id", tenantId)` clauses for defense in depth and because the
 * admin service-role client bypasses RLS if `app.current_tenant` is ever
 * unset.
 *
 * See /docs/05-build-plan.md §Phase 4 tasks 2, 8, 12 for context.
 */

import { type SupabaseClient } from "@supabase/supabase-js";

import { logAction } from "@/lib/observability";
import type {
  DraftContext,
  DraftResponse,
  EvalGateResponse,
  SurfaceDecision,
} from "@/lib/types/draft";
import { draftReportField, runEvalGate, WorkerError } from "@/lib/workers";

export type DraftRunStatus = "ok" | "blocked" | "failed";

export interface DraftRunResult {
  status: DraftRunStatus;
  draft_id?: string;
  surface_decision?: SurfaceDecision;
  eval_passed?: boolean;
  overall_score?: number;
  error?: string;
}

const HIGH_STAKES_THRESHOLD_USD = 500_000;

interface ReportFieldRow {
  id: string;
  tenant_id: string;
  report_id: string;
  key: string;
  label: string;
  field_type: string;
  word_count_max: number | null;
  word_count_min: number | null;
  draft_status: string | null;
}

interface ReportRow {
  id: string;
  tenant_id: string;
  award_id: string;
  title: string;
}

interface AwardRow {
  id: string;
  tenant_id: string;
  funder_id: string;
  amount_usd: number;
  program_name: string;
}

interface FunderRow {
  id: string;
  name: string;
  rubric: unknown;
  known_programs: unknown;
}

interface TenantRow {
  id: string;
  name: string;
  org_type: string | null;
  ein: string | null;
}

export async function runDrafterForField(
  fieldId: string,
  tenantId: string,
  supabase: SupabaseClient,
): Promise<DraftRunResult> {
  // 1. Fetch the report_field row (RLS + explicit tenant filter).
  const { data: fieldData, error: fieldErr } = await supabase
    .from("report_fields")
    .select(
      "id, tenant_id, report_id, key, label, field_type, word_count_max, word_count_min, draft_status",
    )
    .eq("id", fieldId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fieldErr || !fieldData) {
    const reason =
      (fieldErr?.message ?? "field_not_found").slice(0, 120);
    logAction({
      tenant_id: tenantId,
      action: "draft.started",
      status: "error",
      metadata: { field_id: fieldId, reason },
    });
    await writeAuditLog(supabase, {
      tenant_id: tenantId,
      action: "draft.started",
      target_type: "report_field",
      target_id: fieldId,
      metadata: { outcome: "field_not_found" },
    });
    return { status: "failed", error: "field_not_found" };
  }

  const field = fieldData as ReportFieldRow;

  // Mark the field as drafting + audit the start.
  await supabase
    .from("report_fields")
    .update({ draft_status: "drafting", updated_at: new Date().toISOString() })
    .eq("id", field.id)
    .eq("tenant_id", tenantId);

  await writeAuditLog(supabase, {
    tenant_id: tenantId,
    action: "draft.started",
    target_type: "report_field",
    target_id: field.id,
    metadata: { field_key: field.key, label: field.label },
  });
  logAction({
    tenant_id: tenantId,
    action: "draft.started",
    status: "ok",
    metadata: { field_id: field.id, field_key: field.key },
  });

  // 2. Join to report → award → funder and tenant.
  const { data: reportData, error: reportErr } = await supabase
    .from("reports")
    .select("id, tenant_id, award_id, title")
    .eq("id", field.report_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (reportErr || !reportData) {
    return failDraft(
      supabase,
      tenantId,
      field.id,
      "report_not_found",
      reportErr?.message,
    );
  }
  const report = reportData as ReportRow;

  const { data: awardData, error: awardErr } = await supabase
    .from("awards")
    .select("id, tenant_id, funder_id, amount_usd, program_name")
    .eq("id", report.award_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (awardErr || !awardData) {
    return failDraft(
      supabase,
      tenantId,
      field.id,
      "award_not_found",
      awardErr?.message,
    );
  }
  const award = awardData as AwardRow;

  const { data: funderData, error: funderErr } = await supabase
    .from("funders")
    .select("id, name, rubric, known_programs")
    .eq("id", award.funder_id)
    .maybeSingle();
  if (funderErr || !funderData) {
    return failDraft(
      supabase,
      tenantId,
      field.id,
      "funder_not_found",
      funderErr?.message,
    );
  }
  const funder = funderData as FunderRow;

  const { data: tenantData, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name, org_type, ein")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr || !tenantData) {
    return failDraft(
      supabase,
      tenantId,
      field.id,
      "tenant_not_found",
      tenantErr?.message,
    );
  }
  const tenant = tenantData as TenantRow;

  // 3. Build retrieval query + high_stakes flag.
  const descriptionPart = "";
  const retrieval_query = `${funder.name} ${field.label} ${descriptionPart}`
    .trim()
    .replace(/\s+/g, " ");
  const high_stakes = Number(award.amount_usd) > HIGH_STAKES_THRESHOLD_USD;

  const draftContext: DraftContext = {
    report_field_id: field.id,
    funder: {
      id: funder.id,
      name: funder.name,
      rubric: Array.isArray(funder.rubric) ? funder.rubric : [],
    },
    field: {
      id: field.id,
      key: field.key,
      label: field.label,
      field_type: field.field_type,
      word_count_max: field.word_count_max,
      word_count_min: field.word_count_min,
    },
    org_context: {
      tenant_id: tenant.id,
      name: tenant.name,
      org_type: tenant.org_type,
      ein: tenant.ein,
    },
    retrieval_query,
    high_stakes,
  };

  // 4. Call the Writer-Critic-Editor worker.
  let wce: DraftResponse;
  try {
    wce = await draftReportField(field.id, draftContext, tenantId);
  } catch (err) {
    const message =
      err instanceof WorkerError
        ? `worker_error_${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown_worker_error";
    return failDraft(supabase, tenantId, field.id, "wce_failed", message);
  }

  // 5. Call the evaluation gate.
  let gate: EvalGateResponse;
  try {
    gate = await runEvalGate(
      {
        report_field_id: field.id,
        draft: wce.draft,
        retrieved_chunks: wce.wce_trace?.retrieved_chunks ?? [],
        funder: {
          id: funder.id,
          name: funder.name,
          rubric: Array.isArray(funder.rubric) ? funder.rubric : [],
          known_programs: Array.isArray(funder.known_programs)
            ? funder.known_programs
            : [],
        },
        field: {
          word_count_max: field.word_count_max,
          word_count_min: field.word_count_min,
        },
      },
      tenantId,
    );
  } catch (err) {
    const message =
      err instanceof WorkerError
        ? `worker_error_${err.status}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown_worker_error";
    return failDraft(supabase, tenantId, field.id, "eval_gate_failed", message);
  }

  // 6. Compute next version.
  const { data: latestDrafts, error: latestErr } = await supabase
    .from("drafts")
    .select("version")
    .eq("report_field_id", field.id)
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(1);
  if (latestErr) {
    return failDraft(
      supabase,
      tenantId,
      field.id,
      "version_lookup_failed",
      latestErr.message,
    );
  }
  const priorVersion =
    Array.isArray(latestDrafts) && latestDrafts[0]
      ? Number((latestDrafts[0] as { version: number }).version) || 0
      : 0;
  const nextVersion = priorVersion + 1;

  const surfaced =
    gate.passed && wce.surface_decision !== "block";

  // 7. Insert drafts row.
  const draftInsert = {
    tenant_id: tenantId,
    report_field_id: field.id,
    version: nextVersion,
    content: wce.draft.content,
    citations: wce.draft.citations ?? [],
    wce_trace: wce.wce_trace ?? {},
    eval_scores: gate.scores,
    eval_passed: gate.passed,
    model_writer: wce.model_writer,
    model_critic: wce.model_critic,
    model_editor: wce.model_editor,
    iterations: wce.iterations,
    tokens_in: wce.tokens_in,
    tokens_out: wce.tokens_out,
    cost_cents: wce.cost_cents,
    surfaced_to_user: surfaced,
    failure_reason: surfaced
      ? null
      : summarizeFailure(wce.surface_decision, gate),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("drafts")
    .insert(draftInsert)
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return failDraft(
      supabase,
      tenantId,
      field.id,
      "draft_insert_failed",
      insertErr?.message,
    );
  }
  const draftId = (inserted as { id: string }).id;

  // 8. If surfaced, promote to report_fields.draft_value and update status.
  const nextStatus = surfaced ? "ready_for_review" : "idle";
  const updatePatch: Record<string, unknown> = {
    draft_status: nextStatus,
    last_draft_at: new Date().toISOString(),
    last_draft_eval: gate.scores,
    updated_at: new Date().toISOString(),
  };
  if (surfaced) {
    updatePatch.draft_value = wce.draft.content;
  }
  await supabase
    .from("report_fields")
    .update(updatePatch)
    .eq("id", field.id)
    .eq("tenant_id", tenantId);

  // 9. Audit: completed or blocked.
  if (surfaced) {
    await writeAuditLog(supabase, {
      tenant_id: tenantId,
      action: "draft.completed",
      target_type: "draft",
      target_id: draftId,
      metadata: {
        field_id: field.id,
        version: nextVersion,
        overall_score: wce.critique.overall_score,
        eval_passed: gate.passed,
        surface_decision: wce.surface_decision,
        iterations: wce.iterations,
        tokens_in: wce.tokens_in,
        tokens_out: wce.tokens_out,
        cost_cents: wce.cost_cents,
      },
    });
    logAction({
      tenant_id: tenantId,
      action: "draft.completed",
      status: "ok",
      metadata: {
        field_id: field.id,
        draft_id: draftId,
        version: nextVersion,
      },
    });
    return {
      status: "ok",
      draft_id: draftId,
      surface_decision: wce.surface_decision,
      eval_passed: gate.passed,
      overall_score: wce.critique.overall_score,
    };
  }

  await writeAuditLog(supabase, {
    tenant_id: tenantId,
    action: "draft.blocked",
    target_type: "draft",
    target_id: draftId,
    metadata: {
      field_id: field.id,
      version: nextVersion,
      eval_passed: gate.passed,
      failures: gate.failures,
      surface_decision: wce.surface_decision,
      overall_score: wce.critique.overall_score,
    },
  });
  logAction({
    tenant_id: tenantId,
    action: "draft.blocked",
    status: "ok",
    metadata: {
      field_id: field.id,
      draft_id: draftId,
      surface_decision: wce.surface_decision,
    },
  });

  return {
    status: "blocked",
    draft_id: draftId,
    surface_decision: wce.surface_decision,
    eval_passed: gate.passed,
    overall_score: wce.critique.overall_score,
  };
}

function summarizeFailure(
  surface: SurfaceDecision,
  gate: EvalGateResponse,
): string {
  const parts: string[] = [];
  if (surface === "block") parts.push("surface_decision=block");
  if (!gate.passed) {
    const check = gate.failures.map((f) => f.check).slice(0, 3).join(",");
    parts.push(`eval_failed:${check}`);
  }
  return parts.join("|").slice(0, 500);
}

async function failDraft(
  supabase: SupabaseClient,
  tenantId: string,
  fieldId: string,
  reason: string,
  detail?: string,
): Promise<DraftRunResult> {
  const message = detail ? `${reason}: ${detail}` : reason;
  await supabase
    .from("report_fields")
    .update({
      draft_status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", fieldId)
    .eq("tenant_id", tenantId);

  await writeAuditLog(supabase, {
    tenant_id: tenantId,
    action: "draft.blocked",
    target_type: "report_field",
    target_id: fieldId,
    metadata: { outcome: "failed", reason: message.slice(0, 400) },
  });

  logAction({
    tenant_id: tenantId,
    action: "draft.blocked",
    status: "error",
    metadata: { field_id: fieldId, reason: message.slice(0, 120) },
  });

  return { status: "failed", error: message };
}

async function writeAuditLog(
  supabase: SupabaseClient,
  row: {
    tenant_id: string;
    action: string;
    target_type?: string;
    target_id?: string;
    user_id?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      tenant_id: row.tenant_id,
      user_id: row.user_id ?? null,
      action: row.action,
      target_type: row.target_type ?? null,
      target_id: row.target_id ?? null,
      metadata: row.metadata ?? {},
    });
  } catch {
    // audit is best-effort; logAction already captured the structured event
  }
}
