"use client";

import { useEffect, useState } from "react";

import { WizardShell } from "../wizard-shell";

interface Funder {
  id: string;
  name: string;
  type: string;
  scope: string;
}

interface Props {
  initialSubscribedIds?: string[];
}

export function Step4Funders({ initialSubscribedIds = [] }: Props) {
  const [funders, setFunders] = useState<Funder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSubscribedIds),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/funders")
      .then((r) => r.json())
      .then((d: { funders?: Funder[] }) => setFunders(d.funders ?? []))
      .catch(() => setFunders([]))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleNext(): Promise<boolean> {
    setError("");
    const res = await fetch("/api/onboarding/funders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ funder_ids: Array.from(selected) }),
    });
    if (!res.ok) {
      setError("Could not save funder selections. Please try again.");
      return false;
    }
    return true;
  }

  return (
    <WizardShell step={4} onNext={handleNext} nextLabel="Continue">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Choose funders you want to track. You can change this later from your
          settings. Skipping is fine.
        </p>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading funders...</p>
        ) : funders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No funders in the database yet. Continue to the next step.
          </p>
        ) : (
          <fieldset>
            <legend className="sr-only">Select funders to track</legend>
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-2">
              {funders.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/30">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground capitalize">
                        {f.type.replace(/_/g, " ")} — {f.scope.replace(/_/g, " ")}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {selected.size > 0 && (
          <p className="text-xs text-muted-foreground">
            {selected.size} funder{selected.size !== 1 ? "s" : ""} selected.
          </p>
        )}
      </div>
    </WizardShell>
  );
}
