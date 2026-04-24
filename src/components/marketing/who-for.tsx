import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const cards = [
  {
    title: "Anchorage 501(c)(3)",
    body:
      "Managing Rasmuson, Mat-Su Health Foundation, Alaska Community Foundation, Denali Commission, HUD, and HHS awards. You need fewer late nights on interim reports and a defensible audit trail.",
  },
  {
    title: "ANCSA regional nonprofit",
    body:
      "CITC, Tanana Chiefs Conference, Bristol Bay Native Association, Kawerak, and the other eight. You run federal compacts and foundation grants across multiple programs and need reporting that scales without hiring.",
  },
  {
    title: "Tribal government or consortium",
    body:
      "You need CARE-aligned data sovereignty, offline-compatible reporting, and a pre-signed Tribal Data Use Agreement before the first document leaves your network.",
  },
];

export function WhoFor() {
  return (
    <section id="who" className="container py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Built for the Alaska grant ecosystem.
        </h2>
        <p className="mt-4 text-muted-foreground">
          We serve three audiences and our product reflects each one.
        </p>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardTitle>{c.title}</CardTitle>
              <CardDescription />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{c.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
