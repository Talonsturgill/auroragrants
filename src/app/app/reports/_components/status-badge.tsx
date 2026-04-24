import {
  CheckCircle2,
  Circle,
  Clock,
  FileCheck,
  FileEdit,
  RefreshCw,
  Send,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FieldStatus, ReportStatus } from "@/lib/types/reports";

type IconType = typeof CheckCircle2;

interface Variant {
  label: string;
  icon: IconType;
  className: string;
}

const REPORT_VARIANTS: Record<ReportStatus, Variant> = {
  upcoming: {
    label: "Upcoming",
    icon: Clock,
    className:
      "border-transparent bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
  },
  drafting: {
    label: "Drafting",
    icon: FileEdit,
    className:
      "border-transparent bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  },
  ready_for_review: {
    label: "Ready for review",
    icon: FileCheck,
    className:
      "border-transparent bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  },
  submitted: {
    label: "Submitted",
    icon: Send,
    className:
      "border-transparent bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  },
  accepted: {
    label: "Accepted",
    icon: CheckCircle2,
    className:
      "border-transparent bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100",
  },
  revision_requested: {
    label: "Revision requested",
    icon: RefreshCw,
    className:
      "border-transparent bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
  },
};

const FIELD_VARIANTS: Record<FieldStatus, Variant> = {
  not_started: {
    label: "Not started",
    icon: Circle,
    className:
      "border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  drafting: {
    label: "Drafting",
    icon: FileEdit,
    className:
      "border-transparent bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  },
  ready_for_review: {
    label: "Ready for review",
    icon: FileCheck,
    className:
      "border-transparent bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    className:
      "border-transparent bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  },
  submitted: {
    label: "Submitted",
    icon: Send,
    className:
      "border-transparent bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  },
  revision_requested: {
    label: "Revision requested",
    icon: RefreshCw,
    className:
      "border-transparent bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-100",
  },
};

export function ReportStatusBadge({
  status,
  className,
}: {
  status: ReportStatus;
  className?: string;
}) {
  const variant = REPORT_VARIANTS[status];
  const Icon = variant.icon;
  return (
    <Badge
      role="status"
      aria-label={`Report status ${variant.label}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        variant.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      <span>{variant.label}</span>
    </Badge>
  );
}

export function FieldStatusBadge({
  status,
  className,
}: {
  status: FieldStatus;
  className?: string;
}) {
  const variant = FIELD_VARIANTS[status];
  const Icon = variant.icon;
  return (
    <Badge
      role="status"
      aria-label={`Field status ${variant.label}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        variant.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      <span>{variant.label}</span>
    </Badge>
  );
}
