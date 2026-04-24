import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <OrganizationSwitcher
        hidePersonal
        afterCreateOrganizationUrl="/app"
        afterSelectOrganizationUrl="/app"
        appearance={{ elements: { rootBox: "flex items-center" } }}
      />
      <div className="flex items-center gap-3">
        <a
          href="mailto:help@arcticintelligence.ai"
          className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
        >
          Help
        </a>
        <UserButton afterSignOutUrl="/" />
      </div>
    </header>
  );
}
