// @vitest-environment jsdom

import * as React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Citation } from "@/lib/types/draft";

import { CitationsPanel } from "../citations-panel";

afterEach(() => {
  cleanup();
});

const CITATIONS: Citation[] = [
  {
    citation_id: 2,
    chunk_id: "c-2",
    document_id: "d-1",
    document_title: "Rasmuson Legacy LOI",
    page_start: 7,
    page_end: 8,
    section_heading: "Budget narrative",
    excerpt: "Budget variance above ten percent must be described.",
    source: "funder",
  },
  {
    citation_id: 1,
    chunk_id: "c-1",
    document_id: "d-1",
    document_title: "Rasmuson Legacy LOI",
    page_start: 4,
    page_end: 4,
    section_heading: "Reporting",
    excerpt: "Interim reports are due six months after award notice.",
    source: "funder",
  },
];

function makeRefs(
  citations: Citation[],
): {
  ref: React.MutableRefObject<Map<number, HTMLButtonElement | null>>;
  buttons: Map<number, HTMLButtonElement>;
} {
  const buttons = new Map<number, HTMLButtonElement>();
  const map = new Map<number, HTMLButtonElement | null>();
  for (const c of citations) {
    const btn = document.createElement("button");
    btn.setAttribute("data-citation-id", String(c.citation_id));
    // Jsdom does not implement scrollIntoView by default.
    btn.scrollIntoView = vi.fn();
    document.body.appendChild(btn);
    buttons.set(c.citation_id, btn);
    map.set(c.citation_id, btn);
  }
  return { ref: { current: map }, buttons };
}

describe("CitationsPanel", () => {
  it("renders citations in numeric order regardless of input order", () => {
    const { ref } = makeRefs(CITATIONS);
    const { container } = render(
      <CitationsPanel citations={CITATIONS} pillRefs={ref} />,
    );
    const items = container.querySelectorAll("li[data-citation-id]");
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("data-citation-id")).toBe("1");
    expect(items[1].getAttribute("data-citation-id")).toBe("2");
  });

  it("calls scrollIntoView on the matching pill ref when an entry is clicked", () => {
    const { ref, buttons } = makeRefs(CITATIONS);
    const { container } = render(
      <CitationsPanel citations={CITATIONS} pillRefs={ref} />,
    );
    const target = container.querySelector(
      'li[data-citation-id="2"] button',
    ) as HTMLButtonElement;
    fireEvent.click(target);
    expect(buttons.get(2)!.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(buttons.get(1)!.scrollIntoView).not.toHaveBeenCalled();
  });

  it("briefly sets data-highlight on the scrolled pill", () => {
    vi.useFakeTimers();
    const { ref, buttons } = makeRefs(CITATIONS);
    const { container } = render(
      <CitationsPanel citations={CITATIONS} pillRefs={ref} />,
    );
    const target = container.querySelector(
      'li[data-citation-id="1"] button',
    ) as HTMLButtonElement;
    fireEvent.click(target);
    expect(buttons.get(1)!.getAttribute("data-highlight")).toBe("true");
    vi.advanceTimersByTime(1600);
    expect(buttons.get(1)!.getAttribute("data-highlight")).toBeNull();
    vi.useRealTimers();
  });

  it("renders an empty-state message when there are no citations", () => {
    const { ref } = makeRefs([]);
    const { getByText } = render(
      <CitationsPanel citations={[]} pillRefs={ref} />,
    );
    expect(getByText(/no citations/i)).toBeTruthy();
  });

  it("is collapsible via the header toggle", () => {
    const { ref } = makeRefs(CITATIONS);
    const { container, getByRole } = render(
      <CitationsPanel citations={CITATIONS} pillRefs={ref} />,
    );
    const header = getByRole("button", { name: /^citations/i });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("li[data-citation-id]").length).toBe(0);
  });
});
