import Link from "next/link";
import { notFound } from "next/navigation";

import { supabaseForTenant } from "@/lib/supabase/server";
import type { Draft } from "@/lib/types/draft";
import type { ReportField } from "@/lib/types/reports";

import { EditorShell } from "./_components/editor-shell";
import { FieldList } from "./_components/field-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string; fieldId: string }>;
}

interface ReportRow {
  id: string;
  title: string;
  award_id: string;
  award: {
    id: string;
    program_name: string;
    amount_usd: number | null;
    high_stakes?: boolean | null;
    funders: { id: string; name: string } | null;
  } | null;
  report_fields: ReportField[];
}

export default async function FieldDrafterPage({ params }: PageProps) {
  const { id, fieldId } = await params;
  const { supabase, tenantId } = await supabaseForTenant();

  if (!tenantId) {
    notFound();
  }

  const { data: reportData, error: reportError } = await supabase
    .from("reports")
    .select(
      "id, title, award_id, " +
        "award:awards!inner(id, program_name, amount_usd, funders(id, name)), " +
        "report_fields(*)",
    )
    .eq("id", id)
    .maybeSingle();

  if (reportError || !reportData) {
    notFound();
  }

  const report = reportData as unknown as ReportRow;
  const fields = report.report_fields ?? [];
  const active = fields.find((f) => f.id === fieldId);
  if (!active) {
    notFound();
  }

  const { data: draftRows } = await supabase
    .from("drafts")
    .select(
      "id, tenant_id, report_field_id, version, content, citations, wce_trace, eval_scores, eval_passed, model_writer, model_critic, model_editor, iterations, tokens_in, tokens_out, cost_cents, surfaced_to_user, created_at",
    )
    .eq("report_field_id", fieldId)
    .order("version", { ascending: false })
    .limit(1);

  const latestDraft = (draftRows?.[0] as Draft | undefined) ?? null;

  // Federal award > $500k is high-stakes (see /starter/wce/loop.py). We read
  // from the column when present, fall back to the amount heuristic.
  const highStakes =
    report.award?.high_stakes === true ||
    (report.award?.amount_usd ?? 0) > 500_000;

  const funderName = report.award?.funders?.name ?? "Unknown funder";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/app/reports"
            className="underline-offset-2 hover:underline"
          >
            Reports
          </Link>
          <span aria-hidden>/</span>
          <Link
            href={`/app/reports/${report.id}`}
            className="underline-offset-2 hover:underline"
          >
            {report.title}
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground">{active.label}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {report.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {report.award?.program_name} · {funderName}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <FieldList
          reportId={report.id}
          activeFieldId={active.id}
          fields={fields}
        />

        <EditorShell
          fieldId={active.id}
          fieldLabel={active.label}
          wordCountMin={active.word_count_min}
          wordCountMax={active.word_count_max}
          humanApproved={active.human_approved}
          highStakes={highStakes}
          draft={latestDraft}
        />
      </div>
    </div>
  );
}
