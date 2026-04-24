"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types/draft";

import { CitationPill } from "./citation-pill";

interface DraftEditorProps {
  /**
   * Raw draft text from the Writer. Contains inline `[n]` tokens. Plain
   * text for v1. A later phase will swap this for TipTap so the reviewer
   * can edit inline while preserving citation spans.
   */
  content: string;
  /**
   * The citation lookup table from the `drafts` row. Each item's
   * `citation_id` must match a `[n]` token in `content`.
   */
  citations: Citation[];
  /**
   * Optional handler fired when a pill is clicked. The right-rail citations
   * panel calls scroll-to-pill on the matching ref.
   */
  onCitationActivate?: (citationId: number) => void;
  /**
   * Registers a ref for each rendered pill so the citations panel can
   * imperatively call `scrollIntoView`. Keyed by citation id.
   */
  registerPillRef?: (id: number, el: HTMLButtonElement | null) => void;
  className?: string;
}

/**
 * Matches `[1]`, `[42]`, but not `[foo]`. The Writer is instructed to emit
 * exactly this token form. Anything else passes through untouched.
 */
const CITATION_TOKEN = /\[(\d+)\]/g;

interface TextSegment {
  kind: "text";
  value: string;
  key: string;
}
interface CiteSegment {
  kind: "cite";
  index: number;
  key: string;
}
type Segment = TextSegment | CiteSegment;

export function tokenizeDraft(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let i = 0;
  for (const match of content.matchAll(CITATION_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) {
      out.push({
        kind: "text",
        value: content.slice(last, start),
        key: `t-${i++}`,
      });
    }
    out.push({
      kind: "cite",
      index: Number(match[1]),
      key: `c-${i++}-${match[1]}`,
    });
    last = start + match[0].length;
  }
  if (last < content.length) {
    out.push({ kind: "text", value: content.slice(last), key: `t-${i++}` });
  }
  return out;
}

/**
 * Renders the draft body with inline citation pills. Read-only for v1.
 * Splits on blank-line to keep paragraph spacing, since raw draft text is
 * plain prose from the Writer.
 */
export function DraftEditor({
  content,
  citations,
  onCitationActivate,
  registerPillRef,
  className,
}: DraftEditorProps) {
  const citationById = React.useMemo(() => {
    const m = new Map<number, Citation>();
    for (const c of citations) m.set(c.citation_id, c);
    return m;
  }, [citations]);

  const paragraphs = React.useMemo(() => {
    // Keep paragraph boundaries. The Writer uses blank lines between paragraphs.
    return content.split(/\n{2,}/g);
  }, [content]);

  return (
    <div
      role="region"
      aria-label="Draft content"
      data-component="draft-editor"
      className={cn(
        "prose prose-sm max-w-none whitespace-pre-wrap text-foreground dark:prose-invert",
        className,
      )}
    >
      {paragraphs.map((p, pi) => {
        const segs = tokenizeDraft(p);
        return (
          <div
            key={`p-${pi}`}
            data-paragraph
            className="mb-4 leading-relaxed last:mb-0"
          >
            {segs.map((s) => {
              if (s.kind === "text") {
                return <span key={s.key}>{s.value}</span>;
              }
              const cite = citationById.get(s.index) ?? null;
              return (
                <CitationPill
                  key={s.key}
                  index={s.index}
                  citation={cite}
                  onActivate={() => onCitationActivate?.(s.index)}
                  innerRef={(el) => registerPillRef?.(s.index, el)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
