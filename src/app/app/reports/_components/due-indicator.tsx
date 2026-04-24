import { cn } from "@/lib/utils";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface DueIndicatorProps {
  /** ISO timestamp of the due date. */
  dueAt: string;
  /** Override now() for deterministic tests. */
  now?: Date;
  className?: string;
}

export type DueTone = "overdue" | "soon" | "upcoming" | "distant";

export interface DueDescriptor {
  tone: DueTone;
  relative: string;
  absolute: string;
  days: number;
}

/**
 * Compute the relative label, absolute date, and visual tone for a report
 * due date.
 *
 * Tone thresholds (absolute):
 *   overdue  : due date has passed
 *   soon     : within 14 days
 *   upcoming : within 30 days
 *   distant  : anything further out
 */
export function describeDue(dueAt: string, now: Date = new Date()): DueDescriptor {
  const due = new Date(dueAt);
  const msDiff = due.getTime() - now.getTime();
  // Floor toward zero so "in 0 days" lands on today.
  const days = Math.floor(msDiff / MS_PER_DAY);

  const absolute = due.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  let relative: string;
  let tone: DueTone;

  if (msDiff < 0) {
    const overdueDays = Math.max(1, Math.abs(Math.ceil(msDiff / MS_PER_DAY)));
    relative =
      overdueDays === 1 ? "overdue by 1 day" : `overdue by ${overdueDays} days`;
    tone = "overdue";
  } else if (days === 0) {
    relative = "due today";
    tone = "soon";
  } else if (days === 1) {
    relative = "in 1 day";
    tone = "soon";
  } else if (days <= 14) {
    relative = `in ${days} days`;
    tone = "soon";
  } else if (days <= 30) {
    relative = `in ${days} days`;
    tone = "upcoming";
  } else {
    relative = `in ${days} days`;
    tone = "distant";
  }

  return { tone, relative, absolute, days };
}

const TONE_CLASS: Record<DueTone, string> = {
  overdue: "text-destructive",
  soon: "text-amber-700 dark:text-amber-300",
  upcoming: "text-muted-foreground",
  distant: "text-muted-foreground",
};

export function DueIndicator({ dueAt, now, className }: DueIndicatorProps) {
  const d = describeDue(dueAt, now);
  return (
    <span
      data-tone={d.tone}
      className={cn(
        "inline-flex flex-col text-sm tabular-nums",
        TONE_CLASS[d.tone],
        className,
      )}
    >
      <span className="font-medium capitalize">{d.relative}</span>
      <span className="text-xs text-muted-foreground">{d.absolute}</span>
    </span>
  );
}
