import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { supabaseForTenant } from "@/lib/supabase/server";
import type { AwardWithFunder } from "@/lib/types/awards";

import {
  ExtractionBadge,
  type ExtractionStatus,
} from "./_components/extraction-badge";

export const dynamic = "force-dynamic";

export default async function AwardsPage() {
  const awards = await loadAwards();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Awards</h1>
          <p className="text-sm text-muted-foreground">
            Grants your organization has received. Register a new award to
            automatically extract reporting requirements from its award letter.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/awards/new">Register award</Link>
        </Button>
      </div>

      {awards.length === 0 ? (
        <EmptyState
          title="No awards registered yet"
          description="Upload an award letter and register it to automatically extract reporting requirements."
          cta={
            <Button asChild>
              <Link href="/app/awards/new">Register your first award</Link>
            </Button>
          }
        />
      ) : (
        <AwardsTable awards={awards} />
      )}
    </div>
  );
}

async function loadAwards(): Promise<AwardWithFunder[]> {
  try {
    const { supabase, tenantId } = await supabaseForTenant();
    if (!tenantId) return [];

    const { data, error } = await supabase
      .from("awards")
      .select("*, funders(id, name, type, slug)")
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data ?? []) as AwardWithFunder[];
  } catch {
    // DB not provisioned in this environment. Fall back to empty state.
    return [];
  }
}

function AwardsTable({ awards }: { awards: AwardWithFunder[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Program name
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Funder
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Amount
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Awarded
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Period
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Extraction
            </th>
            <th scope="col" className="w-20 px-4 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {awards.map((award) => (
            <tr key={award.id} className="bg-card hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">
                <Link
                  href={`/app/awards/${award.id}`}
                  className="block text-foreground hover:underline"
                >
                  {award.program_name}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {award.funders?.name ?? "Unknown funder"}
              </td>
              <td className="px-4 py-2 tabular-nums text-muted-foreground">
                {formatUsd(award.amount_usd)}
              </td>
              <td className="px-4 py-2 tabular-nums text-muted-foreground">
                {formatDate(award.awarded_at)}
              </td>
              <td className="px-4 py-2 tabular-nums text-muted-foreground">
                {formatPeriod(award.period_start, award.period_end)}
              </td>
              <td className="px-4 py-2">
                <ExtractionBadge
                  status={award.extraction_status as ExtractionStatus}
                  error={award.extraction_error}
                />
              </td>
              <td className="px-4 py-2 text-right">
                <Link
                  href={`/app/awards/${award.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${formatDate(start)} to ${formatDate(end)}`;
}
