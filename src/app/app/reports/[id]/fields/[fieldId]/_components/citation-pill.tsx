"use client";

import * as React from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types/draft";

interface CitationPillProps {
  /** The citation matched by citation_id. If missing, render a muted `[?]`. */
  citation: Citation | null;
  /** 1-indexed number to display inside the pill. */
  index: number;
  /** Optional ref used by the citations panel to scroll to this pill. */
  innerRef?: React.Ref<HTMLButtonElement>;
  /** Called when the pill is clicked. The citations panel wires scroll here. */
  onActivate?: () => void;
  className?: string;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Inline citation chip rendered by `DraftEditor`. Shows `[n]` with a hover
 * tooltip containing the chunk excerpt plus source document + page range.
 *
 * Missing citations (the Writer returned a bare `[n]` with no matching
 * entry in `citations`) render as a visually distinct `[?]` pill so the
 * reviewer can see the gap. This is a hard requirement from CLAUDE.md: the
 * Writer is supposed to say "uncitable" rather than invent a source.
 */
export const CitationPill = React.forwardRef<
  HTMLButtonElement,
  CitationPillProps
>(function CitationPill(
  { citation, index, onActivate, className, innerRef },
  _ref,
) {
  const missing = citation == null;
  const title = missing
    ? "Citation missing"
    : `${citation.document_title}, p. ${citation.page_start}${
        citation.page_end !== citation.page_start
          ? `–${citation.page_end}`
          : ""
      }`;
  const excerpt = missing ? "" : truncate(citation.excerpt ?? "", 80);
  const ariaLabel = missing
    ? `Citation ${index} is missing a source.`
    : `Citation ${index}. ${excerpt} Source ${title}.`;

  const tooltipBody = (
    <div className="space-y-1">
      {missing ? (
        <p className="font-medium text-destructive">Citation missing</p>
      ) : (
        <>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Source
          </p>
          <p className="font-medium">{title}</p>
          {citation.section_heading ? (
            <p className="text-xs text-muted-foreground">
              {citation.section_heading}
            </p>
          ) : null}
          <p className="mt-1 whitespace-pre-line text-xs">
            {truncate(citation.excerpt ?? "", 240)}
          </p>
        </>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltipBody} ariaLabel={ariaLabel}>
      <button
        ref={innerRef}
        type="button"
        data-citation-id={index}
        data-missing={missing ? "true" : "false"}
        onClick={onActivate}
        className={cn(
          "mx-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          missing
            ? "border-destructive/60 bg-red-50 text-destructive hover:bg-red-100 dark:bg-red-950/40"
            : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
          className,
        )}
      >
        [{missing ? "?" : index}]
      </button>
    </Tooltip>
  );
});
