import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const promises = [
  {
    title: "Apache-2.0 licensed",
    body:
      "Fork it, modify it, deploy it on your own infra. Run it inside a tribal network if that is what sovereignty requires. We ship patents-grant included.",
  },
  {
    title: "Free for every organization",
    body:
      "No paywall. No seat limits. No Institutional tier. Alaska nonprofits and tribes get the full product at no cost. Hosted or self-hosted, you choose.",
  },
  {
    title: "Community-driven roadmap",
    body:
      "Funder rubrics, prompts, and eval harness live in the repo. Issues and pull requests welcome from anyone in the Alaska grant ecosystem.",
  },
  {
    title: "Sovereignty as posture, not a tier",
    body:
      "The Sovereignty deployment mode adds dedicated infrastructure, ZDR routing, BYOK encryption, offline export, and a pre-signed Tribal Data Use Agreement. Available to any tribal organization that asks.",
  },
];

export function OpenSource() {
  return (
    <section id="open-source" className="border-t bg-secondary/40">
      <div className="container py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="accent" className="mb-3">
            Open Source
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight">
            AuroraGrants is open source.
          </h2>
          <p className="mt-4 text-muted-foreground">
            The entire product is Apache-2.0 licensed. Free to use, free to
            host, free to fork. We keep the code in the open because the
            grant-reporting burden is a public problem and the fix should be
            public too.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href="https://github.com/talonsturgill/auroragrants">
                View on GitHub
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/docs/self-hosting">Self-hosting guide</Link>
            </Button>
          </div>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {promises.map((p) => (
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
      </div>
    </section>
  );
}
