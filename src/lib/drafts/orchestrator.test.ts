import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Orchestrator tests. We mock the workers module so the test never tries to
 * sign a JWT or hit fetch, and we drive `draftReportField` + `runEvalGate`
 * via the `mockResolvedValueOnce` / `mockRejectedValueOnce` pattern.
 */
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
            // SELECT version order desc limit 1 returns the "latest" row.
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

    // We need to know whether the call was select or insert/update inside
    // the thenable branch, so we capture it before recordCall resets it.
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

const HAPPY_DRAFT: DraftResponse = {
  draft: {
    content: "We served 142 elders [1] in Nome [2].",
    citations: [
      {
        id: "1",
        document_id: "doc1",
        chunk_id: "chunk1",
        page_start: 1,
        page_end: 1,
        excerpt: "142 elders served",
        section_heading: "Outcomes",
      },
      {
        id: "2",
        document_id: "doc1",
        chunk_id: "chunk2",
        page_start: 2,
        page_end: 2,
        excerpt: "Nome service area",
        section_heading: "Geography",
      },
    ],
    word_count: 8,
    uncovered_claims: [],
  },
  critique: {
    rubric_scores: { impact: { score: 2, max: 2 } },
    overall_score: 8.5,
    fixes: [],
    ready_to_surface: true,
  },
  iterations: 1,
  tokens_in: 1200,
  tokens_out: 400,
  cost_cents: 12,
  surface_decision: "surface",
  model_writer: "claude-sonnet-4-5",
  model_critic: "claude-sonnet-4-5",
  model_editor: "claude-sonnet-4-5",
  wce_trace: {
    retrieved_chunks: [
      {
        document_id: "doc1",
        chunk_id: "chunk1",
        page_start: 1,
        page_end: 1,
        section_heading: "Outcomes",
        content: "142 elders served",
      },
    ],
    iterations: [],
    retrieval_query: "Rasmuson Foundation Program Summary",
    high_stakes: false,
  },
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
    {
      check: "factuality",
      score: 0.85,
      threshold: 0.95,
      reason: "below threshold",
    },
    {
      check: "hallucinated_programs",
      score: 1,
      threshold: 0,
      reason: "unknown program mentioned",
    },
  ],
};

beforeEach(() => {
  mockedDraftReportField.mockReset();
  mockedRunEvalGate.mockReset();
});

describe("runDrafterForField", () => {
  it("happy path surfaces the draft and promotes draft_value", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce(HAPPY_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("ok");
    expect(result.eval_passed).toBe(true);
    expect(result.surface_decision).toBe("surface");
    expect(result.overall_score).toBe(8.5);
    expect(result.draft_id).toBeTruthy();

    // drafts insert should have surfaced_to_user=true, version=1.
    const draftInsert = calls.find(
      (c) => c.table === "drafts" && c.op === "insert",
    );
    expect(draftInsert).toBeDefined();
    const draftPayload = draftInsert?.payload as Record<string, unknown>;
    expect(draftPayload.surfaced_to_user).toBe(true);
    expect(draftPayload.version).toBe(1);
    expect(draftPayload.tenant_id).toBe(TENANT);
    expect(draftPayload.report_field_id).toBe(FIELD_ID);
    expect(draftPayload.eval_passed).toBe(true);

    // report_fields update: draft_value was promoted.
    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastFieldUpdate = fieldUpdates.at(-1);
    expect(lastFieldUpdate).toBeDefined();
    const patch = lastFieldUpdate?.payload as Record<string, unknown>;
    expect(patch.draft_status).toBe("ready_for_review");
    expect(patch.draft_value).toBe(HAPPY_DRAFT.draft.content);

    // Audit rows written for draft.started and draft.completed.
    const auditInserts = calls.filter(
      (c) => c.table === "audit_log" && c.op === "insert",
    );
    const actions = auditInserts.map(
      (c) => (c.payload as { action: string }).action,
    );
    expect(actions).toContain("draft.started");
    expect(actions).toContain("draft.completed");
  });

  it("eval gate fails: draft saved but not surfaced and status is blocked", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce(HAPPY_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(FAIL_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("blocked");
    expect(result.eval_passed).toBe(false);

    const draftInsert = calls.find(
      (c) => c.table === "drafts" && c.op === "insert",
    );
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.surfaced_to_user).toBe(false);
    expect(payload.eval_passed).toBe(false);
    expect(payload.failure_reason).toBeTruthy();

    // report_fields should NOT have promoted draft_value.
    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastPatch = fieldUpdates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch.draft_value).toBeUndefined();
    expect(lastPatch.draft_status).toBe("idle");

    // Audit includes draft.blocked.
    const auditActions = calls
      .filter((c) => c.table === "audit_log" && c.op === "insert")
      .map((c) => (c.payload as { action: string }).action);
    expect(auditActions).toContain("draft.blocked");
  });

  it("worker throws WorkerError: status=failed and report_fields.draft_status=failed", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockRejectedValueOnce(
      new WorkerError("worker /wce/draft-field returned 500: oops", 500),
    );

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("worker_error_500");
    expect(mockedRunEvalGate).not.toHaveBeenCalled();

    // drafts row never inserted.
    expect(
      calls.filter((c) => c.table === "drafts" && c.op === "insert"),
    ).toHaveLength(0);

    // report_fields last update sets draft_status=failed.
    const fieldUpdates = calls.filter(
      (c) => c.table === "report_fields" && c.op === "update",
    );
    const lastPatch = fieldUpdates.at(-1)?.payload as Record<string, unknown>;
    expect(lastPatch.draft_status).toBe("failed");
  });

  it("field not found: status=failed, worker never called", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: null,
    });

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("field_not_found");
    expect(mockedDraftReportField).not.toHaveBeenCalled();
    expect(mockedRunEvalGate).not.toHaveBeenCalled();

    // No drafts insert.
    expect(
      calls.filter((c) => c.table === "drafts" && c.op === "insert"),
    ).toHaveLength(0);
  });

  it("version auto-increments from prior max", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
      latestDraftRow: { version: 3 },
    });
    mockedDraftReportField.mockResolvedValueOnce(HAPPY_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("ok");
    const draftInsert = calls.find(
      (c) => c.table === "drafts" && c.op === "insert",
    );
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.version).toBe(4);
  });

  it("surface_decision=block: not surfaced even if eval passes", async () => {
    const { client, calls } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce({
      ...HAPPY_DRAFT,
      critique: { ...HAPPY_DRAFT.critique, overall_score: 5.5 },
      surface_decision: "block",
    });
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    const result = await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    expect(result.status).toBe("blocked");
    expect(result.surface_decision).toBe("block");
    const draftInsert = calls.find(
      (c) => c.table === "drafts" && c.op === "insert",
    );
    const payload = draftInsert?.payload as Record<string, unknown>;
    expect(payload.surfaced_to_user).toBe(false);
  });

  it("high_stakes is true when award amount > $500k", async () => {
    const { client } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: { ...BASE_AWARD_ROW, amount_usd: 750_000 },
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce(HAPPY_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    const call = mockedDraftReportField.mock.calls[0];
    expect(call).toBeDefined();
    const context = call[1];
    expect(context.high_stakes).toBe(true);
  });

  it("retrieval_query joins funder name and field label", async () => {
    const { client } = makeSupabase({
      fieldRow: BASE_FIELD_ROW,
      reportRow: BASE_REPORT_ROW,
      awardRow: BASE_AWARD_ROW,
      funderRow: BASE_FUNDER_ROW,
      tenantRow: BASE_TENANT_ROW,
    });
    mockedDraftReportField.mockResolvedValueOnce(HAPPY_DRAFT);
    mockedRunEvalGate.mockResolvedValueOnce(PASS_GATE);

    await runDrafterForField(
      FIELD_ID,
      TENANT,
      // @ts-expect-error test double
      client,
    );

    const ctx = mockedDraftReportField.mock.calls[0][1];
    expect(ctx.retrieval_query).toBe("Rasmuson Foundation Program Summary");
  });
});
