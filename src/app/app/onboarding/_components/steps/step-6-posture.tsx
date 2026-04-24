"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { WizardShell } from "../wizard-shell";

type Posture = "shared" | "sovereignty";

export function Step6Posture() {
  const router = useRouter();
  const [posture, setPosture] = useState<Posture>("shared");
  const [error, setError] = useState("");

  async function handleNext(): Promise<boolean> {
    setError("");

    // Persist posture choice.
    try {
      await fetch("/api/onboarding/step", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: 6 }),
      });

      // Mark onboarding complete.
      await fetch("/api/onboarding/org-info", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }).catch(() => {
        // non-critical — we just want to flush the step
      });
    } catch {
      // Non-critical.
    }

    if (posture === "sovereignty") {
      router.push("/app/onboarding/sovereignty");
      return false; // WizardShell won't advance; we navigate manually.
    }

    // Confetti + redirect to app.
    if (typeof window !== "undefined") {
      window.location.href = "/app?onboarding=complete";
    }
    return false;
  }

  return (
    <WizardShell step={6} onNext={handleNext} nextLabel="Finish setup">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Choose how you want to run AuroraGrants. Both options are free.
        </p>

        <fieldset className="space-y-3">
          <legend className="sr-only">Deployment posture</legend>

          <label className="block cursor-pointer">
            <input
              type="radio"
              name="posture"
              value="shared"
              checked={posture === "shared"}
              onChange={() => setPosture("shared")}
              className="sr-only"
            />
            <Card
              className={`p-4 transition-colors ${
                posture === "shared"
                  ? "border-primary ring-1 ring-primary"
                  : "hover:border-muted-foreground/40"
              }`}
            >
              <p className="font-medium">Shared hosted instance (default)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                AuroraGrants manages infrastructure. Data is isolated by
                tenant but shares underlying compute and storage.
              </p>
            </Card>
          </label>

          <label className="block cursor-pointer">
            <input
              type="radio"
              name="posture"
              value="sovereignty"
              checked={posture === "sovereignty"}
              onChange={() => setPosture("sovereignty")}
              className="sr-only"
            />
            <Card
              className={`p-4 transition-colors ${
                posture === "sovereignty"
                  ? "border-primary ring-1 ring-primary"
                  : "hover:border-muted-foreground/40"
              }`}
            >
              <p className="font-medium">Sovereignty deployment (tribal organizations)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Dedicated infrastructure with zero-data-retention routing,
                BYOK encryption, offline export, and a pre-signed Tribal Data
                Use Agreement. No additional cost.
              </p>
            </Card>
          </label>
        </fieldset>

        {posture === "sovereignty" && (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Selecting this will open the Sovereignty setup flow where you can
            sign the Tribal Data Use Agreement and configure your data residency.
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </WizardShell>
  );
}
