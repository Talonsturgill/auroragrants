import Link from "next/link";
import { notFound } from "next/navigation";

import { DraftBanner } from "@/components/app/draft-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabaseForTenant } from "@/lib/supabase/server";
import {
  deriveFieldStatus,
  type FieldStatus,
  type ReportField,
  type ReportStatus,
} from "@/lib/types/reports";

import {
  DueIndicator,
  describeDue,
} from "../_components/due-indicator";
import { FieldsProgress } from "../_components/fields-progress";
import {
  FieldStatusBadge,
  ReportStatusBadge,
} from "../_components/status-badge";
import { ExportMenu } from "./_components/export-menu";

export const dynamic = "force-dynamic";

interface DetailProps {
  params: Promise<{ id: string }>;
}

interface ReportDetail {
  id: string;
  title: string;
  status: ReportStatus;
  report_type: string | null;
  due_at: string;
  period_start: string;
  period_end: string;
  submission_format: string | null;
  submitted_at: string | null;
  award: {
    id: string;
    program_name: string;
    award_number: string | null;
    funders: { id: string; name: string } | null;
  } | null;
  report_fields: ReportField[];
}

function titleCaseWords(s: string | null): string {
  if (!s) return "";
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatPeriod(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  return `${fmt(start)} to ${fmt(end)}`;
}

export default async function ReportDetailPage({ params }: DetailProps) {
  const { id } = await params;
  const { supabase, tenantId } = await supabaseForTenant();

  if (!tenantId) {
    notFound();
  }

  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, title, status, report_type, due_at, period_start, period_end, submission_format, submitted_at, " +
        "award:awards!inner(id, program_name, award_number, funders(id, name)), " +
        "report_fields(*)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const report = data as unknown as ReportDetail;
  const fields = [...(report.report_fields ?? [])].sort((a, b) => {
    // Required before optional, then by label.
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const requiredFields = fields.filter((f) => f.required);
  const optionalFields = fields.filter((f) => !f.required);

  const requiredApproved = requiredFields.filter(
    (f) => deriveFieldStatus(f) === "approved",
  ).length;
  const totalApproved = fields.filter(
    (f) => deriveFieldStatus(f) === "approved",
  ).length;

  const allRequiredApproved =
    requiredFields.length > 0 && requiredApproved === requiredFields.length;

  const due = describeDue(report.due_at);
  const funder = report.award?.funders?.name ?? "Unknown funder";

  return (
    <div className="space-y-6">
      <DraftBanner />

      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Link
              href="/app/reports"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Reports
            </Link>
            <span aria-hidden className="text-xs text-muted-foreground">
              /
            </span>
            <span className="text-xs text-muted-foreground">{report.title}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {report.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {report.report_type ? (
              <Badge variant="secondary">
                {titleCaseWords(report.report_type)}
              </Badge>
            ) : null}
            <span>{report.award?.program_name}</span>
            <span aria-hidden>·</span>
            <span>{funder}</span>
            <span aria-hidden>·</span>
            <span>{formatPeriod(report.period_start, report.period_end)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ReportStatusBadge status={report.status} />
          <DueIndicator dueAt={report.due_at} className="items-end text-right" />
          <ExportMenu
            reportId={report.id}
            isReady={report.status === "ready_for_export"}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Overall progress</CardTitle>
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalApproved}/{fields.length} fields approved
          </span>
        </CardHeader>
        <CardContent>
          <FieldsProgress
            barOnly
            complete={totalApproved}
            total={fields.length}
          />
        </CardContent>
      </Card>

      <FieldGroup
        heading="Required fields"
        emptyLabel="No required fields."
        fields={requiredFields}
        reportId={report.id}
      />

      <FieldGroup
        heading="Optional fields"
        emptyLabel="No optional fields."
        fields={optionalFields}
        reportId={report.id}
      />

      <div className="flex flex-col items-end gap-2 border-t pt-4">
        {!allRequiredApproved ? (
          <p className="text-xs text-muted-foreground" id="approve-help">
            All required fields must be approved first.
          </p>
        ) : null}
        <Button
          disabled
          aria-disabled="true"
          aria-describedby={!allRequiredApproved ? "approve-help" : undefined}
          title={
            allRequiredApproved
              ? "Export is wired in Phase 4."
              : "All required fields must be approved first."
          }
        >
          Approve report and prepare export
        </Button>
        <p className="text-xs text-muted-foreground">
          Export, attestation, and submission land in Phase 4. Use the drafter
          on each field to get there.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Due {due.absolute}. {due.relative.charAt(0).toUpperCase() + due.relative.slice(1)}.
      </p>
    </div>
  );
}

function FieldGroup({
  heading,
  fields,
  emptyLabel,
  reportId,
}: {
  heading: string;
  fields: ReportField[];
  emptyLabel: string;
  reportId: string;
}) {
  return (
    <section aria-labelledby={`group-${heading.replace(/\s+/g, "-").toLowerCase()}`}>
      <h2
        id={`group-${heading.replace(/\s+/g, "-").toLowerCase()}`}
        className="mb-3 text-sm font-semibold tracking-tight text-foreground"
      >
        {heading}
      </h2>
      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <ul className="divide-y">
            {fields.map((f) => (
              <FieldRow key={f.id} field={f} reportId={reportId} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FieldRow({ field, reportId }: { field: ReportField; reportId: string }) {
  const status: FieldStatus = deriveFieldStatus(field);
  const wordTarget =
    field.word_count_max && field.word_count_min
      ? `${field.word_count_min} to ${field.word_count_max} words`
      : field.word_count_max
        ? `up to ${field.word_count_max} words`
        : field.word_count_min
          ? `at least ${field.word_count_min} words`
          : null;

  return (
    <li className="flex flex-col gap-3 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-foreground">{field.label}</p>
          <Badge variant="outline" className="shrink-0 text-xs">
            {titleCaseWords(field.field_type)}
          </Badge>
          {!field.required ? (
            <Badge variant="secondary" className="shrink-0 text-xs">
              Optional
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {wordTarget ? wordTarget : "No word-count target."} Key {field.key}.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <FieldStatusBadge status={status} />
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/reports/${reportId}/fields/${field.id}`}>
            Open in drafter
          </Link>
        </Button>
      </div>
    </li>
  );
}
