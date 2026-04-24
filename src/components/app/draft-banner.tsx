import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Persistent "Draft, review before submission" banner.
 *
 * Required on every page that surfaces AI-generated content to reviewers, per
 * CLAUDE.md. Rendered with role="status" aria-live="polite" so screen readers
 * announce it on mount.
 *
 * Variants:
 * - `default` is the compact banner used on the report-detail page.
 * - `expanded` is the wider variant used on the per-field drafter, which sits
 *   directly under the editor header and needs a longer reinforcing line.
 */
export type DraftBannerVariant = "default" | "expanded";

export function DraftBanner({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: DraftBannerVariant;
}) {
  const expanded = variant === "expanded";
  return (
    <div
      role="status"
      aria-live="polite"
      data-variant={variant}
      className={cn(
        "flex items-start gap-3 rounded-md border border-destructive bg-yellow-50 text-sm text-yellow-900 shadow-sm dark:bg-yellow-900/20 dark:text-yellow-100",
        expanded ? "px-5 py-4" : "px-4 py-3",
        className,
      )}
    >
      <AlertTriangle
        aria-hidden="true"
        className={cn(
          "mt-0.5 shrink-0 text-destructive",
          expanded ? "h-5 w-5" : "h-4 w-4",
        )}
      />
      <div className="space-y-1">
        <p className="font-medium">Draft, review before submission</p>
        {expanded ? (
          <p className="text-xs text-yellow-800 dark:text-yellow-200">
            AI-generated content must be reviewed by an authorized signer
            before it leaves this organization. No export happens without an
            explicit attestation.
          </p>
        ) : null}
      </div>
    </div>
  );
}
