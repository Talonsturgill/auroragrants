/**
 * Red-team stress tests for POST /api/reports/[id]/export.
 *
 * Covers:
 *  - Tenant A cannot export a report belonging to Tenant B (returns 403 or 404).
 *  - Report in "drafting" status (not "ready_for_export") returns 409.
 *  - Missing `format` field in body returns 400.
 *  - Unauthenticated request (no Clerk session) returns 401.
 *  - Worker returning 503 surfaces as 502 to client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.WORKER_URL = "http://worker.test";
process.env.WORKER_JWT_SECRET = "test-worker-jwt-secret-at-least-32-bytes";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REPORT_ID = "22222222-3333-4444-5555-666666666666";

// Default: authenticated as Tenant A.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test_abc" })),
}));

let supabaseMock: unknown = null;
vi.mock("@/lib/supabase/server", () => ({
  supabaseForTenant: vi.fn(async () => ({
    supabase: supabaseMock,
    tenantId: TENANT_A,
  })),
}));

vi.mock("@/lib/workers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workers")>(
    "@/lib/workers",
  );
  return {
    ...actual,
    exportReport: vi.fn(),
  };
});

const { exportReport: exportReportMock } = await import("@/lib/workers");
import { POST } from "@/app/api/reports/[id]/export/route";

const mockedExport = vi.mocked(exportReportMock);

function setSupabase(mock: unknown) {
  supabaseMock = mock;
}

function paramsPromise(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/reports/x/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSupabase(
  reportRow: { tenant_id: string; status: string } | null,
  opts: { auditFailure?: boolean } = {},
) {
  return {
    from(table: string) {
      if (table === "reports") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: reportRow ? { id: REPORT_ID, ...reportRow } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "u-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: async () => ({
            error: opts.auditFailure ? { message: "audit_fail" } : null,
          }),
        };
      }
      return {};
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedExport.mockReset();
});

describe("POST /api/reports/[id]/export — stress tests", () => {
  // ---------------------------------------------------------------
  // 1. Cross-tenant isolation: Tenant A cannot access Tenant B's report.
  // ---------------------------------------------------------------
  it("returns 404 when the report belongs to Tenant B but caller is Tenant A", async () => {
    // The RLS query returns a row, but the tenant_id doesn't match TENANT_A.
    setSupabase(
      makeSupabase({
        tenant_id: TENANT_B,
        status: "ready_for_export",
      }),
    );
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    // The route compares reportRow.tenant_id !== tenantId and returns 404.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ---------------------------------------------------------------
  // 2. Wrong status: "drafting" (not ready_for_export) → 409
  // ---------------------------------------------------------------
  it("returns 409 when report status is 'drafting'", async () => {
    setSupabase(makeSupabase({ tenant_id: TENANT_A, status: "drafting" }));
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string };
    expect(body.error).toBe("not_ready");
    expect(body.status).toBe("drafting");
  });

  // ---------------------------------------------------------------
  // 3. Missing format field → 400
  // ---------------------------------------------------------------
  it("returns 400 when format field is missing from the request body", async () => {
    setSupabase(makeSupabase({ tenant_id: TENANT_A, status: "ready_for_export" }));
    // Body intentionally missing `format`.
    const res = await POST(req({ notes: "oops" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  // ---------------------------------------------------------------
  // 4. Unauthenticated request → 401
  // ---------------------------------------------------------------
  it("returns 401 when no Clerk session exists", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);

    setSupabase(makeSupabase({ tenant_id: TENANT_A, status: "ready_for_export" }));
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthenticated");
  });

  // ---------------------------------------------------------------
  // 5. Worker returning 503 → 502 to client
  // ---------------------------------------------------------------
  it("returns 502 when the worker responds with 503", async () => {
    setSupabase(makeSupabase({ tenant_id: TENANT_A, status: "ready_for_export" }));
    const { WorkerError } = await import("@/lib/workers");
    mockedExport.mockRejectedValue(new WorkerError("upstream unavailable", 503));

    const res = await POST(req({ format: "docx" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; status: number };
    expect(body.error).toBe("worker_error");
    // The worker's status code is surfaced in the body.
    expect(body.status).toBe(503);
  });

  // ---------------------------------------------------------------
  // 6. Worker returning 409 → 409 to client (pass-through)
  // ---------------------------------------------------------------
  it("returns 409 when the worker responds with 409", async () => {
    setSupabase(makeSupabase({ tenant_id: TENANT_A, status: "ready_for_export" }));
    const { WorkerError } = await import("@/lib/workers");
    mockedExport.mockRejectedValue(new WorkerError("conflict in worker", 409));

    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(409);
  });

  // ---------------------------------------------------------------
  // 7. Report not found (does not exist) → 404
  // ---------------------------------------------------------------
  it("returns 404 when the report does not exist in the DB", async () => {
    setSupabase(makeSupabase(null));
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------
  // 8. Invalid report id format → 400
  // ---------------------------------------------------------------
  it("returns 400 for a non-UUID report id", async () => {
    setSupabase({});
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise("not-a-uuid"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_id");
  });
});
