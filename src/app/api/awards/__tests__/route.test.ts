import { beforeEach, describe, expect, it, vi } from "vitest";

// Worker env needs to be set before importing modules that transitively load
// `@/lib/workers` (via the orchestrator).
process.env.WORKER_URL = "http://worker.test";
process.env.WORKER_JWT_SECRET = "test-worker-jwt-secret-at-least-32-bytes";

// Mock supabaseForTenant so the route doesn't try to touch real Clerk/Supabase.
// Tests only care about zod validation here — the supabase path is exercised
// in the orchestrator test.
vi.mock("@/lib/supabase/server", () => ({
  supabaseForTenant: vi.fn(async () => ({
    supabase: {
      // These shouldn't be called when validation fails, but if they are, the
      // test will throw because `from` is not implemented.
    },
    tenantId: "11111111-2222-3333-4444-555555555555",
  })),
}));

// Make the orchestrator a noop so accidental happy-path paths don't actually
// try to call the worker.
vi.mock("@/lib/extract/orchestrator", () => ({
  runExtractionForAward: vi.fn(async () => ({ status: "ok" })),
}));

import { POST } from "@/app/api/awards/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/awards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  funder_id: "11111111-2222-3333-4444-555555555555",
  source_document_id: "22222222-3333-4444-5555-666666666666",
  amount_usd: 25000,
  awarded_at: "2026-01-15",
  period_start: "2026-01-01",
  period_end: "2026-12-31",
  program_name: "Tier 1 Grant",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/awards validation", () => {
  it("rejects invalid funder_id uuid with 400", async () => {
    const res = await POST(req({ ...VALID_BODY, funder_id: "not-a-uuid" }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("rejects missing program_name with 400", async () => {
    const { program_name: _omit, ...rest } = VALID_BODY;
    void _omit;
    const res = await POST(req(rest) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("rejects extra fields with 400 (strict schema)", async () => {
    const res = await POST(
      req({ ...VALID_BODY, rogue_field: "should_not_pass" }) as never,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("rejects negative amount_usd with 400", async () => {
    const res = await POST(req({ ...VALID_BODY, amount_usd: -1 }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects malformed awarded_at with 400", async () => {
    const res = await POST(req({ ...VALID_BODY, awarded_at: "2026/01/15" }) as never);
    expect(res.status).toBe(400);
  });
});
