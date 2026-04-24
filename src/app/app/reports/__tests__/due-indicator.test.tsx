// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DueIndicator,
  describeDue,
} from "@/app/app/reports/_components/due-indicator";

afterEach(() => {
  cleanup();
});

const BASE = new Date("2026-04-24T12:00:00.000Z");

function offsetDays(days: number): string {
  const d = new Date(BASE);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

describe("describeDue", () => {
  it("classifies an overdue due date as 'overdue'", () => {
    const d = describeDue(offsetDays(-2), BASE);
    expect(d.tone).toBe("overdue");
    expect(d.relative).toMatch(/overdue by 2 days/);
  });

  it("classifies a due date within 14 days as 'soon'", () => {
    const d = describeDue(offsetDays(7), BASE);
    expect(d.tone).toBe("soon");
    expect(d.relative).toMatch(/in 7 days/);
  });

  it("classifies a due date within 30 days as 'upcoming'", () => {
    const d = describeDue(offsetDays(20), BASE);
    expect(d.tone).toBe("upcoming");
    expect(d.relative).toMatch(/in 20 days/);
  });

  it("classifies a far-future due date as 'distant'", () => {
    const d = describeDue(offsetDays(120), BASE);
    expect(d.tone).toBe("distant");
    expect(d.relative).toMatch(/in 120 days/);
  });

  it("uses 'due today' when the diff is under a day", () => {
    const d = describeDue(
      new Date(BASE.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      BASE,
    );
    expect(d.tone).toBe("soon");
    expect(d.relative).toBe("due today");
  });
});

describe("<DueIndicator>", () => {
  it("renders overdue with destructive tone", () => {
    render(<DueIndicator dueAt={offsetDays(-3)} now={BASE} />);
    const el = screen.getByText(/overdue by 3 days/i);
    const container = el.closest("[data-tone]");
    expect(container?.getAttribute("data-tone")).toBe("overdue");
  });

  it("renders within-14 with soon tone", () => {
    render(<DueIndicator dueAt={offsetDays(10)} now={BASE} />);
    const el = screen.getByText(/in 10 days/i);
    const container = el.closest("[data-tone]");
    expect(container?.getAttribute("data-tone")).toBe("soon");
  });

  it("renders within-30 with upcoming tone", () => {
    render(<DueIndicator dueAt={offsetDays(25)} now={BASE} />);
    const el = screen.getByText(/in 25 days/i);
    const container = el.closest("[data-tone]");
    expect(container?.getAttribute("data-tone")).toBe("upcoming");
  });

  it("renders distant with muted tone", () => {
    render(<DueIndicator dueAt={offsetDays(90)} now={BASE} />);
    const el = screen.getByText(/in 90 days/i);
    const container = el.closest("[data-tone]");
    expect(container?.getAttribute("data-tone")).toBe("distant");
  });
});
