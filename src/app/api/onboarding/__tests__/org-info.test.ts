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

import { PATCH } from "../org-info/route";

// ---- Helpers ----------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/onboarding/org-info", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildUpdateChain(returnData: unknown, returnError: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data: returnData, error: returnError });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  return { update, eq, select, single };
}

// ---- Tests ------------------------------------------------------------------

beforeEach(() => {
  mockTenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  mockSupabase = null;
});

describe("PATCH /api/onboarding/org-info", () => {
  it("returns 400 when name is missing", async () => {
    // Zod rejects before any DB call.
    // @ts-expect-error NextRequest is a superset of Request
    const res = await PATCH(makeRequest({ ein: "12-3456789" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_body");
  });

  it("returns 400 when name is empty string", async () => {
    // @ts-expect-error NextRequest is a superset
    const res = await PATCH(makeRequest({ name: "" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_body");
  });

  it("returns 403 when no tenant is resolved", async () => {
    mockTenantId = null;
    // @ts-expect-error NextRequest is a superset
    const res = await PATCH(makeRequest({ name: "My Org" }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("no_tenant");
  });

  it("returns 400 for invalid org_type enum value", async () => {
    // @ts-expect-error NextRequest is a superset
    const res = await PATCH(makeRequest({ name: "Valid Name", org_type: "invalid_type" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_body");
  });

  it("succeeds and returns the updated tenant when all fields are valid", async () => {
    const tenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    mockTenantId = tenantId;
    const { update, eq, select, single } = buildUpdateChain({ id: tenantId, name: "Updated Org" });
    mockSupabase = { from: vi.fn().mockReturnValue({ update }) };

    // @ts-expect-error NextRequest is a superset
    const res = await PATCH(
      makeRequest({ name: "Updated Org", ein: "12-3456789", org_type: "501c3" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Updated Org");
    expect(update).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", tenantId);
    expect(select).toHaveBeenCalledWith("*");
    expect(single).toHaveBeenCalled();
  });

  it("returns 500 when the DB update errors", async () => {
    const tenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    mockTenantId = tenantId;
    const { update } = buildUpdateChain(null, { message: "connection error" });
    mockSupabase = { from: vi.fn().mockReturnValue({ update }) };

    // @ts-expect-error NextRequest is a superset
    const res = await PATCH(makeRequest({ name: "My Org" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("update_failed");
  });
});
