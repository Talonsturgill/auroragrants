"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { DraftBanner } from "@/components/app/draft-banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Citation, Critique, Draft } from "@/lib/types/draft";

import { ApproveButton } from "./approve-button";
import { CitationsPanel } from "./citations-panel";
import { CriticPanel } from "./critic-panel";
import { DraftEditor } from "./draft-editor";
import { RegenerateButton } from "./regenerate-button";

interface EditorShellProps {
  fieldId: string;
  fieldLabel: string;
  wordCountMin: number | null;
  wordCountMax: number | null;
  humanApproved: boolean;
  highStakes: boolean;
  draft: Draft | null;
}

function countWords(s: string): number {
  return s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length;
}

function formatWordTarget(
  min: number | null,
  max: number | null,
): string | null {
  if (min && max) return `${min}–${max}`;
  if (max) return `up to ${max}`;
  if (min) return `at least ${min}`;
  return null;
}

/**
 * The interactive center + right rail of the drafter. This is a client
 * component so it can share a ref map between `DraftEditor` and
 * `CitationsPanel` for scroll-to-citation behavior.
 */
export function EditorShell({
  fieldId,
  fieldLabel,
  wordCountMin,
  wordCountMax,
  humanApproved,
  highStakes,
  draft,
}: EditorShellProps) {
  const pillRefs = React.useRef<Map<number, HTMLButtonElement | null>>(
    new Map(),
  );

  const wordCount = draft ? countWords(draft.content) : 0;
  const target = formatWordTarget(wordCountMin, wordCountMax);

  const surfaceDecision = draft?.wce_trace?.surface_decision;
  const surfaceReasons = draft?.wce_trace?.surface_reasons ?? [];
  const overallScore = draft?.wce_trace?.critique?.overall_score;
  const blocked = !!draft && draft.surfaced_to_user === false;
  const flagged =
    !!draft &&
    draft.surfaced_to_user &&
    (draft.eval_passed === false || surfaceDecision === "surface_with_flag");

  const citations: Citation[] = draft?.citations ?? [];
  const critique: Critique | null = draft?.wce_trace?.critique ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Draft editor" className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:sticky sm:top-2 sm:z-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="truncate text-lg font-semibold">{fieldLabel}</h2>
              <p className="text-xs text-muted-foreground">
                <span className="tabular-nums">{wordCount}</span>
                {target ? (
                  <>
                    <span className="mx-1 text-muted-foreground">/</span>
                    <span>{target} words</span>
                  </>
                ) : (
                  <span> words</span>
                )}
                {highStakes ? (
                  <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                    High stakes
                  </span>
                ) : null}
                {typeof overallScore === "number" ? (
                  <span className="ml-2 text-muted-foreground">
                    · Critic {overallScore.toFixed(1)}/10
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RegenerateButton
                fieldId={fieldId}
                currentVersion={draft?.version ?? null}
              />
              <ApproveButton
                fieldId={fieldId}
                alreadyApproved={humanApproved}
                blocked={blocked}
              />
            </div>
          </div>
        </div>

        <DraftBanner variant="expanded" />

        {flagged ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-destructive bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            />
            <div className="space-y-1">
              <p className="font-medium">
                This draft passed the minimum bar but one or more quality checks
                failed.
              </p>
              {draft?.eval_scores?.failed_checks?.length ? (
                <ul className="list-inside list-disc text-xs">
                  {draft.eval_scores.failed_checks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {blocked ? (
          <div
            role="alert"
            data-testid="blocked-card"
            className="rounded-lg border border-destructive bg-card p-6 text-sm"
          >
            <h3 className="mb-2 text-base font-semibold text-destructive">
              Draft did not pass the quality gate
            </h3>
            <p className="text-muted-foreground">
              {typeof overallScore === "number"
                ? `Overall Critic score ${overallScore.toFixed(1)}/10.`
                : "Overall Critic score unavailable."}
            </p>
            {surfaceReasons.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reasons
                </p>
                <ul className="mt-1 list-inside list-disc text-sm">
                  {surfaceReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-4">
              <RegenerateButton
                fieldId={fieldId}
                currentVersion={draft?.version ?? null}
              />
            </div>
          </div>
        ) : draft ? (
          <div className="rounded-lg border bg-card p-5">
            <DraftEditor
              content={draft.content}
              citations={draft.citations}
              registerPillRef={(id, el) => {
                if (el == null) pillRefs.current.delete(id);
                else pillRefs.current.set(id, el);
              }}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            <p className="mb-3">
              No draft yet. Start the Writer to generate the first version.
            </p>
            <Button
              type="button"
              asChild
              className={cn("pointer-events-none opacity-70")}
              variant="outline"
              disabled
            >
              <span>Use Regenerate above to draft</span>
            </Button>
          </div>
        )}
      </section>

      <aside aria-label="Critic and citations" className="space-y-4">
        <CriticPanel critique={critique} />
        <CitationsPanel citations={citations} pillRefs={pillRefs} />
      </aside>
    </div>
  );
}
