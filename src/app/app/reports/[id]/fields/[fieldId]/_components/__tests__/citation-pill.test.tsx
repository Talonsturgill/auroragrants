// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Citation } from "@/lib/types/draft";

import { CitationPill } from "../citation-pill";

afterEach(() => {
  cleanup();
});

const LONG_EXCERPT =
  "The Rasmuson Foundation requires a narrative summary that explains measurable progress against the objectives stated in the original proposal. Narratives shorter than the minimum word count will be returned.";

const CITATION: Citation = {
  citation_id: 1,
  chunk_id: "c-1",
  document_id: "d-1",
  document_title: "Rasmuson Legacy LOI",
  page_start: 4,
  page_end: 6,
  section_heading: "Reporting requirements",
  excerpt: LONG_EXCERPT,
  source: "funder",
};

describe("CitationPill", () => {
  it("renders the numeric token and document + page range for present citations", () => {
    const { container, getByRole } = render(
      <CitationPill citation={CITATION} index={1} />,
    );
    const pill = container.querySelector('button[data-citation-id="1"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe("[1]");
    const tooltip = getByRole("tooltip");
    expect(tooltip.textContent).toContain("Rasmuson Legacy LOI");
    expect(tooltip.textContent).toContain("p. 4–6");
  });

  it("aria-describes the trigger with the chunk excerpt truncated to 80 chars", () => {
    const { container } = render(
      <CitationPill citation={CITATION} index={1} />,
    );
    const describedSpan = container.querySelector(
      'span[aria-describedby^="tooltip-"]',
    );
    expect(describedSpan).not.toBeNull();
    const ariaLabel = describedSpan?.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("Citation 1");
    // Truncated to 80 chars in the accessible label.
    const truncatedChunk = LONG_EXCERPT.slice(0, 79).trimEnd() + "…";
    expect(ariaLabel).toContain(truncatedChunk);
  });

  it("renders a [?] pill with missing styling when citation is null", () => {
    const { container } = render(<CitationPill citation={null} index={5} />);
    const pill = container.querySelector('button[data-citation-id="5"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-missing")).toBe("true");
    expect(pill?.textContent).toBe("[?]");
    expect(pill?.className).toContain("border-destructive");
  });

  it("renders a single-page source when start === end", () => {
    const single: Citation = { ...CITATION, page_start: 4, page_end: 4 };
    const { getByRole } = render(<CitationPill citation={single} index={1} />);
    const tooltip = getByRole("tooltip");
    expect(tooltip.textContent).toContain("p. 4");
    expect(tooltip.textContent).not.toContain("p. 4–");
  });
});
