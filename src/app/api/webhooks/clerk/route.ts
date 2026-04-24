import { Webhook } from "svix";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { logAction } from "@/lib/observability";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Clerk webhook. Handles organization and user lifecycle events.
 *
 * Events handled:
 *  - organization.created  → insert row into `tenants`
 *  - organization.updated  → update `tenants.name` and `slug`
 *  - organization.deleted  → soft-delete (status = 'churned')
 *  - user.created          → insert row into `users`
 *  - organizationMembership.created → upsert `tenant_users`
 */

export const dynamic = "force-dynamic";

type ClerkEventType =
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "user.created"
  | "user.updated"
  | "organizationMembership.created"
  | "organizationMembership.deleted";

interface ClerkEvent {
  type: ClerkEventType;
  data: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  if (!env.CLERK_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "CLERK_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing svix headers" }, { status: 400 });
  }

  const payload = await req.text();
  let evt: ClerkEvent;
  try {
    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
    evt = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const data = evt.data as Record<string, unknown>;

  switch (evt.type) {
    case "organization.created": {
      const clerkOrgId = String(data.id);
      const name = String(data.name ?? "Unnamed Organization");
      const slug = String(data.slug ?? clerkOrgId);
      const { error } = await supabase.from("tenants").upsert(
        { clerk_org_id: clerkOrgId, name, slug },
        { onConflict: "clerk_org_id" },
      );
      if (error) {
        logAction({ action: "clerk.organization.created", status: "error", metadata: { code: error.code } });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      logAction({ action: "clerk.organization.created", status: "ok" });
      break;
    }
    case "organization.updated": {
      const clerkOrgId = String(data.id);
      const { error } = await supabase
        .from("tenants")
        .update({
          name: String(data.name ?? ""),
          slug: String(data.slug ?? clerkOrgId),
        })
        .eq("clerk_org_id", clerkOrgId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      break;
    }
    case "organization.deleted": {
      const clerkOrgId = String(data.id);
      await supabase
        .from("tenants")
        .update({ status: "churned" })
        .eq("clerk_org_id", clerkOrgId);
      break;
    }
    case "user.created":
    case "user.updated": {
      const clerkUserId = String(data.id);
      const emails = (data.email_addresses as Array<{ email_address: string }> | undefined) ?? [];
      const email = emails[0]?.email_address ?? "";
      const name =
        [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;
      await supabase
        .from("users")
        .upsert(
          { clerk_user_id: clerkUserId, email, name },
          { onConflict: "clerk_user_id" },
        );
      break;
    }
    case "organizationMembership.created": {
      const org = data.organization as { id?: string } | undefined;
      const user = data.public_user_data as { user_id?: string } | undefined;
      const role = (data.role as string | undefined) ?? "editor";
      if (!org?.id || !user?.user_id) break;

      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id")
        .eq("clerk_org_id", org.id)
        .maybeSingle();
      const { data: userRow } = await supabase
        .from("users")
        .select("id")
        .eq("clerk_user_id", user.user_id)
        .maybeSingle();
      if (!tenantRow || !userRow) break;

      const normalizedRole = role.replace("org:", "").replace("admin", "admin");
      await supabase.from("tenant_users").upsert(
        { tenant_id: tenantRow.id, user_id: userRow.id, role: normalizedRole },
        { onConflict: "tenant_id,user_id" },
      );
      break;
    }
    case "organizationMembership.deleted": {
      const org = data.organization as { id?: string } | undefined;
      const user = data.public_user_data as { user_id?: string } | undefined;
      if (!org?.id || !user?.user_id) break;
      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id")
        .eq("clerk_org_id", org.id)
        .maybeSingle();
      const { data: userRow } = await supabase
        .from("users")
        .select("id")
        .eq("clerk_user_id", user.user_id)
        .maybeSingle();
      if (!tenantRow || !userRow) break;
      await supabase
        .from("tenant_users")
        .delete()
        .eq("tenant_id", tenantRow.id)
        .eq("user_id", userRow.id);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
