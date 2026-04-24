import { beforeEach, describe, expect, it, vi } from "vitest";

// Worker env needs to be set before importing modules that transitively load
// `@/lib/workers` (via the orchestrator).
process.env.WORKER_URL = "http://worker.test";
process.env.WORKER_JWT_SECRET = "test-worker-jwt-secret-at-least-32-bytes";

const TENANT = "11111111-2222-3333-4444-555555555555";
const FIELD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DRAFT_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

// Mock Clerk auth for the approve route.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test_abc" })),
}));

// We swap the supabase client per test via setSupabaseMock.
let supabaseMock: unknown = null;
vi.mock("@/lib/supabase/server", () => ({
  supabaseForTenant: vi.fn(async () => ({
    supabase: supabaseMock,
    tenantId: TENANT,
  })),
}));

// Drafter orchestrator is a noop so draft POST doesn't try to run the worker.
vi.mock("@/lib/drafts/orchestrator", () => ({
  runDrafterForField: vi.fn(async () => ({ status: "ok" })),
}));

import { POST as approvePOST } from "@/app/api/report-fields/[id]/approve/route";
import { POST as draftPOST } from "@/app/api/report-fields/[id]/draft/route";

function setSupabase(mock: unknown) {
  supabaseMock = mock;
}

function paramsPromise(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

function req(body?: unknown, url = "http://localhost/api/report-fields/x"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/report-fields/[id]/draft", () => {
  it("rejects non-uuid id with 400", async () => {
    setSupabase({});
    const res = await draftPOST(req() as never, {
      params: paramsPromise("not-a-uuid"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_id");
  });

  it("returns 202 when field exists", async () => {
    // Minimal supabase fake for the draft route: it does a field lookup and
    // an audit insert.
    const auditRows: Array<Record<string, unknown>> = [];
    setSupabase({
      from(table: string) {
        if (table === "report_fields") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: FIELD_ID },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "audit_log") {
          return {
            insert: async (row: Record<string, unknown>) => {
              auditRows.push(row);
              return { error: null };
            },
          };
        }
        return {};
      },
    });
    const res = await draftPOST(req() as never, {
      params: paramsPromise(FIELD_ID),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      field_id: string;
      draft_triggered: boolean;
    };
    expect(body.draft_triggered).toBe(true);
    expect(body.field_id).toBe(FIELD_ID);
  });

  it("returns 404 when field does not exist", async () => {
    setSupabase({
      from(table: string) {
        if (table === "report_fields") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    });
    const res = await draftPOST(req() as never, {
      params: paramsPromise(FIELD_ID),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/report-fields/[id]/approve", () => {
  const VALID_BODY = {
    draft_id: DRAFT_ID,
    signer_attestation: true as const,
  };

  it("rejects body missing signer_attestation with 400", async () => {
    setSupabase({});
    const res = await approvePOST(req({ draft_id: DRAFT_ID }) as never, {
      params: paramsPromise(FIELD_ID),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("rejects body with signer_attestation=false", async () => {
    setSupabase({});
    const res = await approvePOST(
      req({ draft_id: DRAFT_ID, signer_attestation: false }) as never,
      { params: paramsPromise(FIELD_ID) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-uuid id", async () => {
    setSupabase({});
    const res = await approvePOST(req(VALID_BODY) as never, {
      params: paramsPromise("not-a-uuid"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_id");
  });

  it("rejects non-uuid draft_id", async () => {
    setSupabase({});
    const res = await approvePOST(
      req({ draft_id: "not-a-uuid", signer_attestation: true }) as never,
      { params: paramsPromise(FIELD_ID) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects when draft is not surfaced", async () => {
    setSupabase({
      from(table: string) {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        if (table === "drafts") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: DRAFT_ID,
                      report_field_id: FIELD_ID,
                      content: "x",
                      surfaced_to_user: false,
                      version: 1,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    });
    const res = await approvePOST(req(VALID_BODY) as never, {
      params: paramsPromise(FIELD_ID),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("draft_not_surfaced");
  });

  it("rejects when draft belongs to a different field", async () => {
    setSupabase({
      from(table: string) {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        if (table === "drafts") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: DRAFT_ID,
                      report_field_id: "99999999-9999-9999-9999-999999999999",
                      content: "x",
                      surfaced_to_user: true,
                      version: 1,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    });
    const res = await approvePOST(req(VALID_BODY) as never, {
      params: paramsPromise(FIELD_ID),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("draft_not_for_field");
  });
});
