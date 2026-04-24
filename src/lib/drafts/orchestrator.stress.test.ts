/**
 * Stress tests for the Phase 4 drafting orchestrator.
 *
 * Covers:
 *  - surface_decision=surface_with_flag: surfaced_to_user=true if eval passes.
 *  - Eval gate failure prevents surfacing even when WCE says surface.
 *  - draft_status is set to "failed" when worker throws WorkerError.
 *  - Version auto-increment when 2 prior drafts exist (version should be 3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workers")>(
    "@/lib/workers",
  );
  return {
    ...actual,
    draftReportField: vi.fn(),
    runEvalGate: vi.fn(),
  };
});

import { draftReportField, runEvalGate, WorkerError } from "@/lib/workers";
import type { DraftResponse, EvalGateResponse } from "@/lib/types/draft";

import { runDrafterForField } from "./orchestrator";

const mockedDraftReportField = vi.mocked(draftReportField);
const mockedRunEvalGate = vi.mocked(runEvalGate);

const TENANT = "11111111-2222-3333-4444-555555555555";
const FIELD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const REPORT_ID = "22222222-3333-4444-5555-666666666666";
const AWARD_ID = "33333333-4444-5555-6666-777777777777";
const FUNDER_ID = "44444444-5555-6666-7777-888888888888";

interface Call {
  table: string;
  op: "select" | "insert" | "update";
  payload?: unknown;
  filters: Array<[string, string]>;
}

interface SupaOpts {
  fieldRow: Record<string, unknown> | null;
  reportRow?: Record<string, unknown> | null;
  awardRow?: Record<string, unknown> | null;
  funderRow?: Record<string, unknown> | null;
  tenantRow?: Record<string, unknown> | null;
  latestDraftRow?: Record<string, unknown> | null;
  draftInsertResult?: { data: unknown; error: unknown };
}

function makeSupabase(opts: SupaOpts): {
  client: unknown;
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
    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const api = {
      select() {
        if (currentOp === null) currentOp = "select";
        return api;
      },
      insert(row: unknown) {
        currentOp = "insert";
        payload = row;
        return api;
      },
      update(row: unknown) {
        currentOp = "update";
        payload = row;
        return api;
      },
      eq(col: string, val: string) {
        filters.push([col, val]);
        return api;
      },
      order(col: string, spec?: { ascending?: boolean }) {
        orderKey = col;
        orderAsc = spec?.ascending ?? true;
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      async maybeSingle() {
        recordCall();
        if (table === "report_fields") return { data: opts.fieldRow, error: null };
        if (table === "reports")
          return { data: opts.reportRow ?? null, error: null };
        if (table === "awards")
          return { data: opts.awardRow ?? null, error: null };
        if (table === "funders")
          return { data: opts.funderRow ?? null, error: null };
        if (table === "tenants")
          return { data: opts.tenantRow ?? null, error: null };
        return { data: null, error: null };
      },
      async single() {
        recordCall();
        if (table === "drafts") {
          if (opts.draftInsertResult) return opts.draftInsertResult;
          return { data: { id: `draft-${calls.length}` }, error: null };
        }
        return { data: null, error: null };
      },
      then(
        resolve: (value: { data: unknown; error: unknown }) => void,
        reject: (reason?: unknown) => void,
      ) {
        try {
          recordCall();
          if (table === "drafts" && currentOpWas === "select") {
            const row = opts.latestDraftRow ?? null;
            resolve({ data: row ? [row] : [], error: null });
            return;
          }
          resolve({ data: null, error: null });
        } catch (e) {
          reject(e);
        }
      },
    };

    let currentOpWas: "select" | "insert" | "update" | null = null;

    function recordCall() {
      if (!currentOp) return;
      currentOpWas = currentOp;
      calls.push({
        table,
        op: currentOp,
        payload,
        filters: [...filters],
      });
      currentOp = null;
      payload = undefined;
      filters.length = 0;
      orderKey = null;
      orderAsc = true;
      limitN = null;
      void orderKey;
      void orderAsc;
      void limitN;
    }

    return api;
  }

  return { client: buildClient(), calls };
}

const BASE_FIELD_ROW = {
  id: FIELD_ID,
  tenant_id: TENANT,
  report_id: REPORT_ID,
  key: "program_summary",
  label: "Program Summary",
  field_type: "narrative",
  word_count_max: 500,
  word_count_min: 100,
  draft_status: "idle",
};

const BASE_REPORT_ROW = {
  id: REPORT_ID,
  tenant_id: TENANT,
  award_id: AWARD_ID,
  title: "Interim Progress Report",
};

const BASE_AWARD_ROW = {
  id: AWARD_ID,
  tenant_id: TENANT,
  funder_id: FUNDER_ID,
  amount_usd: 25000,
  program_name: "Tier 1",
};

const BASE_FUNDER_ROW = {
  id: FUNDER_ID,
  name: "Rasmuson Foundation",
  rubric: [{ id: "impact", label: "Community impact", weight: 0.2 }],
  known_programs: ["Tier 1", "Tier 2"],
};

const BASE_TENANT_ROW = {
  id: TENANT,
  name: "Test Nonprofit",
  org_type: "501c3",
  ein: "12-3456789",
};

/** A draft where surface_decision is "surface_with_flag" (score 7.5, no high-sev fixes). */
const FLAG_DRAFT: DraftResponse = {
  draft: {
    content: "We served elders [1] in Nome [2].",
    citations: [],
    word_count: 6,
    uncovered_claims: [],
  },
  critique: {
    rubric_scores: {},
    overall_score: 7.5,
    fixes: [],
    ready_to_surface: false,
  },
  iterations: 3,
  tokens_in: 900,
  tokens_out: 300,
  cost_cents: 9,
  surface_decision: "surface_with_flag",
  model_writer: "claude-sonnet-4-6",
  model_critic: "claude-sonnet-4-6",
  model_editor: "claude-sonnet-4-6",
  wce_trace: { retrieved_chunks: [], iterations: [], retrieval_query: "q", high_stakes: false },
};

const PASS_GATE: EvalGateResponse = {
  scores: {
    factuality: 0.98,
    rubric_adherence: 0.95,
    hallucinated_programs: 0,
    readability: 60,
    word_count_compliance: 1,
  },
  passed: true,
  failures: [],
};

const FAIL_GATE: EvalGateResponse = {
  scores: {
    factuality: 0.85,
    rubric_adherence: 0.7,
    hallucinated_programs: 1,
    readability: 40,
    word_count_compliance: 0,
  },
  passed: false,
  failures: [
    { check: "factuality", score: 0.85, threshold: 0.95, reason: "below threshold" },
    { check: "word_count", score: 0, threshold: 1, reason: "too many words" },
  ],
};

beforeEach(() => {
  mockedDraftReportField.mockReset();
  mockedRunEvalGate.mockReset();
});

describe("orchestrator stress tests", () => {
  // -----------------------------------------------------------------
  // 1. surface_with_flag + passing eval → surfaced_to_user = true
  // -----------------------------------------------------------------
  it("surface_decision=surface_with_flag still surfaces when eval passes", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce(FLAG_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    // surface_with_flag + eval passed → surfaced_to_user must be true.
    expect(result.status).toBe("ok");
    expect(result.surface_decision).toBe("surface_with_flag");
    expect(result.eval_passed).toBe(true);

    const draftInsert = calls.find((c) => c.table === "drafts" && c.op === "insert");
    expect(draftInsert).toBeDefined();
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.surfaced_to_user).toBe(true);

    // draft_value should be promoted.
    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastPatch = fieldUpdates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch.draft_status).toBe("ready_for_review");
    expect(lastPatch.draft_value).toBe(FLAG_DRAFT.draft.content);
  });

  // -----------------------------------------------------------------
  // 2. WCE says surface_with_flag but eval fails → NOT surfaced
  // -----------------------------------------------------------------
  it("eval gate failure prevents surfacing even when WCE says surface_with_flag", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce(FLAG_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(FAIL_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    // Eval failed → draft must not be surfaced.
    expect(result.status).toBe("blocked");
    expect(result.eval_passed).toBe(false);

    const draftInsert = calls.find((c) => c.table === "drafts" && c.op === "insert");
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.surfaced_to_user).toBe(false);

    // draft_value must NOT be promoted.
    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastPatch = fieldUpdates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch.draft_value).toBeUndefined();
    expect(lastPatch.draft_status).toBe("idle");
  });

  // -----------------------------------------------------------------
  // 3. Worker throws WorkerError → draft_status = "failed"
  // -----------------------------------------------------------------
  it("draft_status is set to failed when worker throws WorkerError", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockRejectedValueOnce(
      new WorkerError("worker /wce/draft-field returned 503: upstream timeout", 503),
    );

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("worker_error_503");

    // Eval gate should never be called.
    expect(mockedRunEvalGate).not.toHaveBeenCalled();

    // The last report_fields update must set draft_status="failed".
    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastPatch = fieldUpdates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch.draft_status).toBe("failed");

    // No drafts row should have been inserted.
    expect(
      calls.filter((c) => c.table === "drafts" && c.op === "insert"),
    ).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // 4. Version auto-increments: 2 prior drafts → version = 3
  // -----------------------------------------------------------------
  it("version is 3 when 2 prior drafts exist", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
      // The latest existing draft has version=2.
      latestDraftRow: { version: 2 },
    });
    mockedDraftReportField.mockResolvedValueOnce(FLAG_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("ok");

    const draftInsert = calls.find((c) => c.table === "drafts" && c.op === "insert");
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.version).toBe(3);
  });

  // -----------------------------------------------------------------
  // 5. Worker throws generic Error (not WorkerError) → draft_status = "failed"
  // -----------------------------------------------------------------
  it("draft_status is failed when worker throws a generic Error", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockRejectedValueOnce(new Error("network timeout"));

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("network timeout");

    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastPatch = fieldUpdates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch.draft_status).toBe("failed");
  });

  // -----------------------------------------------------------------
  // 6. WCE says "block" + eval passes → NOT surfaced (blocked)
  // -----------------------------------------------------------------
  it("WCE block decision prevents surfacing even when eval passes", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    const blockedDraft: DraftResponse = {
      ...FLAG_DRAFT,
      surface_decision: "block",
      critique: { ...FLAG_DRAFT.critique, overall_score: 5.5 },
    };
    mockedDraftReportField.mockResolvedValueOnce(blockedDraft);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("blocked");
    expect(result.surface_decision).toBe("block");

    const draftInsert = calls.find((c) => c.table === "drafts" && c.op === "insert");
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.surfaced_to_user).toBe(false);
  });
});
