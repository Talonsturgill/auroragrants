import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the workers module so the orchestrator never actually tries to sign a
// JWT or hit fetch. We stub extractRequirements per test via
// `mockedExtractRequirements.mockResolvedValueOnce(...)` or
// `mockedExtractRequirements.mockRejectedValueOnce(...)`.
vi.mock("@/lib/workers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workers")>(
    "@/lib/workers",
  );
  return {
    ...actual,
    extractRequirements: vi.fn(),
  };
});

import { extractRequirements, WorkerError } from "@/lib/workers";
import { computeDueAt, runExtractionForAward } from "./orchestrator";

const mockedExtractRequirements = vi.mocked(extractRequirements);

const TENANT = "11111111-2222-3333-4444-555555555555";
const AWARD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DOC_ID = "dddddddd-cccc-bbbb-aaaa-999999999999";

/**
 * Tiny mock for the chainable supabase client used by the orchestrator.
 * It's not a generic query builder — we record what method was called and
 * which table and let the test assert on the resulting calls[] log.
 *
 * For selects we return whatever the test-configured response is. For
 * inserts/updates we return a default `{ data, error: null }` unless a
 * handler was registered.
 */
interface Call {
  table: string;
  op: "select" | "insert" | "update";
  payload?: unknown;
  filters: Array<[string, string]>;
}

function makeSupabase(opts: {
  awardRow: Record<string, unknown> | null;
  awardUpdateError?: unknown;
  reportsInsertResult?: { data: unknown; error: unknown };
  fieldsInsertError?: unknown;
}): {
  client: ReturnType<typeof buildClient>;
  calls: Call[];
} {
  const calls: Call[] = [];

  function buildClient() {
    return {
      from(table: string) {
        return buildTable(table);
      },
    };
  }

  function buildTable(table: string) {
    let currentOp: "select" | "insert" | "update" | null = null;
    let payload: unknown = undefined;
    const filters: Array<[string, string]> = [];

    const queryApi = {
      select() {
        if (currentOp === null) currentOp = "select";
        return queryApi;
      },
      insert(row: unknown) {
        currentOp = "insert";
        payload = row;
        return queryApi;
      },
      update(row: unknown) {
        currentOp = "update";
        payload = row;
        return queryApi;
      },
      eq(col: string, val: string) {
        filters.push([col, val]);
        return queryApi;
      },
      async maybeSingle() {
        const op = currentOp;
        recordCall();
        if (table === "awards" && op === "select") {
          return { data: opts.awardRow, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        const op = currentOp;
        recordCall();
        if (table === "reports" && op === "insert") {
          if (opts.reportsInsertResult) return opts.reportsInsertResult;
          return { data: { id: `report-${calls.length}` }, error: null };
        }
        return { data: null, error: null };
      },
      // Terminal `await` path for inserts/updates without select.
      then(
        resolve: (value: { data: unknown; error: unknown }) => void,
        reject: (reason?: unknown) => void,
      ) {
        try {
          const op = currentOp;
          recordCall();
          if (table === "awards" && op === "update") {
            resolve({ data: null, error: opts.awardUpdateError ?? null });
            return;
          }
          if (table === "report_fields" && op === "insert") {
            resolve({ data: null, error: opts.fieldsInsertError ?? null });
            return;
          }
          resolve({ data: null, error: null });
        } catch (e) {
          reject(e);
        }
      },
    };

    function recordCall() {
      if (!currentOp) return;
      calls.push({ table, op: currentOp, payload, filters: [...filters] });
      currentOp = null;
      payload = undefined;
      filters.length = 0;
    }

    return queryApi;
  }

  return { client: buildClient(), calls };
}

// Happy-path fixture that matches the reporting_requirements schema.
// `as const` narrows enum-like strings so spreads preserve their literal
// types.
const HAPPY_REQUIREMENTS = {
  award_summary: {
    program_name: "Tier 1",
    funder_name: "Rasmuson",
    award_min_usd: 10000,
    award_max_usd: 25000,
    period_months: 12,
    cfda_number: null,
    eligibility_summary: "AK nonprofits",
  },
  reports: [
    {
      title: "Interim Progress Report",
      report_type: "progress",
      due_offset_days: 30,
      period_months: 6,
      format: "portal",
      narrative_sections: [
        {
          key: "program_summary",
          label: "Program Summary",
          field_type: "narrative",
          required: true,
          word_count_max: 500,
          word_count_min: 100,
        },
        {
          key: "metrics",
          label: "Metrics",
          field_type: "table",
          required: true,
          word_count_max: null,
          word_count_min: null,
        },
      ],
    },
  ],
  citations: [],
  uncertainties: [],
};

// no fetch mock: we mock the workers module directly above.

const BASE_AWARD_ROW = {
  id: AWARD_ID,
  tenant_id: TENANT,
  source_document_id: DOC_ID,
  period_start: "2026-01-01",
  period_end: "2026-06-30",
  extraction_attempts: 0,
};

beforeEach(() => {
  mockedExtractRequirements.mockReset();
});

describe("computeDueAt", () => {
  it("adds offset days to period_end in UTC", () => {
    expect(computeDueAt("2026-06-30", 30)).toBe("2026-07-30T00:00:00.000Z");
  });

  it("handles month rollover", () => {
    expect(computeDueAt("2026-01-31", 1)).toBe("2026-02-01T00:00:00.000Z");
  });

  it("rejects invalid dates", () => {
    expect(() => computeDueAt("not-a-date", 30)).toThrow(/invalid period_end/);
  });
});

describe("runExtractionForAward", () => {
  it("happy path: creates reports and report_fields with the right due_at", async () => {
    const { client, calls } = makeSupabase({ awardRow: BASE_AWARD_ROW });
    mockedExtractRequirements.mockResolvedValueOnce({
      // @ts-expect-error: partial fixture matches the schema shape at runtime
      requirements: HAPPY_REQUIREMENTS,
      attempts: 1,
      schema_valid: true,
      schema_errors: null,
      tokens_in: 100,
      tokens_out: 200,
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("ok");

    // Confirm report insert happened with the right due_at.
    const reportInsert = calls.find(
      (c) => c.table === "reports" && c.op === "insert",
    );
    expect(reportInsert).toBeDefined();
    const reportPayload = reportInsert?.payload as Record<string, unknown>;
    expect(reportPayload.title).toBe("Interim Progress Report");
    expect(reportPayload.due_at).toBe("2026-07-30T00:00:00.000Z");
    expect(reportPayload.tenant_id).toBe(TENANT);
    expect(reportPayload.award_id).toBe(AWARD_ID);
    expect(reportPayload.status).toBe("upcoming");
    expect(reportPayload.report_type).toBe("progress");
    expect(reportPayload.submission_format).toBe("portal");

    // Confirm report_fields insert happened with both sections.
    const fieldsInsert = calls.find(
      (c) => c.table === "report_fields" && c.op === "insert",
    );
    expect(fieldsInsert).toBeDefined();
    const fieldRows = fieldsInsert?.payload as Array<Record<string, unknown>>;
    expect(fieldRows).toHaveLength(2);
    expect(fieldRows[0].key).toBe("program_summary");
    expect(fieldRows[0].word_count_max).toBe(500);
    expect(fieldRows[1].key).toBe("metrics");
    expect(fieldRows[1].word_count_max).toBeNull();

    // Final award update flips status to ok.
    const finalUpdate = calls
      .filter((c) => c.table === "awards" && c.op === "update")
      .at(-1);
    expect(
      (finalUpdate?.payload as Record<string, unknown>).extraction_status,
    ).toBe("ok");
  });

  it("manual_review when schema_valid is false, no reports created", async () => {
    const { client, calls } = makeSupabase({ awardRow: BASE_AWARD_ROW });
    mockedExtractRequirements.mockResolvedValueOnce({
      // @ts-expect-error: partial fixture matches the schema shape at runtime
      requirements: HAPPY_REQUIREMENTS,
      attempts: 2,
      schema_valid: false,
      schema_errors: ["reports.0.due_offset_days: missing"],
      tokens_in: 100,
      tokens_out: 200,
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("manual_review");
    expect(result.error).toContain("schema_validation_failed");

    // No reports rows inserted.
    const reportInserts = calls.filter(
      (c) => c.table === "reports" && c.op === "insert",
    );
    expect(reportInserts).toHaveLength(0);

    // Last award update carries manual_review status + error.
    const finalUpdate = calls
      .filter((c) => c.table === "awards" && c.op === "update")
      .at(-1);
    expect(
      (finalUpdate?.payload as Record<string, unknown>).extraction_status,
    ).toBe("manual_review");
    expect(
      (finalUpdate?.payload as Record<string, unknown>).extraction_error,
    ).toContain("schema_validation_failed");
  });

  it("failed when worker returns HTTP 500", async () => {
    const { client, calls } = makeSupabase({ awardRow: BASE_AWARD_ROW });
    mockedExtractRequirements.mockRejectedValueOnce(
      new WorkerError("worker /extract/requirements returned 500: internal", 500),
    );

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");

    const reportInserts = calls.filter(
      (c) => c.table === "reports" && c.op === "insert",
    );
    expect(reportInserts).toHaveLength(0);

    const finalUpdate = calls
      .filter((c) => c.table === "awards" && c.op === "update")
      .at(-1);
    expect(
      (finalUpdate?.payload as Record<string, unknown>).extraction_status,
    ).toBe("failed");
  });

  it("returns failed when award is not found", async () => {
    const { client } = makeSupabase({ awardRow: null });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("award_not_found");
    expect(mockedExtractRequirements).not.toHaveBeenCalled();
  });

  it("returns failed and writes failed status when source_document_id is null", async () => {
    const { client, calls } = makeSupabase({
      awardRow: { ...BASE_AWARD_ROW, source_document_id: null },
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("missing_source_document");
    const failedUpdate = calls.find(
      (c) => c.table === "awards" && c.op === "update",
    );
    expect(
      (failedUpdate?.payload as Record<string, unknown>).extraction_status,
    ).toBe("failed");
    expect(mockedExtractRequirements).not.toHaveBeenCalled();
  });

  it("returns failed when period_end is null", async () => {
    const { client } = makeSupabase({
      awardRow: { ...BASE_AWARD_ROW, period_end: null },
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("missing_period_end");
    expect(mockedExtractRequirements).not.toHaveBeenCalled();
  });

  it("returns failed when the running-status DB update errors", async () => {
    const { client } = makeSupabase({
      awardRow: BASE_AWARD_ROW,
      awardUpdateError: { message: "connection timeout" },
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("status_update_failed");
    expect(mockedExtractRequirements).not.toHaveBeenCalled();
  });

  it("returns failed when reports insert errors during persist", async () => {
    const { client } = makeSupabase({
      awardRow: BASE_AWARD_ROW,
      reportsInsertResult: {
        data: null,
        error: { message: "unique constraint violation" },
      },
    });
    mockedExtractRequirements.mockResolvedValueOnce({
      // @ts-expect-error partial fixture
      requirements: HAPPY_REQUIREMENTS,
      attempts: 1,
      schema_valid: true,
      schema_errors: null,
      tokens_in: 10,
      tokens_out: 20,
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("reports insert failed");
  });

  it("returns failed when period_start is missing at persist time", async () => {
    const { client } = makeSupabase({
      awardRow: { ...BASE_AWARD_ROW, period_start: null },
    });
    mockedExtractRequirements.mockResolvedValueOnce({
      // @ts-expect-error partial fixture
      requirements: HAPPY_REQUIREMENTS,
      attempts: 1,
      schema_valid: true,
      schema_errors: null,
      tokens_in: 5,
      tokens_out: 10,
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("missing period_start");
  });

  it("completes ok with zero reports and inserts no rows", async () => {
    const { client, calls } = makeSupabase({ awardRow: BASE_AWARD_ROW });
    mockedExtractRequirements.mockResolvedValueOnce({
      requirements: {
        ...HAPPY_REQUIREMENTS,
        reports: [],
      } as unknown as import("@/lib/types/worker").ExtractedRequirements,
      attempts: 1,
      schema_valid: true,
      schema_errors: null,
      tokens_in: 5,
      tokens_out: 10,
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("ok");
    expect(
      calls.filter((c) => c.table === "reports" && c.op === "insert"),
    ).toHaveLength(0);
    expect(
      calls.filter((c) => c.table === "report_fields" && c.op === "insert"),
    ).toHaveLength(0);
  });

  it("skips report_fields insert when narrative_sections is empty", async () => {
    const { client, calls } = makeSupabase({ awardRow: BASE_AWARD_ROW });
    mockedExtractRequirements.mockResolvedValueOnce({
      requirements: {
        ...HAPPY_REQUIREMENTS,
        reports: [{ ...HAPPY_REQUIREMENTS.reports[0], narrative_sections: [] }],
      } as unknown as import("@/lib/types/worker").ExtractedRequirements,
      attempts: 1,
      schema_valid: true,
      schema_errors: null,
      tokens_in: 5,
      tokens_out: 10,
    });

    const result = await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("ok");
    expect(
      calls.filter((c) => c.table === "reports" && c.op === "insert"),
    ).toHaveLength(1);
    expect(
      calls.filter((c) => c.table === "report_fields" && c.op === "insert"),
    ).toHaveLength(0);
  });

  it("computes due_at as period_end + due_offset_days (30 day offset)", async () => {
    const { client, calls } = makeSupabase({
      awardRow: { ...BASE_AWARD_ROW, period_end: "2026-06-30" },
    });
    mockedExtractRequirements.mockResolvedValueOnce({
      requirements: {
        ...HAPPY_REQUIREMENTS,
        reports: [
          {
            ...HAPPY_REQUIREMENTS.reports[0],
            due_offset_days: 30,
          },
        ],
      } as unknown as import("@/lib/types/worker").ExtractedRequirements,
      attempts: 1,
      schema_valid: true,
      schema_errors: null,
      tokens_in: 0,
      tokens_out: 0,
    });

    await runExtractionForAward(
      AWARD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    const reportInsert = calls.find(
      (c) => c.table === "reports" && c.op === "insert",
    );
    const payload = reportInsert?.payload as Record<string, unknown>;
    expect(payload.due_at).toBe("2026-07-30T00:00:00.000Z");
  });
});
