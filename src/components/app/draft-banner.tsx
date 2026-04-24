import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Persistent "Draft, review before submission" banner.
 *
 * Required on every page that surfaces AI-generated content to reviewers, per
 * CLAUDE.md. Rendered with role="status" aria-live="polite" so screen readers
 * announce it on mount.
 */
export function DraftBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-md border border-destructive bg-yellow-50 px-4 py-3 text-sm text-yellow-900 shadow-sm dark:bg-yellow-900/20 dark:text-yellow-100",
        className,
      )}
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
      />
      <p className="font-medium">Draft, review before submission</p>
    </div>
  );
}
