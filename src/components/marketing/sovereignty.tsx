import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const pillars = [
  {
    title: "CARE Principles",
    body:
      "Collective Benefit, Authority to Control, Responsibility, Ethics. Our architecture and contracts are aligned with the Global Indigenous Data Alliance framework.",
  },
  {
    title: "Anthropic ZDR",
    body:
      "Sovereignty tenants route every model call through a Zero Data Retention organization. We verify ZDR scope on every model version we use.",
  },
  {
    title: "Indigenous Data Advisory Council",
    body:
      "Five seats, paid stipends, quarterly meetings. The council reviews material product changes to sovereignty posture before release.",
  },
  {
    title: "Offline mode",
    body:
      "Full CSV export and import that round-trips without loss, matching the Treasury SLFRF offline Excel template for rural Alaska connectivity.",
  },
];

export function Sovereignty() {
  return (
    <section id="sovereignty" className="container py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="accent" className="mb-3">
          Tribal Data Sovereignty
        </Badge>
        <h2 className="text-3xl font-semibold tracking-tight">
          Sovereignty is the posture, not a paywall.
        </h2>
        <p className="mt-4 text-muted-foreground">
          Any tribal organization can request a Sovereignty deployment. It
          includes dedicated infrastructure, ZDR routing, BYOK encryption,
          offline export and import, and a pre-signed Tribal Data Use
          Agreement. Open source, free, and self-hostable by design.
        </p>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {pillars.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <CardTitle>{p.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
