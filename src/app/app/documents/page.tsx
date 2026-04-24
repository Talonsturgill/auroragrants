"use client";

import { useCallback, useState } from "react";

import { DocumentList } from "@/components/app/documents/document-list";
import { UploadZone } from "@/components/app/documents/upload-zone";

export default function DocumentsPage() {
  const [refreshTick, setRefreshTick] = useState(0);
  const [toast, setToast] = useState<{ message: string; kind: "error" | "info" } | null>(
    null,
  );

  const showError = useCallback((message: string) => {
    setToast({ message, kind: "error" });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  const onUploaded = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Past proposals, prior reports, NOFOs, 990s, budgets, logic models.
          Drop a NOFO here and we will parse it, chunk it, and index it into
          your tenant workspace.
        </p>
      </div>

      <UploadZone onUploaded={onUploaded} onError={showError} />

      <DocumentList refreshTick={refreshTick} onError={showError} />

      <EmptyHint />

      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 max-w-sm rounded-md border bg-destructive px-4 py-3 text-sm text-destructive-foreground shadow-lg"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <aside
      aria-label="Getting started"
      className="rounded-md border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
    >
      New here? Drop your first NOFO above.{" "}
      <a
        href="https://rasmuson.org/wp-content/uploads/2023/Rasmuson-Tier-1-Guidelines.pdf"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline underline-offset-2"
      >
        Download a sample Alaska NOFO
      </a>{" "}
      to try it end-to-end.
    </aside>
  );
}
