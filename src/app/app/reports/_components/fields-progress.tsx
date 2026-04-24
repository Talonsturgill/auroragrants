import { cn } from "@/lib/utils";

export interface FieldsProgressProps {
  complete: number;
  total: number;
  className?: string;
  /** Show just the bar, without the numeric label. */
  barOnly?: boolean;
}

/**
 * Horizontal progress bar + "x/y complete" label for a report's approved
 * fields. Color ramps from gray (nothing done) to emerald (all done).
 */
export function FieldsProgress({
  complete,
  total,
  className,
  barOnly = false,
}: FieldsProgressProps) {
  const safeTotal = Math.max(0, total);
  const safeComplete = Math.min(Math.max(0, complete), safeTotal);
  const pct = safeTotal === 0 ? 0 : (safeComplete / safeTotal) * 100;
  const done = safeTotal > 0 && safeComplete === safeTotal;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {!barOnly && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            {safeComplete}/{safeTotal} complete
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={safeComplete}
        aria-label={`${safeComplete} of ${safeTotal} fields complete`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            done ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
