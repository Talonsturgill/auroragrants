import Link from "next/link";

import { Button } from "@/components/ui/button";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-primary"
          />
          AuroraGrants
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="#problem" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Problem
          </Link>
          <Link href="#open-source" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Open source
          </Link>
          <Link href="#sovereignty" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Sovereignty
          </Link>
          <Link
            href="https://github.com/talonsturgill/auroragrants"
            className="hidden text-muted-foreground hover:text-foreground sm:inline"
          >
            GitHub
          </Link>
          <Button asChild size="sm" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="#waitlist">Get notified</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
