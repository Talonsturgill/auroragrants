import Link from "next/link";

import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="container py-20 sm:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">
          Alaska-specific, open-source AI for grant compliance
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Grant compliance built for Alaska.
        </h1>
        <p className="mt-6 text-pretty text-lg text-muted-foreground">
          AuroraGrants helps Alaska nonprofits and tribal organizations draft,
          review, and submit grant reports in a fraction of the time, with
          human review and tribal data sovereignty built in. Free and open
          source under Apache-2.0.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="#waitlist">Get notified when we launch</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="https://github.com/talonsturgill/auroragrants">
              View on GitHub
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
