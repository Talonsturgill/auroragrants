import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_URL = "https://app.test";

// The ack route uses supabaseAdmin (service role), not supabaseForTenant.
let adminMock: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(() => adminMock),
}));

import { GET } from "@/app/api/deadlines/ack/[token]/route";

const VALID_TOKEN = "dddddddd-0000-0000-0000-000000000001";
const DEADLINE_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REPORT_ID = "cccccccc-0000-0000-0000-000000000001";

function paramsPromise(token: string): Promise<{ token: string }> {
  return Promise.resolve({ token });
}

function makeRequest(token: string): Request {
  return new Request(`https://app.test/api/deadlines/ack/${token}`, {
    method: "GET",
  });
}

function setAdmin(mock: unknown) {
  adminMock = mock;
}

/**
 * Build a minimal Supabase client mock for the ack route.
 * The route does:
 *   1. supabase.from("deadlines").select(...).eq("ack_token", token).maybeSingle()
 *   2. supabase.from("deadlines").update(...).eq("id", id)
 *   3. supabase.from("audit_log").insert(...)
 */
function makeAdminMock(opts: {
  deadline?: {
    id: string;
    tenant_id: string;
    source_id: string;
    source_type: string;
    acknowledged: boolean;
    acknowledged_at: string | null;
  } | null;
  updateError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      if (table === "deadlines") {
        // Chain: select -> eq -> maybeSingle  (lookup)
        //   and: update -> eq              (write)
        const chain: Record<string, unknown> = {};

        chain.select = () => chain;
        chain.update = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => ({
          data: opts.deadline ?? null,
          error: null,
        });
        // update().eq() resolves with error from opts
        // We distinguish by checking if update was called before eq.
        let _didUpdate = false;
        const realChain = {
          select: () => realChain,
          update: () => {
            _didUpdate = true;
            return realChain;
          },
          eq: () => {
            if (_didUpdate) {
              return {
                then(resolve: (v: { data: null; error: unknown }) => void) {
                  resolve({ data: null, error: opts.updateError ?? null });
                },
              };
            }
            return realChain;
          },
          maybeSingle: async () => ({
            data: opts.deadline ?? null,
            error: null,
          }),
        };
        return realChain;
      }
      if (table === "audit_log") {
        return { insert: async () => ({ error: null }) };
      }
      return {};
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/deadlines/ack/[token]", () => {
  it("returns 404 for an unknown token", async () => {
    setAdmin(
      makeAdminMock({ deadline: null }),
    );
    const res = await GET(makeRequest(VALID_TOKEN) as never, {
      params: paramsPromise(VALID_TOKEN),
    });
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("not found");
  });

  it("returns 404 for a malformed token (not uuid)", async () => {
    setAdmin(makeAdminMock({ deadline: null }));
    const res = await GET(makeRequest("not-a-uuid") as never, {
      params: paramsPromise("not-a-uuid"),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 'Already acknowledged' when already acked", async () => {
    setAdmin(
      makeAdminMock({
        deadline: {
          id: DEADLINE_ID,
          tenant_id: TENANT_ID,
          source_id: REPORT_ID,
          source_type: "report",
          acknowledged: true,
          acknowledged_at: "2026-01-01T00:00:00Z",
        },
      }),
    );
    const res = await GET(makeRequest(VALID_TOKEN) as never, {
      params: paramsPromise(VALID_TOKEN),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Already acknowledged");
  });

  it("redirects to report page on successful ack", async () => {
    setAdmin(
      makeAdminMock({
        deadline: {
          id: DEADLINE_ID,
          tenant_id: TENANT_ID,
          source_id: REPORT_ID,
          source_type: "report",
          acknowledged: false,
          acknowledged_at: null,
        },
      }),
    );
    const res = await GET(makeRequest(VALID_TOKEN) as never, {
      params: paramsPromise(VALID_TOKEN),
    });
    // NextResponse.redirect returns 302.
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain(`/app/reports/${REPORT_ID}`);
    expect(location).toContain("acknowledged=1");
  });

  it("redirects to deadlines list for non-report source types", async () => {
    setAdmin(
      makeAdminMock({
        deadline: {
          id: DEADLINE_ID,
          tenant_id: TENANT_ID,
          source_id: "opp-123",
          source_type: "opportunity",
          acknowledged: false,
          acknowledged_at: null,
        },
      }),
    );
    const res = await GET(makeRequest(VALID_TOKEN) as never, {
      params: paramsPromise(VALID_TOKEN),
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("/app/deadlines");
    expect(location).toContain("acknowledged=1");
  });

  it("does not error when called twice (idempotent second call returns 200)", async () => {
    // First call with unacknowledged -> 302
    setAdmin(
      makeAdminMock({
        deadline: {
          id: DEADLINE_ID,
          tenant_id: TENANT_ID,
          source_id: REPORT_ID,
          source_type: "report",
          acknowledged: false,
          acknowledged_at: null,
        },
      }),
    );
    const res1 = await GET(makeRequest(VALID_TOKEN) as never, {
      params: paramsPromise(VALID_TOKEN),
    });
    expect(res1.status).toBe(302);

    // Second call with already-acknowledged deadline -> 200
    setAdmin(
      makeAdminMock({
        deadline: {
          id: DEADLINE_ID,
          tenant_id: TENANT_ID,
          source_id: REPORT_ID,
          source_type: "report",
          acknowledged: true,
          acknowledged_at: new Date().toISOString(),
        },
      }),
    );
    const res2 = await GET(makeRequest(VALID_TOKEN) as never, {
      params: paramsPromise(VALID_TOKEN),
    });
    expect(res2.status).toBe(200);
    expect(await res2.text()).toContain("Already acknowledged");
  });
});
