import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.WORKER_URL = "http://worker.test";
process.env.WORKER_JWT_SECRET = "test-worker-jwt-secret-at-least-32-bytes";

const TENANT = "11111111-2222-3333-4444-555555555555";
const REPORT_ID = "22222222-3333-4444-5555-666666666666";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test_abc" })),
}));

let supabaseMock: unknown = null;
vi.mock("@/lib/supabase/server", () => ({
  supabaseForTenant: vi.fn(async () => ({
    supabase: supabaseMock,
    tenantId: TENANT,
  })),
}));

import { POST } from "@/app/api/reports/[id]/approve/route";

function setSupabase(mock: unknown) {
  supabaseMock = mock;
}

function paramsPromise(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

function req(): Request {
  return new Request("http://localhost/api/reports/x/approve", {
    method: "POST",
  });
}

/**
 * Compact fake factory: fields is the list returned by
 * SELECT id, required, human_approved FROM report_fields.
 */
function makeSupaWithFields(
  fields: Array<{ id: string; required: boolean; human_approved: boolean }>,
  opts: {
    updateError?: unknown;
  } = {},
) {
  return {
    from(table: string) {
      if (table === "reports") {
        const api = {
          select: () => api,
          update: () => api,
          eq: () => api,
          maybeSingle: async () => ({
            data: { id: REPORT_ID, tenant_id: TENANT, status: "ready_for_review" },
            error: null,
          }),
          then(
            resolve: (v: { data: unknown; error: unknown }) => void,
          ) {
            resolve({ data: null, error: opts.updateError ?? null });
          },
        };
        return api;
      }
      if (table === "report_fields") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: fields, error: null }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: async () => ({ error: null }),
        };
      }
      return {};
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/reports/[id]/approve", () => {
  it("rejects non-uuid id with 400", async () => {
    setSupabase({});
    const res = await POST(req() as never, {
      params: paramsPromise("not-a-uuid"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_id");
  });

  it("blocks approval with 400 when a required field is not approved", async () => {
    setSupabase(
      makeSupaWithFields([
        { id: "f1", required: true, human_approved: true },
        { id: "f2", required: true, human_approved: false },
        { id: "f3", required: false, human_approved: false },
      ]),
    );
    const res = await POST(req() as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      unapproved_field_ids: string[];
    };
    expect(body.error).toBe("unapproved_fields");
    expect(body.unapproved_field_ids).toEqual(["f2"]);
  });

  it("succeeds when all required fields are approved", async () => {
    setSupabase(
      makeSupaWithFields([
        { id: "f1", required: true, human_approved: true },
        { id: "f2", required: true, human_approved: true },
        { id: "f3", required: false, human_approved: false },
      ]),
    );
    const res = await POST(req() as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      report_id: string;
      status: string;
      approved_at: string;
    };
    expect(body.status).toBe("ready_for_export");
    expect(body.report_id).toBe(REPORT_ID);
  });

  it("succeeds when there are zero required fields (all optional)", async () => {
    setSupabase(
      makeSupaWithFields([
        { id: "f1", required: false, human_approved: false },
      ]),
    );
    const res = await POST(req() as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(200);
  });
});
