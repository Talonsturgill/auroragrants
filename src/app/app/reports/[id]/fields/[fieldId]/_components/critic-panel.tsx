"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  CriticFix,
  Critique,
  FixSeverity,
  RubricScore,
} from "@/lib/types/draft";

interface CriticPanelProps {
  critique: Critique | null;
  className?: string;
  defaultOpen?: boolean;
}

const SEVERITY_STYLES: Record<FixSeverity, { badge: string; label: string }> = {
  high: {
    badge: "border-red-300 bg-red-100 text-red-900",
    label: "High",
  },
  medium: {
    badge: "border-amber-300 bg-amber-100 text-amber-900",
    label: "Medium",
  },
  low: {
    badge: "border-slate-300 bg-slate-100 text-slate-700",
    label: "Low",
  },
};

const SEVERITY_ORDER: FixSeverity[] = ["high", "medium", "low"];

function scoreColor(score: 0 | 1 | 2): string {
  if (score === 2) return "bg-emerald-500";
  if (score === 1) return "bg-amber-500";
  return "bg-red-500";
}

function clampOverall(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

function OverallGauge({ score }: { score: number }) {
  const v = clampOverall(score);
  const pct = v * 10;
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - pct / 100);
  const stroke =
    v >= 8 ? "stroke-emerald-500" : v >= 6 ? "stroke-amber-500" : "stroke-red-500";

  return (
    <div
      className="flex items-center gap-3"
      role="img"
      aria-label={`Overall Critic score ${v.toFixed(1)} out of 10`}
    >
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle
          cx="36"
          cy="36"
          r={radius}
          className="stroke-muted"
          strokeWidth="6"
          fill="none"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          className={cn(stroke, "transition-[stroke-dashoffset]")}
          strokeWidth="6"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div>
        <div className="text-2xl font-semibold tabular-nums">
          {v.toFixed(1)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            /10
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Overall Critic score</p>
      </div>
    </div>
  );
}

function RubricRow({ row }: { row: RubricScore }) {
  return (
    <tr data-rubric-id={row.rubric_item_id}>
      <td className="py-2 pr-2 align-top">
        <p className="font-medium text-foreground">{row.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.justification}
        </p>
      </td>
      <td className="py-2 pl-2 align-top text-right">
        <span
          data-score={row.score}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white",
            scoreColor(row.score),
          )}
          aria-label={`Score ${row.score} out of 2`}
        >
          {row.score}
        </span>
      </td>
    </tr>
  );
}

function FixItem({ fix }: { fix: CriticFix }) {
  const sev = SEVERITY_STYLES[fix.severity];
  return (
    <li
      data-severity={fix.severity}
      className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm"
    >
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          sev.badge,
        )}
      >
        {sev.label}
      </span>
      <p className="leading-snug text-foreground">{fix.description}</p>
    </li>
  );
}

export function CriticPanel({
  critique,
  className,
  defaultOpen = true,
}: CriticPanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  if (!critique) {
    return (
      <section
        data-component="critic-panel"
        className={cn("rounded-lg border bg-card p-4 text-sm", className)}
      >
        <h3 className="font-semibold">Critic feedback</h3>
        <p className="mt-2 text-muted-foreground">
          No Critic run yet. Generate a draft to see rubric scores and fixes.
        </p>
      </section>
    );
  }

  const groupedFixes = React.useMemo(() => {
    const byKey: Record<FixSeverity, CriticFix[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const f of critique.fixes) byKey[f.severity].push(f);
    return byKey;
  }, [critique.fixes]);

  return (
    <section
      data-component="critic-panel"
      className={cn("rounded-lg border bg-card", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
      >
        <span>Critic feedback</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-4 border-t px-4 py-4">
          <OverallGauge score={critique.overall_score} />

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rubric scores
            </h4>
            {critique.rubric_scores.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rubric items returned.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sr-only">
                  <tr>
                    <th>Rubric item</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {critique.rubric_scores.map((r) => (
                    <RubricRow key={r.rubric_item_id} row={r} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fixes
            </h4>
            {critique.fixes.length === 0 ? (
              <p
                data-testid="no-fixes"
                className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
              >
                No fixes recommended. The draft cleared the Critic.
              </p>
            ) : (
              <div className="space-y-3">
                {SEVERITY_ORDER.map((sev) => {
                  const list = groupedFixes[sev];
                  if (list.length === 0) return null;
                  return (
                    <div key={sev} data-severity-group={sev}>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {SEVERITY_STYLES[sev].label} severity
                      </p>
                      <ul className="space-y-2">
                        {list.map((f) => (
                          <FixItem key={f.id} fix={f} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
