import Link from "next/link";

import { cn } from "@/lib/utils";
import { deriveFieldStatus, type ReportField } from "@/lib/types/reports";

import { StatusPill } from "./status-pill";

interface FieldListProps {
  reportId: string;
  activeFieldId: string;
  fields: ReportField[];
  className?: string;
}

export function sortFields(fields: ReportField[]): ReportField[] {
  return [...fields].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Left-rail list of every `report_field` for the parent report. The active
 * field is highlighted via `aria-current`. Required fields render first.
 * Kept a server-friendly component (no `"use client"`) so the page can
 * render it without a round-trip.
 */
export function FieldList({
  reportId,
  activeFieldId,
  fields,
  className,
}: FieldListProps) {
  const sorted = sortFields(fields);
  const approved = fields.filter((f) => f.human_approved).length;

  return (
    <nav
      data-component="field-list"
      aria-label="Report fields"
      className={cn("rounded-lg border bg-card", className)}
    >
      <div className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Fields
        </p>
        <p className="mt-1 text-sm text-foreground">
          <span className="tabular-nums">{approved}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="tabular-nums">{fields.length}</span>
          <span className="text-muted-foreground"> approved</span>
        </p>
      </div>
      <ul className="divide-y" role="list">
        {sorted.map((f) => {
          const status = deriveFieldStatus(f);
          const isActive = f.id === activeFieldId;
          return (
            <li key={f.id}>
              <Link
                href={`/app/reports/${reportId}/fields/${f.id}`}
                aria-current={isActive ? "page" : undefined}
                data-active={isActive ? "true" : "false"}
                data-field-id={f.id}
                className={cn(
                  "flex flex-col gap-2 px-4 py-3 text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "bg-accent/60",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {f.label}
                  </span>
                  {!f.required ? (
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Optional
                    </span>
                  ) : null}
                </span>
                <StatusPill status={status} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
