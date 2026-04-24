// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Citation } from "@/lib/types/draft";

import { DraftEditor, tokenizeDraft } from "../draft-editor";

afterEach(() => {
  cleanup();
});

const SAMPLE_CITATIONS: Citation[] = [
  {
    citation_id: 1,
    chunk_id: "c-1",
    document_id: "d-1",
    document_title: "Rasmuson Legacy LOI",
    page_start: 4,
    page_end: 4,
    section_heading: "Reporting requirements",
    excerpt: "The interim report is due six months after award notice.",
    source: "funder",
  },
  {
    citation_id: 2,
    chunk_id: "c-2",
    document_id: "d-1",
    document_title: "Rasmuson Legacy LOI",
    page_start: 7,
    page_end: 8,
    section_heading: "Budget narrative",
    excerpt: "Applicants must describe budget variance above ten percent.",
    source: "funder",
  },
];

describe("tokenizeDraft", () => {
  it("splits text around citation tokens", () => {
    const segs = tokenizeDraft("First sentence [1]. Second [2] sentence.");
    expect(segs.filter((s) => s.kind === "cite").length).toBe(2);
    const citeIds = segs
      .filter((s): s is { kind: "cite"; index: number; key: string } => s.kind === "cite")
      .map((s) => s.index);
    expect(citeIds).toEqual([1, 2]);
  });

  it("ignores bracketed non-numeric tokens", () => {
    const segs = tokenizeDraft("Keep [foo] as text and cite [3].");
    const cites = segs.filter((s) => s.kind === "cite");
    expect(cites.length).toBe(1);
  });
});

describe("DraftEditor", () => {
  it("renders draft content with pill for every citation token", () => {
    const { container } = render(
      <DraftEditor
        content="The program served 412 families [1]. Budget variance stayed under target [2]."
        citations={SAMPLE_CITATIONS}
      />,
    );
    const pills = container.querySelectorAll("button[data-citation-id]");
    expect(pills.length).toBe(2);
    expect(pills[0].getAttribute("data-citation-id")).toBe("1");
    expect(pills[1].getAttribute("data-citation-id")).toBe("2");
  });

  it("renders a distinct pill for missing citations", () => {
    const { container } = render(
      <DraftEditor
        content="This claim lacks support [9]."
        citations={SAMPLE_CITATIONS}
      />,
    );
    const pill = container.querySelector('button[data-citation-id="9"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-missing")).toBe("true");
    expect(pill?.textContent).toContain("[?]");
  });

  it("invokes onCitationActivate when a pill is clicked", () => {
    const onActivate = vi.fn();
    const { container } = render(
      <DraftEditor
        content="A claim [1]."
        citations={SAMPLE_CITATIONS}
        onCitationActivate={onActivate}
      />,
    );
    const pill = container.querySelector(
      'button[data-citation-id="1"]',
    ) as HTMLButtonElement;
    fireEvent.click(pill);
    expect(onActivate).toHaveBeenCalledWith(1);
  });

  it("registers pill refs via registerPillRef", () => {
    const seen = new Map<number, HTMLButtonElement | null>();
    render(
      <DraftEditor
        content="A claim [1]. Another claim [2]."
        citations={SAMPLE_CITATIONS}
        registerPillRef={(id, el) => {
          seen.set(id, el);
        }}
      />,
    );
    expect(seen.get(1)).toBeInstanceOf(HTMLButtonElement);
    expect(seen.get(2)).toBeInstanceOf(HTMLButtonElement);
  });

  it("splits paragraphs on blank lines", () => {
    const { container } = render(
      <DraftEditor
        content={"Paragraph one [1].\n\nParagraph two [2]."}
        citations={SAMPLE_CITATIONS}
      />,
    );
    const paragraphs = container.querySelectorAll("[data-paragraph]");
    expect(paragraphs.length).toBe(2);
  });
});
