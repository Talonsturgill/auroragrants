"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  FileText,
  FolderArchive,
  LayoutDashboard,
  Radar,
  Settings,
  Target,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const items = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/deadlines", label: "Deadlines", icon: CalendarClock },
  { href: "/app/opportunities", label: "Opportunities", icon: Radar },
  { href: "/app/awards", label: "Awards", icon: Target },
  { href: "/app/reports", label: "Reports", icon: FileText },
  { href: "/app/documents", label: "Documents", icon: FolderArchive },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ sovereignty }: { sovereignty: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-secondary/40 p-4 md:flex">
      <Link href="/app" className="mb-6 flex items-center gap-2 px-2 font-semibold">
        <span aria-hidden className="inline-block h-4 w-4 rounded-full bg-primary" />
        AuroraGrants
      </Link>
      <nav className="flex-1 space-y-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                active
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      {sovereignty ? (
        <div className="mt-4 flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Badge variant="accent">Sovereignty deployment</Badge>
        </div>
      ) : null}
    </aside>
  );
}
