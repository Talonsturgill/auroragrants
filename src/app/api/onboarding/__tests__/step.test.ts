import { describe, expect, it, vi, beforeEach } from "vitest";

// ---- Mock supabaseForTenant so we control tenant resolution -----------------

let mockSupabase: unknown = null;
let mockTenantId: string | null = "tenant-default";

vi.mock("@/lib/supabase/server", () => ({
  supabaseForTenant: vi.fn(async () => ({
    supabase: mockSupabase,
    tenantId: mockTenantId,
  })),
}));

// ---- Import route after mocks -----------------------------------------------

import { PATCH } from "../step/route";

// ---- Helpers ----------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/onboarding/step", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildUpdateChain(step: number) {
  const single = vi.fn().mockResolvedValue({
    data: { id: mockTenantId, onboarding_step: step },
    error: null,
  });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  return { update, eq, select, single };
}

// ---- Tests ------------------------------------------------------------------

beforeEach(() => {
  mockTenantId = "aaaaaaaa-1111-2222-3333-444444444444";
  mockSupabase = null;
});

describe("PATCH /api/onboarding/step", () => {
  it("saves step 1 and returns onboarding_step = 1", async () => {
    mockTenantId = "aaaaaaaa-1111-2222-3333-444444444444";
    const { update, eq, select, single } = buildUpdateChain(1);
    mockSupabase = { from: vi.fn().mockReturnValue({ update }) };

    const res = await PATCH(makeRequest({ step: 1 }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.onboarding_step).toBe(1);
    expect(update).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", mockTenantId);
    expect(select).toHaveBeenCalledWith("id, onboarding_step");
    expect(single).toHaveBeenCalled();
  });

  it("saves step 6 and returns onboarding_step = 6", async () => {
    mockTenantId = "bbbbbbbb-1111-2222-3333-444444444444";
    const { update } = buildUpdateChain(6);
    mockSupabase = { from: vi.fn().mockReturnValue({ update }) };

    const res = await PATCH(makeRequest({ step: 6 }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.onboarding_step).toBe(6);
  });

  it("returns 400 for step 0 (below minimum)", async () => {
    const res = await PATCH(makeRequest({ step: 0 }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_body");
  });

  it("returns 400 for step 7 (above maximum)", async () => {
    const res = await PATCH(makeRequest({ step: 7 }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_body");
  });

  it("returns 400 for non-integer step value", async () => {
    const res = await PATCH(makeRequest({ step: "three" }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_body");
  });

  it("returns 403 when no tenant is resolved", async () => {
    mockTenantId = null;
    const res = await PATCH(makeRequest({ step: 3 }) as never);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("no_tenant");
  });
});
