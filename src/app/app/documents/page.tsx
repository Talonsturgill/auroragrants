import { EmptyState } from "@/components/app/empty-state";

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Past proposals, prior reports, NOFOs, 990s, budgets, logic models.
        </p>
      </div>
      <EmptyState
        title="No documents uploaded"
        description="Upload documents to ground your drafts in your own prior work."
      />
    </div>
  );
}
