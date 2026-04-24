// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Critique } from "@/lib/types/draft";

import { CriticPanel } from "../critic-panel";

afterEach(() => {
  cleanup();
});

const CRITIQUE: Critique = {
  overall_score: 8.4,
  ready_to_surface: true,
  rubric_scores: [
    {
      rubric_item_id: "impact",
      label: "Impact",
      score: 2,
      justification: "Claims are specific, quantified, and cited.",
    },
    {
      rubric_item_id: "budget_alignment",
      label: "Budget alignment",
      score: 1,
      justification: "Variance is described but lacks a reconciliation.",
    },
    {
      rubric_item_id: "boilerplate",
      label: "Originality",
      score: 0,
      justification: "Opening paragraph reads as boilerplate.",
    },
  ],
  fixes: [
    {
      id: "fix-1",
      severity: "high",
      description: "Replace the boilerplate opening with a concrete case.",
    },
    {
      id: "fix-2",
      severity: "medium",
      description: "Add the reconciliation line for the budget variance.",
    },
    {
      id: "fix-3",
      severity: "low",
      description: "Remove the extra space before the closing period.",
    },
  ],
};

describe("CriticPanel", () => {
  it("renders the overall score as an accessible gauge", () => {
    render(<CriticPanel critique={CRITIQUE} />);
    const gauge = screen.getByRole("img", {
      name: /overall critic score 8\.4 out of 10/i,
    });
    expect(gauge).toBeTruthy();
  });

  it("renders one rubric row per rubric item with correct score badges", () => {
    const { container } = render(<CriticPanel critique={CRITIQUE} />);
    const rows = container.querySelectorAll("tr[data-rubric-id]");
    expect(rows.length).toBe(3);
    const scores = Array.from(
      container.querySelectorAll("span[data-score]"),
    ).map((el) => el.getAttribute("data-score"));
    expect(scores).toEqual(["2", "1", "0"]);
  });

  it("groups fixes by severity in high/medium/low order", () => {
    const { container } = render(<CriticPanel critique={CRITIQUE} />);
    const groups = container.querySelectorAll("[data-severity-group]");
    const order = Array.from(groups).map((g) =>
      g.getAttribute("data-severity-group"),
    );
    expect(order).toEqual(["high", "medium", "low"]);
  });

  it("shows a no-fixes message when critique.fixes is empty", () => {
    const empty: Critique = { ...CRITIQUE, fixes: [] };
    render(<CriticPanel critique={empty} />);
    const msg = screen.getByTestId("no-fixes");
    expect(msg.textContent).toMatch(/no fixes/i);
  });

  it("renders an empty-state copy when no critique is available", () => {
    render(<CriticPanel critique={null} />);
    expect(screen.getByText(/no critic run yet/i)).toBeTruthy();
  });

  it("color-codes fixes by severity via data-severity attribute", () => {
    const { container } = render(<CriticPanel critique={CRITIQUE} />);
    const high = container.querySelector('li[data-severity="high"]');
    const med = container.querySelector('li[data-severity="medium"]');
    const low = container.querySelector('li[data-severity="low"]');
    expect(high).not.toBeNull();
    expect(med).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high?.textContent).toContain("High");
    expect(med?.textContent).toContain("Medium");
    expect(low?.textContent).toContain("Low");
  });
});
