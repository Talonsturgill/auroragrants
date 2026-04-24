"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { cn } from "@/lib/utils";
import type { ReportStatus } from "@/lib/types/reports";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterBarProps {
  funders: FilterOption[];
  awards: FilterOption[];
  statuses: { value: ReportStatus; label: string }[];
}

const ALL_VALUE = "";

export function FilterBar({ funders, awards, statuses }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = useMemo(
    () => ({
      funder: searchParams.get("funder") ?? ALL_VALUE,
      award: searchParams.get("award") ?? ALL_VALUE,
      status: searchParams.get("status") ?? ALL_VALUE,
    }),
    [searchParams],
  );

  const hasAny = current.funder || current.award || current.status;

  const updateParam = useCallback(
    (key: "funder" | "award" | "status", value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === ALL_VALUE) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `/app/reports?${qs}` : "/app/reports");
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
      <Select
        id="funder-filter"
        label="Funder"
        value={current.funder}
        onChange={(v) => updateParam("funder", v)}
        options={[{ value: ALL_VALUE, label: "All funders" }, ...funders]}
      />
      <Select
        id="award-filter"
        label="Award"
        value={current.award}
        onChange={(v) => updateParam("award", v)}
        options={[{ value: ALL_VALUE, label: "All awards" }, ...awards]}
      />
      <Select
        id="status-filter"
        label="Status"
        value={current.status}
        onChange={(v) => updateParam("status", v)}
        options={[
          { value: ALL_VALUE, label: "All statuses" },
          ...statuses.map((s) => ({ value: s.value, label: s.label })),
        ]}
      />
      {hasAny ? (
        <Link
          href="/app/reports"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  className?: string;
}) {
  return (
    <label htmlFor={id} className={cn("flex flex-col gap-1 text-xs", className)}>
      <span className="text-muted-foreground">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-[9rem] rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((opt) => (
          <option key={opt.value || "__all__"} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
