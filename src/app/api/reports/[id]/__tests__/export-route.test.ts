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

// Mock the worker call so no actual HTTP happens. The mock fn is
// declared inside the factory to avoid the vi.mock hoisting trap, and
// the test exposes a setter below for per-test control.
vi.mock("@/lib/workers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workers")>(
    "@/lib/workers",
  );
  return {
    ...actual,
    exportReport: vi.fn(),
  };
});

// Grab the mocked function for per-test control.
const { exportReport: exportReportMock } = await import("@/lib/workers");

import { POST } from "@/app/api/reports/[id]/export/route";

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

/**
 * Minimal fake Supabase. `reportRow` lets tests pick the status +
 * tenant id returned from the initial lookup. `auditFailure` lets tests
 * simulate an audit-insert error.
 */
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
                data: reportRow
                  ? { id: REPORT_ID, ...reportRow }
                  : null,
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
              maybeSingle: async () => ({
                data: { id: "u-1" },
                error: null,
              }),
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

const mockedExport = vi.mocked(exportReportMock);

beforeEach(() => {
  vi.clearAllMocks();
  mockedExport.mockReset();
});

describe("POST /api/reports/[id]/export", () => {
  it("rejects non-uuid id with 400", async () => {
    setSupabase({});
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise("not-a-uuid"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_id");
  });

  it("rejects unknown format with 400", async () => {
    setSupabase({});
    const res = await POST(req({ format: "csv" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("returns 404 when the report does not exist", async () => {
    setSupabase(makeSupabase(null));
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the report belongs to another tenant", async () => {
    setSupabase(
      makeSupabase({
        tenant_id: "99999999-9999-9999-9999-999999999999",
        status: "ready_for_export",
      }),
    );
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the report is not ready for export", async () => {
    setSupabase(
      makeSupabase({ tenant_id: TENANT, status: "drafting" }),
    );
    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string };
    expect(body.error).toBe("not_ready");
    expect(body.status).toBe("drafting");
  });

  it("streams the worker blob back with correct Content-Disposition on happy path", async () => {
    setSupabase(
      makeSupabase({ tenant_id: TENANT, status: "ready_for_export" }),
    );
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], {
      type: "application/pdf",
    });
    mockedExport.mockResolvedValue({
      blob: bytes,
      filename: "rasmuson-report-2026-04-24.pdf",
    });

    const res = await POST(req({ format: "pdf" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const disp = res.headers.get("content-disposition");
    expect(disp).toMatch(/attachment/);
    expect(disp).toMatch(/rasmuson-report-2026-04-24\.pdf/);

    // Body is preserved as streamed bytes.
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x25); // '%'
    expect(buf[1]).toBe(0x50); // 'P'
  });

  it("returns 200 and still audits when audit insert fails", async () => {
    setSupabase(
      makeSupabase(
        { tenant_id: TENANT, status: "ready_for_export" },
        { auditFailure: true },
      ),
    );
    mockedExport.mockResolvedValue({
      blob: new Blob(["x"], { type: "text/plain" }),
      filename: "x.txt",
    });
    const res = await POST(req({ format: "text" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    // Audit failure must not break the user's download.
    expect(res.status).toBe(200);
  });

  it("surfaces worker errors as 502", async () => {
    setSupabase(
      makeSupabase({ tenant_id: TENANT, status: "ready_for_export" }),
    );
    const { WorkerError } = await import("@/lib/workers");
    mockedExport.mockRejectedValue(
      new WorkerError("worker exploded", 500),
    );
    const res = await POST(req({ format: "docx" }) as never, {
      params: paramsPromise(REPORT_ID),
    });
    expect(res.status).toBe(502);
  });
});
