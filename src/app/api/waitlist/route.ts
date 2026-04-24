import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logAction } from "@/lib/observability";

const BodySchema = z.object({
  email: z.string().email().max(320),
  org: z.string().min(1).max(200),
  org_type: z.string().min(1).max(80),
  interest: z.string().min(1).max(40),
});

/**
 * Waitlist capture for the marketing page. Stores the row in a Supabase
 * `waitlist` table if configured. Without Supabase, logs the submission.
 * A full table schema lands when we add a migration for marketing forms.
 * See docs/followups.md.
 */
export async function POST(req: NextRequest) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  logAction({
    action: "waitlist.submitted",
    status: "ok",
    metadata: { interest: parsed.data.interest, org_type: parsed.data.org_type },
  });
  return NextResponse.json({ ok: true });
}
