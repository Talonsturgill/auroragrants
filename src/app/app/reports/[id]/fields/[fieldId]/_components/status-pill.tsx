import { cn } from "@/lib/utils";
import type { FieldStatus } from "@/lib/types/reports";

/**
 * Tiny non-icon badge used in the left-rail field list. We intentionally
 * render a color-coded dot instead of the full icon badge to keep the rail
 * visually quiet. For the full badge see
 * `src/app/app/reports/_components/status-badge.tsx`.
 */

const STATUS_STYLES: Record<
  FieldStatus,
  { dot: string; label: string }
> = {
  not_started: {
    dot: "bg-slate-400",
    label: "Not started",
  },
  drafting: {
    dot: "bg-sky-500",
    label: "Drafting",
  },
  ready_for_review: {
    dot: "bg-amber-500",
    label: "Ready for review",
  },
  approved: {
    dot: "bg-emerald-500",
    label: "Approved",
  },
  submitted: {
    dot: "bg-emerald-600",
    label: "Submitted",
  },
  revision_requested: {
    dot: "bg-red-500",
    label: "Revision requested",
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: FieldStatus;
  className?: string;
}) {
  const cfg = STATUS_STYLES[status];
  return (
    <span
      data-status={status}
      aria-label={`Status ${cfg.label}`}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2 py-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)}
      />
      <span>{cfg.label}</span>
    </span>
  );
}
