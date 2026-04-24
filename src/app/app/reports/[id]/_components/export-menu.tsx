"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ExportFormat = "pdf" | "docx" | "text";

const FORMATS: Array<{ key: ExportFormat; label: string; hint: string }> = [
  { key: "pdf", label: "PDF", hint: "Portable document, print-ready." },
  { key: "docx", label: "DOCX", hint: "Microsoft Word, editable." },
  { key: "text", label: "Plain text", hint: "Funder portal paste." },
];

/**
 * Dropdown menu for exporting an approved report. When the parent passes
 * `isReady = false` the trigger renders as disabled with a tooltip; no
 * menu content is mounted. When `isReady = true` the user can choose one
 * of three formats. On click we POST to `/api/reports/[id]/export` with
 * the selected format, read the returned blob, and trigger a browser
 * download via an object URL.
 *
 * Errors are surfaced via a small message below the menu. The caller is
 * responsible for refetching the report after the download completes.
 */
export function ExportMenu({
  reportId,
  isReady,
  className,
}: {
  reportId: string;
  isReady: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: ExportFormat) {
    setPending(format);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) {
        let message = `Export failed (${res.status}).`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) {
            message = `Export failed: ${body.error}.`;
          }
        } catch {
          // fall through; keep the generic message
        }
        setError(message);
        return;
      }
      const blob = await res.blob();
      const filename =
        parseFilenameFromDisposition(
          res.headers.get("content-disposition") ?? "",
        ) ?? defaultFilename(reportId, format);

      triggerDownload(blob, filename);
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(`Export failed: ${message}`);
    } finally {
      setPending(null);
    }
  }

  if (!isReady) {
    return (
      <div className={cn("flex flex-col items-end gap-1", className)}>
        <Button
          type="button"
          variant="outline"
          disabled
          aria-disabled="true"
          title="Approve all required fields first."
          data-testid="export-menu-trigger-disabled"
        >
          <Download className="mr-2 h-4 w-4" aria-hidden />
          Export report
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("relative flex flex-col items-end gap-1", className)}>
      <Button
        type="button"
        variant="default"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="export-menu-trigger"
      >
        <Download className="mr-2 h-4 w-4" aria-hidden />
        Export report
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="Export format"
          className="absolute right-0 top-full z-10 mt-2 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {FORMATS.map((fmt) => (
            <button
              key={fmt.key}
              type="button"
              role="menuitem"
              disabled={pending !== null}
              onClick={() => handleExport(fmt.key)}
              data-format={fmt.key}
              className="flex w-full flex-col items-start rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
            >
              <span className="flex items-center gap-2 font-medium">
                {pending === fmt.key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {fmt.label}
              </span>
              <span className="text-xs text-muted-foreground">{fmt.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function defaultFilename(reportId: string, format: ExportFormat): string {
  const ext = format === "text" ? "txt" : format;
  return `report-${reportId}.${ext}`;
}

function parseFilenameFromDisposition(
  disposition: string,
): string | null {
  if (!disposition) return null;
  const quoted = disposition.match(/filename="([^"]+)"/i);
  if (quoted) return quoted[1];
  const bare = disposition.match(/filename=([^;]+)/i);
  if (bare) return bare[1].trim();
  return null;
}

/**
 * Fire a browser download via an anchor element. Exported for tests.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release the object URL on the next tick so the download has time to
  // start in browsers that defer the navigation.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
