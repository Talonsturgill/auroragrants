import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t">
      <div className="container flex flex-col items-start justify-between gap-6 py-10 text-sm md:flex-row md:items-center">
        <div>
          <p className="font-semibold">AuroraGrants</p>
          <p className="mt-1 text-muted-foreground">
            Part of Arctic Intelligence. Anchorage, Alaska.
          </p>
        </div>
        <nav className="flex flex-wrap gap-4 text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="#mission" className="hover:text-foreground">
            Mission
          </Link>
          <a
            href="mailto:hello@arcticintelligence.ai"
            className="hover:text-foreground"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
