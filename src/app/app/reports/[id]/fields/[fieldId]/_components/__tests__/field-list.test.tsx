// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { deriveFieldStatus, type ReportField } from "@/lib/types/reports";

import { FieldList, sortFields } from "../field-list";

afterEach(() => {
  cleanup();
});

function makeField(overrides: Partial<ReportField>): ReportField {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? "f-1",
    tenant_id: "t-1",
    report_id: "r-1",
    key: overrides.key ?? "narrative",
    label: overrides.label ?? "Narrative",
    field_type: overrides.field_type ?? "narrative",
    required: overrides.required ?? true,
    word_count_min: overrides.word_count_min ?? null,
    word_count_max: overrides.word_count_max ?? null,
    current_value: overrides.current_value ?? null,
    current_value_json: overrides.current_value_json ?? null,
    draft_value: overrides.draft_value ?? null,
    last_draft_at: overrides.last_draft_at ?? null,
    last_draft_eval: overrides.last_draft_eval ?? null,
    human_reviewed: overrides.human_reviewed ?? false,
    human_approved: overrides.human_approved ?? false,
    approver_user_id: overrides.approver_user_id ?? null,
    approved_at: overrides.approved_at ?? null,
    source_rubric_id: overrides.source_rubric_id ?? null,
    created_at: now,
    updated_at: now,
  };
}

const FIELDS: ReportField[] = [
  makeField({
    id: "f-approved",
    label: "Budget variance",
    required: true,
    current_value: "done",
    human_approved: true,
  }),
  makeField({
    id: "f-drafting",
    label: "Narrative summary",
    required: true,
    draft_value: "in progress",
  }),
  makeField({
    id: "f-not-started",
    label: "Zip file upload",
    required: false,
  }),
  makeField({
    id: "f-ready",
    label: "Program metrics",
    required: true,
    current_value: "reviewable",
  }),
];

describe("sortFields", () => {
  it("puts required before optional and sorts each group by label", () => {
    const sorted = sortFields(FIELDS).map((f) => f.id);
    // Required fields alphabetical by label: Budget, Narrative, Program.
    expect(sorted.slice(0, 3)).toEqual(["f-approved", "f-drafting", "f-ready"]);
    // Optional last.
    expect(sorted.at(-1)).toBe("f-not-started");
  });
});

describe("FieldList", () => {
  it("highlights the active field via aria-current=page and data-active", () => {
    const { container } = render(
      <FieldList
        reportId="r-1"
        activeFieldId="f-drafting"
        fields={FIELDS}
      />,
    );
    const active = container.querySelector('a[data-field-id="f-drafting"]');
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(active?.getAttribute("data-active")).toBe("true");

    const inactive = container.querySelector('a[data-field-id="f-approved"]');
    expect(inactive?.getAttribute("aria-current")).toBeNull();
    expect(inactive?.getAttribute("data-active")).toBe("false");
  });

  it("renders a status pill matching deriveFieldStatus for every field", () => {
    const { container } = render(
      <FieldList
        reportId="r-1"
        activeFieldId="f-drafting"
        fields={FIELDS}
      />,
    );
    for (const f of FIELDS) {
      const link = container.querySelector(`a[data-field-id="${f.id}"]`);
      const pill = link?.querySelector("span[data-status]");
      expect(pill).not.toBeNull();
      expect(pill?.getAttribute("data-status")).toBe(deriveFieldStatus(f));
    }
  });

  it("links each field to /app/reports/[id]/fields/[fieldId]", () => {
    const { container } = render(
      <FieldList reportId="r-42" activeFieldId="f-drafting" fields={FIELDS} />,
    );
    const links = container.querySelectorAll("a[data-field-id]");
    for (const a of Array.from(links)) {
      const href = a.getAttribute("href") ?? "";
      expect(href).toMatch(/^\/app\/reports\/r-42\/fields\/f-/);
    }
  });

  it("renders the Optional marker only for non-required fields", () => {
    const { container } = render(
      <FieldList reportId="r-1" activeFieldId="f-drafting" fields={FIELDS} />,
    );
    const optionalLink = container.querySelector(
      'a[data-field-id="f-not-started"]',
    );
    const requiredLink = container.querySelector(
      'a[data-field-id="f-drafting"]',
    );
    expect(optionalLink?.textContent).toContain("Optional");
    expect(requiredLink?.textContent ?? "").not.toContain("Optional");
  });

  it("shows an approved-count summary in the header", () => {
    const { getByText } = render(
      <FieldList reportId="r-1" activeFieldId="f-drafting" fields={FIELDS} />,
    );
    // Exactly one field has human_approved=true.
    expect(getByText(/1/)).toBeTruthy();
    expect(getByText(/4/)).toBeTruthy();
  });
});
