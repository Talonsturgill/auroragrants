import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabaseForTenant } from "@/lib/supabase/server";
import type {
  AwardReportSummary,
  AwardSourceDocumentSummary,
  AwardWithFunder,
} from "@/lib/types/awards";

import {
  ExtractionBadge,
  type ExtractionStatus,
} from "../_components/extraction-badge";
import { ExtractionStatusPoller } from "../_components/extraction-status-poller";
import { RetryExtractionButton } from "./retry-extraction-button";

export const dynamic = "force-dynamic";

interface AwardDetailData {
  award: AwardWithFunder;
  reports: AwardReportSummary[];
  sourceDocument: AwardSourceDocumentSummary | null;
}

export default async function AwardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadAward(id);
  if (!data) notFound();
  const { award, reports, sourceDocument } = data;
  const status = award.extraction_status as ExtractionStatus;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          <Link href="/app/awards" className="hover:underline">
            Awards
          </Link>{" "}
          / {award.program_name}
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {award.program_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {award.funders?.name ?? "Unknown funder"}
              {" . "}
              {formatUsd(award.amount_usd)}
              {" . "}
              {formatPeriod(award.period_start, award.period_end)}
            </p>
          </div>
          <ExtractionBadge status={status} error={award.extraction_error} />
        </div>
      </div>

      <ExtractionSection award={award} reports={reports} />

      <ReportsSection award={award} reports={reports} />

      <SourceDocumentCard document={sourceDocument} />

      <MetadataCard award={award} />
    </div>
  );
}

function ExtractionSection({
  award,
  reports,
}: {
  award: AwardWithFunder;
  reports: AwardReportSummary[];
}) {
  const status = award.extraction_status as ExtractionStatus;

  if (status === "pending" || status === "running") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Extracting reporting requirements...
          </CardTitle>
          <CardDescription>
            We are parsing the source document to identify every report,
            narrative field, and due date this funder expects. This usually
            takes under a minute.
          </CardDescription>
        </CardHeader>
        <ExtractionStatusPoller awardId={award.id} currentStatus={status} />
      </Card>
    );
  }

  if (status === "ok") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2
              className="h-4 w-4 text-emerald-700 dark:text-emerald-400"
              aria-hidden
            />
            Extraction complete
          </CardTitle>
          <CardDescription>
            {reports.length}{" "}
            {reports.length === 1 ? "report" : "reports"} scheduled.{" "}
            <Link
              href={`/app/reports?award_id=${award.id}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              View the reports list
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // manual_review or failed
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          {status === "manual_review"
            ? "Extraction needs manual review"
            : "Extraction failed"}
        </CardTitle>
        <CardDescription>
          {award.extraction_error ??
            (status === "manual_review"
              ? "We could not validate the extracted requirements. A human reviewer should verify the source document and try again."
              : "Something went wrong while extracting. Check the source document and retry.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <RetryExtractionButton awardId={award.id} />
        <p className="text-xs text-muted-foreground">
          Attempts so far. {award.extraction_attempts}.
        </p>
      </CardContent>
    </Card>
  );
}

function ReportsSection({
  award,
  reports,
}: {
  award: AwardWithFunder;
  reports: AwardReportSummary[];
}) {
  if (award.extraction_status !== "ok") return null;
  if (reports.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled reports</CardTitle>
          <CardDescription>
            Extraction completed but no scheduled reports were created. This
            funder may use a final-only reporting cadence.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scheduled reports</CardTitle>
        <CardDescription>
          One row per reporting instance. Click any report to start drafting.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-hidden rounded-b-lg border-t">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Title
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Due
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="w-20 px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {reports.map((report) => (
                <tr key={report.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/app/reports/${report.id}`}
                      className="text-foreground hover:underline"
                    >
                      {report.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {report.report_type ?? "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">
                    {formatDateTime(report.due_at)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {report.status}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/app/reports/${report.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceDocumentCard({
  document,
}: {
  document: AwardSourceDocumentSummary | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Source document</CardTitle>
        <CardDescription>
          The document the extractor read to infer reporting requirements.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {document ? (
          <Link
            href={`/app/documents/${document.id}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline underline-offset-2"
          >
            {document.filename}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            No source document was attached to this award.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MetadataCard({ award }: { award: AwardWithFunder }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Metadata</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <MetaRow label="Award number" value={award.award_number} />
        <MetaRow label="CFDA number" value={award.cfda_number} />
        <MetaRow label="UEI" value={award.uei} />
        <MetaRow label="Funder type" value={award.funders?.type ?? null} />
      </CardContent>
    </Card>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">{value && value.length > 0 ? value : "—"}</p>
    </div>
  );
}

async function loadAward(id: string): Promise<AwardDetailData | null> {
  try {
    const { supabase, tenantId } = await supabaseForTenant();
    if (!tenantId) return null;

    const { data: award, error } = await supabase
      .from("awards")
      .select("*, funders(id, name, type, slug)")
      .eq("id", id)
      .maybeSingle();

    if (error || !award) return null;

    const { data: reports } = await supabase
      .from("reports")
      .select("id, title, report_type, due_at, status")
      .eq("award_id", id)
      .order("due_at", { ascending: true });

    let sourceDocument: AwardSourceDocumentSummary | null = null;
    if (award.source_document_id) {
      const { data: doc } = await supabase
        .from("documents")
        .select("id, filename")
        .eq("id", award.source_document_id)
        .maybeSingle();
      if (doc) sourceDocument = { id: doc.id, filename: doc.filename };
    }

    return {
      award: award as AwardWithFunder,
      reports: (reports ?? []) as AwardReportSummary[],
      sourceDocument,
    };
  } catch {
    return null;
  }
}

function formatUsd(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${formatDate(start)} to ${formatDate(end)}`;
}
