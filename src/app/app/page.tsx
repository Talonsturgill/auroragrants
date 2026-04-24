import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const cards = [
  {
    title: "Reports due in 14 days",
    value: "0",
    desc: "No upcoming reports yet.",
  },
  {
    title: "Draft completion",
    value: "0 / 0",
    desc: "Fields approved across upcoming reports.",
  },
  {
    title: "Token budget this month",
    value: "$0 / $100",
    desc: "Monthly budget used.",
  },
  {
    title: "New opportunities this week",
    value: "0",
    desc: "Curated Alaska funders.",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome to AuroraGrants. Upload your first award or invite your team
          from Settings to get started.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="pb-2">
              <CardDescription>{c.title}</CardDescription>
              <CardTitle className="text-3xl">{c.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{c.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Drafts generated, fields approved, and reports submitted will
            appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
