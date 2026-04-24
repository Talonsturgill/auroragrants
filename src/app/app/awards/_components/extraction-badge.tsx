"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ExtractionStatus =
  | "pending"
  | "running"
  | "ok"
  | "manual_review"
  | "failed";

export function isExtractionTerminal(status: ExtractionStatus): boolean {
  return status === "ok" || status === "manual_review" || status === "failed";
}

export function isExtractionInFlight(status: ExtractionStatus): boolean {
  return status === "pending" || status === "running";
}

interface ExtractionBadgeProps {
  status: ExtractionStatus;
  error?: string | null;
  className?: string;
}

const STATUS_CONFIG: Record<
  ExtractionStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    /**
     * Color classes chosen to guarantee >=4.5:1 contrast against the light
     * and dark tokens in tailwind.config.ts, matching the documents
     * StatusBadge palette (gray/blue/green/amber/red).
     */
    className: string;
    srLabel: string;
  }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className:
      "border-transparent bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
    srLabel: "Extraction pending",
  },
  running: {
    label: "Running",
    icon: Loader2,
    className:
      "border-transparent bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
    srLabel: "Extraction in progress",
  },
  ok: {
    label: "Extracted",
    icon: CheckCircle2,
    className:
      "border-transparent bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
    srLabel: "Extraction complete",
  },
  manual_review: {
    label: "Manual review",
    icon: AlertTriangle,
    className:
      "border-transparent bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
    srLabel: "Extraction needs manual review",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className:
      "border-transparent bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
    srLabel: "Extraction failed",
  },
};

export function ExtractionBadge({
  status,
  error,
  className,
}: ExtractionBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const spinning = status === "running";

  const hoverTitle =
    (status === "failed" || status === "manual_review") && error
      ? error
      : config.label;

  return (
    <Badge
      role="status"
      aria-label={config.srLabel}
      title={hoverTitle}
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1",
        config.className,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("h-3 w-3", spinning && "animate-spin")}
      />
      <span>{config.label}</span>
    </Badge>
  );
}
