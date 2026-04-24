"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { WizardShell } from "../wizard-shell";

interface AwardRow {
  id: string;
  program_name: string;
  amount_usd: number;
}

export function Step3Awards() {
  const [awards, setAwards] = useState<AwardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/awards")
      .then((r) => r.json())
      .then((d: { awards?: AwardRow[] }) => setAwards(d.awards ?? []))
      .catch(() => setAwards([]))
      .finally(() => setLoading(false));
  }, []);

  const hasAwards = awards.length > 0;

  return (
    <WizardShell
      step={3}
      nextLabel={hasAwards ? "Continue" : "Skip for now"}
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Register the grants your organization has received. AuroraGrants will
          extract reporting requirements from your award letters automatically.
        </p>

        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/app/awards/new">Add award manually</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/app/documents?type=award_letter">
              Upload award letter
            </Link>
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading awards...</p>
        ) : hasAwards ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-green-700">
              {awards.length} award{awards.length !== 1 ? "s" : ""} registered.
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {awards.map((a) => (
                <li key={a.id} className="truncate">
                  {a.program_name}
                  {a.amount_usd
                    ? ` — $${a.amount_usd.toLocaleString()}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No awards registered yet. You can skip and add them from the Awards
            page any time.
          </p>
        )}
      </div>
    </WizardShell>
  );
}
