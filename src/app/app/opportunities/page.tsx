import { EmptyState } from "@/components/app/empty-state";

export default function OpportunitiesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Opportunities</h1>
        <p className="text-sm text-muted-foreground">
          Funder opportunities your organization is tracking.
        </p>
      </div>
      <EmptyState
        title="No opportunities tracked"
        description="Add a funder opportunity to extract eligibility and requirements."
      />
    </div>
  );
}
