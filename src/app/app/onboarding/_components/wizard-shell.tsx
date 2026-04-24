"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";

const TOTAL_STEPS = 6;

const STEP_TITLES: Record<number, string> = {
  1: "Organization info",
  2: "Upload documents",
  3: "Your awards",
  4: "Funders to track",
  5: "Invite your team",
  6: "Deployment posture",
};

interface WizardShellProps {
  step: number;
  children: ReactNode;
  onNext?: () => Promise<boolean>;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideBack?: boolean;
}

export function WizardShell({
  step,
  children,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  hideBack = false,
}: WizardShellProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [savingLater, setSavingLater] = useState(false);

  const progressPct = Math.round(((step - 1) / TOTAL_STEPS) * 100);

  async function handleNext() {
    if (!onNext) {
      await persistStep(step);
      if (step < TOTAL_STEPS) {
        router.push(`/app/onboarding/step/${step + 1}`);
      }
      return;
    }
    setSaving(true);
    try {
      const ok = await onNext();
      if (ok) {
        await persistStep(step);
        if (step < TOTAL_STEPS) {
          router.push(`/app/onboarding/step/${step + 1}`);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLater() {
    setSavingLater(true);
    try {
      await persistStep(step);
    } finally {
      setSavingLater(false);
    }
    router.push("/app");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Step {step} of {TOTAL_STEPS}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {STEP_TITLES[step] ?? "Setup"}
        </h1>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-label={`Step ${step} of ${TOTAL_STEPS}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Step content */}
      <div>{children}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3">
          {!hideBack && step > 1 && (
            <Button
              variant="ghost"
              onClick={() => router.push(`/app/onboarding/step/${step - 1}`)}
              disabled={saving || savingLater}
            >
              Back
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveLater}
            disabled={saving || savingLater}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            {savingLater ? "Saving..." : "Save and continue later"}
          </button>
          <Button
            onClick={handleNext}
            disabled={nextDisabled || saving || savingLater}
          >
            {saving ? "Saving..." : nextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

async function persistStep(step: number): Promise<void> {
  try {
    await fetch("/api/onboarding/step", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step }),
    });
  } catch {
    // Best-effort, non-blocking.
  }
}
