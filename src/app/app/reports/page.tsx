import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseForTenant } from "@/lib/supabase/server";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/types/reports";

import { DueIndicator, describeDue } from "./_components/due-indicator";
import { FieldsProgress } from "./_components/fields-progress";
import { FilterBar } from "./_components/filter-bar";
import { ReportStatusBadge } from "./_components/status-badge";

export const dynamic = "force-dynamic";

type AwardJoin = {
  id: string;
  program_name: string;
  funder_id: string | null;
  funders: { id: string; name: string } | null;
};

type ReportRow = {
  id: string;
  title: string;
  status: ReportStatus;
  report_type: string | null;
  due_at: string;
  period_start: string;
  period_end: string;
  award_id: string;
  award: AwardJoin | null;
  report_fields: { count: number }[] | { count: number } | null;
  approved_fields: { count: number }[] | { count: number } | null;
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  upcoming: "Upcoming",
  drafting: "Drafting",
  ready_for_review: "Ready for review",
  submitted: "Submitted",
  accepted: "Accepted",
  revision_requested: "Revision requested",
};

function isReportStatus(v: string | null | undefined): v is ReportStatus {
  return !!v && (REPORT_STATUSES as string[]).includes(v);
}

function countFromAgg(
  v: { count: number }[] | { count: number } | null | undefined,
): number {
  if (!v) return 0;
  if (Array.isArray(v)) return v[0]?.count ?? 0;
  return v.count ?? 0;
}

function titleCaseWords(s: string | null): string {
  if (!s) return "";
  return s
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface PageProps {
  searchParams: Promise<{
    funder?: string;
    award?: string;
    status?: string;
  }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = {
    funder: typeof params.funder === "string" ? params.funder : undefined,
    award: typeof params.award === "string" ? params.award : undefined,
    status: isReportStatus(params.status) ? params.status : undefined,
  };

  const { supabase, tenantId } = await supabaseForTenant();

  let rows: ReportRow[] = [];
  let awardOptions: { value: string; label: string }[] = [];
  let funderOptions: { value: string; label: string }[] = [];
  let fetchError: string | null = null;

  if (!tenantId) {
    fetchError = "no_tenant";
  } else {
    let query = supabase
      .from("reports")
      .select(
        "id, title, status, report_type, due_at, period_start, period_end, award_id, " +
          "award:awards!inner(id, program_name, funder_id, funders(id, name)), " +
          "report_fields(count), " +
          "approved_fields:report_fields(count)",
      )
      .order("due_at", { ascending: true });

    if (filters.award) {
      query = query.eq("award_id", filters.award);
    }
    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.funder) {
      query = query.eq("award.funder_id", filters.funder);
    }

    // Count "approved" fields via embedded aggregate filter.
    // The Supabase syntax for filtering an embedded aggregate is an
    // additional filter on the embedded relation using `.eq(...)` with the
    // nested path.
    // Use `.eq("approved_fields.human_approved", true)` which filters the
    // aggregate count to approved fields only.
    query = query.eq("approved_fields.human_approved", true);

    const { data, error } = await query;
    if (error) {
      fetchError = error.message;
    } else {
      rows = (data ?? []) as unknown as ReportRow[];
    }

    // Fetch award + funder options for the filter dropdowns. Pull from
    // awards scoped by RLS (current tenant).
    type AwardOption = {
      id: string;
      program_name: string;
      funders: { id: string; name: string } | null;
    };
    const { data: awardData } = await supabase
      .from("awards")
      .select("id, program_name, funders(id, name)")
      .order("program_name", { ascending: true });

    const funderMap = new Map<string, string>();
    const awardList = (awardData ?? []) as unknown as AwardOption[];
    awardOptions = awardList.map((a) => {
      if (a.funders?.id && a.funders?.name) {
        funderMap.set(a.funders.id, a.funders.name);
      }
      return {
        value: a.id,
        label: a.funders?.name
          ? `${a.program_name} (${a.funders.name})`
          : a.program_name,
      };
    });
    funderOptions = Array.from(funderMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const now = new Date();
  const upcomingWithin30 = rows.filter((r) => {
    const d = describeDue(r.due_at, now);
    return d.tone !== "overdue" && d.days <= 30;
  }).length;
  const draftingCount = rows.filter((r) => r.status === "drafting").length;
  const readyCount = rows.filter((r) => r.status === "ready_for_review").length;

  const statusOptions = REPORT_STATUSES.map((s) => ({
    value: s,
    label: STATUS_LABELS[s],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Compliance reports scheduled from your registered awards.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Upcoming in 30 days"
          value={upcomingWithin30}
          hint="Reports due within the next 30 days"
        />
        <SummaryCard title="Drafting" value={draftingCount} />
        <SummaryCard title="Ready for review" value={readyCount} />
      </div>

      <FilterBar
        funders={funderOptions}
        awards={awardOptions}
        statuses={statusOptions}
      />

      {fetchError && fetchError !== "no_tenant" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Could not load reports. Try refreshing the page.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No reports scheduled yet"
          description="Register an award and the extractor will populate reports automatically."
        />
      ) : (
        <ReportsTable rows={rows} now={now} />
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReportsTable({ rows, now }: { rows: ReportRow[]; now: Date }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Award
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Report type
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Due
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Fields
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const total = countFromAgg(r.report_fields);
            const approved = countFromAgg(r.approved_fields);
            const funderName = r.award?.funders?.name ?? "Unknown funder";
            const program = r.award?.program_name ?? "";
            return (
              <tr key={r.id} className="group bg-card hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link
                    href={`/app/reports/${r.id}`}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {r.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div className="flex flex-col">
                    <span className="text-foreground">{program}</span>
                    <span className="text-xs">{funderName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {titleCaseWords(r.report_type) || "—"}
                </td>
                <td className="px-4 py-3">
                  <DueIndicator dueAt={r.due_at} now={now} />
                </td>
                <td className="px-4 py-3">
                  <ReportStatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <FieldsProgress
                    complete={approved}
                    total={total}
                    className="min-w-[8rem]"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
