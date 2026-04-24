import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed bg-muted/30 p-10">
          {cta ?? (
            <p className="text-sm text-muted-foreground">Get started in Settings.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
