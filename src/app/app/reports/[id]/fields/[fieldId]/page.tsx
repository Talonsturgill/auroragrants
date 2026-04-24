import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

interface FieldStubProps {
  params: Promise<{ id: string; fieldId: string }>;
}

export default async function FieldDrafterStubPage({ params }: FieldStubProps) {
  const { id } = await params;
  return (
    <div className="space-y-4">
      <Link
        href={`/app/reports/${id}`}
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        Back to report
      </Link>
      <EmptyState
        title="Field drafter coming soon"
        description="Field drafting UI lands in Phase 4."
        cta={
          <Button asChild variant="outline">
            <Link href={`/app/reports/${id}`}>Return to report</Link>
          </Button>
        }
      />
    </div>
  );
}
