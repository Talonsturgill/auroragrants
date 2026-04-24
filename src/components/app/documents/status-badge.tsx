"use client";

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ParseStatus } from "@/lib/types/documents";

interface StatusBadgeProps {
  status: ParseStatus;
  error?: string | null;
  className?: string;
}

const STATUS_CONFIG: Record<
  ParseStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    /**
     * Tailwind classes are chosen to guarantee ≥4.5:1 contrast against both
     * the light and dark tokens in tailwind.config.ts.
     */
    className: string;
    srLabel: string;
  }
> = {
  queued: {
    label: "Queued",
    icon: Clock,
    className:
      "border-transparent bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
    srLabel: "Parse queued",
  },
  parsing: {
    label: "Parsing",
    icon: Loader2,
    className:
      "border-transparent bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
    srLabel: "Parse in progress",
  },
  parsed: {
    label: "Indexed",
    icon: CheckCircle2,
    className:
      "border-transparent bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
    srLabel: "Indexed and ready",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className:
      "border-transparent bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
    srLabel: "Parse failed",
  },
};

export function StatusBadge({ status, error, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const spinning = status === "parsing";

  return (
    <Badge
      role="status"
      aria-label={config.srLabel}
      title={status === "failed" && error ? error : config.label}
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
