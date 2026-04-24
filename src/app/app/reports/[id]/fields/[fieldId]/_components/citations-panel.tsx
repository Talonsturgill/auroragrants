"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types/draft";

interface CitationsPanelProps {
  citations: Citation[];
  /**
   * Refs for each citation pill in the editor, keyed by citation id. Supplied
   * by the page, which owns the ref map so both the editor and this panel
   * can address the same DOM nodes.
   */
  pillRefs: React.MutableRefObject<Map<number, HTMLButtonElement | null>>;
  className?: string;
  defaultOpen?: boolean;
}

/**
 * Numbered list of citations. Clicking an entry scrolls the corresponding
 * `[n]` pill in the editor into view and briefly highlights it via a
 * data-attribute the editor can style.
 */
export function CitationsPanel({
  citations,
  pillRefs,
  className,
  defaultOpen = true,
}: CitationsPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  const handleActivate = React.useCallback(
    (citationId: number) => {
      const el = pillRefs.current.get(citationId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.setAttribute("data-highlight", "true");
      window.setTimeout(() => {
        el.removeAttribute("data-highlight");
      }, 1500);
      el.focus({ preventScroll: true });
    },
    [pillRefs],
  );

  const sorted = React.useMemo(
    () => [...citations].sort((a, b) => a.citation_id - b.citation_id),
    [citations],
  );

  return (
    <section
      data-component="citations-panel"
      className={cn("rounded-lg border bg-card", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
      >
        <span>Citations ({sorted.length})</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {open ? (
        <div className="border-t">
          {sorted.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No citations in this draft yet.
            </p>
          ) : (
            <ol className="divide-y">
              {sorted.map((c) => {
                const pages =
                  c.page_end !== c.page_start
                    ? `pp. ${c.page_start}–${c.page_end}`
                    : `p. ${c.page_start}`;
                return (
                  <li key={c.citation_id} data-citation-id={c.citation_id}>
                    <button
                      type="button"
                      onClick={() => handleActivate(c.citation_id)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        [{c.citation_id}]
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {c.document_title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {pages}
                          {c.section_heading ? ` · ${c.section_heading}` : ""}
                          {c.source === "funder" ? " · funder" : " · tenant"}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                          {c.excerpt}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
