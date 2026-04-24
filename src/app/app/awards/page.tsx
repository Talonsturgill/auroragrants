import { EmptyState } from "@/components/app/empty-state";

export default function AwardsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Awards</h1>
        <p className="text-sm text-muted-foreground">
          Grants your organization has received.
        </p>
      </div>
      <EmptyState
        title="No awards registered"
        description="Upload an award letter to extract reporting requirements."
      />
    </div>
  );
}
