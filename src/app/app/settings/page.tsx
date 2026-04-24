import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const panels = [
  { href: "/app/settings/org", title: "Organization", desc: "Name, EIN, primary contact, address, org type." },
  { href: "/app/settings/users", title: "Users", desc: "Invite team members and manage roles." },
  { href: "/app/settings/sovereignty", title: "Data sovereignty", desc: "LLM provider, ZDR, data residency, TDUA." },
  { href: "/app/settings/audit-log", title: "Audit log", desc: "Security-relevant actions, filterable and exportable." },
  { href: "/app/settings/export", title: "Export and delete", desc: "Download all data or request a 30-day deletion." },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Organization configuration and sovereignty controls.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {panels.map((p) => (
          <Link key={p.href} href={p.href}>
            <Card className="transition hover:shadow-md">
              <CardHeader>
                <CardTitle>{p.title}</CardTitle>
                <CardDescription>{p.desc}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
