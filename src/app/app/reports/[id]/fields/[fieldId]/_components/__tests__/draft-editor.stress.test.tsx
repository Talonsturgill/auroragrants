// @vitest-environment jsdom

/**
 * Red-team citation grounding tests for DraftEditor and tokenizeDraft.
 *
 * Tests verify:
 *  1. A [5] token with no matching citation renders as a [?] pill (not a crash).
 *  2. Content with no [n] tokens renders as plain text with zero pills.
 *  3. Content with [99] renders the pill with index=99.
 *  4. Multiple missing citations each get their own [?] pill.
 *  5. Mixed valid + missing citations render correctly.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Citation } from "@/lib/types/draft";

import { DraftEditor, tokenizeDraft } from "../draft-editor";

afterEach(() => {
  cleanup();
});

const CITATION_1: Citation = {
  citation_id: 1,
  chunk_id: "c-1",
  document_id: "d-1",
  document_title: "Rasmuson Legacy LOI",
  page_start: 4,
  page_end: 4,
  section_heading: "Reporting requirements",
  excerpt: "The interim report is due six months after award notice.",
  source: "funder",
};

describe("DraftEditor — citation grounding stress tests", () => {
  // -----------------------------------------------------------
  // 1. [5] token with no matching citation → [?] pill, no crash
  // -----------------------------------------------------------
  it("renders [?] pill when citation index has no matching entry in citations list", () => {
    // Citations only has index=1, but the content references [5].
    const { container } = render(
      <DraftEditor
        content="This sentence lacks a source [5]."
        citations={[CITATION_1]}
      />,
    );

    // Must not crash. The pill for [5] should exist.
    const pill = container.querySelector('button[data-citation-id="5"]');
    expect(pill).not.toBeNull();

    // Missing citation must be flagged with data-missing="true".
    expect(pill?.getAttribute("data-missing")).toBe("true");

    // Text must show [?] not [5].
    expect(pill?.textContent).toContain("[?]");
    expect(pill?.textContent).not.toContain("[5]");
  });

  // -----------------------------------------------------------
  // 2. Content with no [n] tokens → plain text, zero pills
  // -----------------------------------------------------------
  it("renders plain text without any citation pills when no [n] tokens are present", () => {
    const content = "This draft has no citations at all. It is plain prose.";
    const { container } = render(
      <DraftEditor content={content} citations={[CITATION_1]} />,
    );

    // No pills should be rendered.
    const pills = container.querySelectorAll("button[data-citation-id]");
    expect(pills.length).toBe(0);

    // All text should appear in the DOM.
    expect(container.textContent).toContain("no citations at all");
  });

  it("tokenizeDraft returns no cite segments for plain text", () => {
    const segs = tokenizeDraft("No citations here.");
    const cites = segs.filter((s) => s.kind === "cite");
    expect(cites.length).toBe(0);

    const texts = segs.filter((s) => s.kind === "text");
    expect(texts.length).toBe(1);
    expect((texts[0] as { kind: "text"; value: string }).value).toBe(
      "No citations here.",
    );
  });

  // -----------------------------------------------------------
  // 3. Content with [99] → pill with index=99
  // -----------------------------------------------------------
  it("renders a pill with index=99 for a [99] token", () => {
    const { container } = render(
      <DraftEditor
        content="The program served many clients [99]."
        citations={[]} // No matching citation for 99.
      />,
    );

    const pill = container.querySelector('button[data-citation-id="99"]');
    expect(pill).not.toBeNull();
    // Since no citation matches 99, it renders as missing.
    expect(pill?.getAttribute("data-missing")).toBe("true");
    expect(pill?.textContent).toContain("[?]");
  });

  it("tokenizeDraft extracts index=99 from [99] token", () => {
    const segs = tokenizeDraft("Some text [99] more text.");
    const cites = segs.filter((s) => s.kind === "cite");
    expect(cites.length).toBe(1);
    const cite = cites[0] as { kind: "cite"; index: number };
    expect(cite.index).toBe(99);
  });

  // -----------------------------------------------------------
  // 4. Multiple missing citations → each gets its own [?] pill
  // -----------------------------------------------------------
  it("renders separate [?] pills for each missing citation token", () => {
    const { container } = render(
      <DraftEditor
        content="Claim A [10]. Claim B [20]. Claim C [30]."
        citations={[]} // All missing.
      />,
    );

    const pills = container.querySelectorAll("button[data-citation-id]");
    expect(pills.length).toBe(3);

    // Each must be flagged missing.
    for (const pill of pills) {
      expect(pill.getAttribute("data-missing")).toBe("true");
      expect(pill.textContent).toContain("[?]");
    }

    // Each has its own data-citation-id.
    const ids = Array.from(pills).map((p) => p.getAttribute("data-citation-id"));
    expect(ids).toContain("10");
    expect(ids).toContain("20");
    expect(ids).toContain("30");
  });

  // -----------------------------------------------------------
  // 5. Mixed valid + missing citations
  // -----------------------------------------------------------
  it("renders valid pill for citation_id=1 and [?] pill for unknown citation_id=9", () => {
    const { container } = render(
      <DraftEditor
        content="Valid source [1]. Unknown source [9]."
        citations={[CITATION_1]}
      />,
    );

    const pill1 = container.querySelector('button[data-citation-id="1"]');
    const pill9 = container.querySelector('button[data-citation-id="9"]');

    // Citation 1 is present → not missing.
    expect(pill1).not.toBeNull();
    expect(pill1?.getAttribute("data-missing")).toBe("false");
    expect(pill1?.textContent).toBe("[1]");

    // Citation 9 is absent → missing.
    expect(pill9).not.toBeNull();
    expect(pill9?.getAttribute("data-missing")).toBe("true");
    expect(pill9?.textContent).toContain("[?]");
  });

  // -----------------------------------------------------------
  // 6. Empty content → renders without crashing, zero pills
  // -----------------------------------------------------------
  it("renders safely with empty string content", () => {
    const { container } = render(
      <DraftEditor content="" citations={[CITATION_1]} />,
    );
    const pills = container.querySelectorAll("button[data-citation-id]");
    expect(pills.length).toBe(0);
  });

  // -----------------------------------------------------------
  // 7. tokenizeDraft is non-greedy: [foo] is ignored, [3] is captured
  // -----------------------------------------------------------
  it("tokenizeDraft ignores non-numeric bracket tokens like [foo]", () => {
    const segs = tokenizeDraft("Keep [foo] and cite [3].");
    const cites = segs.filter((s) => s.kind === "cite");
    expect(cites.length).toBe(1);
    const cite = cites[0] as { kind: "cite"; index: number };
    expect(cite.index).toBe(3);

    // [foo] must appear as plain text.
    const texts = segs
      .filter((s) => s.kind === "text")
      .map((s) => (s as { kind: "text"; value: string }).value)
      .join("");
    expect(texts).toContain("[foo]");
  });
});
