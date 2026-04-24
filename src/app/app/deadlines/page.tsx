import { EmptyState } from "@/components/app/empty-state";

export default function DeadlinesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deadlines</h1>
        <p className="text-sm text-muted-foreground">
          Every tracked opportunity and report, sorted by due date.
        </p>
      </div>
      <EmptyState
        title="No deadlines yet"
        description="Add an opportunity or register an award to start tracking deadlines."
      />
    </div>
  );
}
