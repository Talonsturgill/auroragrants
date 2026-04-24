export function Problem() {
  return (
    <section id="problem" className="border-t bg-secondary/40">
      <div className="container grid gap-8 py-20 md:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            The reporting burden is structural.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Treasury&apos;s July 2024 CX Pilot found federal tribal grant
            reporting cost Alaska tribes roughly 8.9 hours per IHS report
            before redesign. GAO-25-107674 documents that administrative
            burdens such as application and reporting requirements strain
            Tribes&apos; staffing capacity and identifies reporting as a
            structural barrier to federal assistance.
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">
            Alaska has 229 federally recognized tribes, 12 ANCSA regional
            nonprofits, and more than 200 nonprofits in the Foraker Group
            ecosystem. Congress approved 32.6 billion dollars in FY 2024 for
            tribal benefit programs. Existing tools are discovery-first or
            drafting-first, US-wide, cloud only, and have no tribal data
            sovereignty posture. None has Alaska funder rubric depth. None
            has offline-compatible reporting. That is a structural gap.
          </p>
        </div>
      </div>
    </section>
  );
}
