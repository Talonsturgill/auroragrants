import { NextResponse } from "next/server";

import { supabaseForTenant } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/funders — returns all funders (public reference data). */
export async function GET() {
  try {
    const { supabase } = await supabaseForTenant();

    const { data, error } = await supabase
      .from("funders")
      .select("id, name, type, scope, website, reporting_cadence")
      .order("name");

    if (error) {
      return NextResponse.json({ error: "list_failed" }, { status: 500 });
    }

    return NextResponse.json({ funders: data ?? [] });
  } catch {
    return NextResponse.json({ funders: [] });
  }
}
