import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { supabaseForTenant } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, orgId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  let sovereignty = false;
  if (orgId) {
    try {
      const { supabase, tenantId } = await supabaseForTenant();
      if (tenantId) {
        const { data } = await supabase
          .from("tenants")
          .select("tier")
          .eq("id", tenantId)
          .maybeSingle();
        sovereignty = data?.tier === "sovereignty";
      }
    } catch {
      // DB not provisioned in this environment. Fall back to default posture.
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar sovereignty={sovereignty} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
