"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { WizardShell } from "../wizard-shell";

interface DocRow {
  id: string;
  filename: string;
  kind: string;
}

export function Step2Documents() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d: { documents?: DocRow[] }) => setDocs(d.documents ?? []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  const hasDocs = docs.length > 0;

  async function handleNext(): Promise<boolean> {
    return true;
  }

  return (
    <WizardShell
      step={2}
      onNext={handleNext}
      nextLabel={hasDocs ? "Continue" : "Skip for now"}
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Upload your past documents: annual report, 990, last grant reports,
          logic model. These will be indexed and used to draft your compliance
          reports.
        </p>

        <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
          <p className="mb-3 text-sm font-medium">
            Drop files here or manage in Documents
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/documents">Open Documents page</Link>
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Checking documents...</p>
        ) : hasDocs ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-green-700">
              {docs.length} document{docs.length !== 1 ? "s" : ""} uploaded.
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {docs.slice(0, 5).map((d) => (
                <li key={d.id} className="truncate">
                  {d.filename}
                </li>
              ))}
              {docs.length > 5 && (
                <li>...and {docs.length - 5} more.</li>
              )}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No documents uploaded yet. You can skip and add them later.
          </p>
        )}
      </div>
    </WizardShell>
  );
}
