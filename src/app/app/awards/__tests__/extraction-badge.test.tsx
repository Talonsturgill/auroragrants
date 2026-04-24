// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ExtractionBadge,
  type ExtractionStatus,
} from "../_components/extraction-badge";

afterEach(() => {
  cleanup();
});

const CASES: Array<{
  status: ExtractionStatus;
  label: string;
  // A class token unique to this status's palette. Asserting on the
  // class ensures each state renders its own color family (gray / blue /
  // green / amber / red).
  colorToken: string;
  srLabel: string;
}> = [
  {
    status: "pending",
    label: "Pending",
    colorToken: "bg-slate-200",
    srLabel: "Extraction pending",
  },
  {
    status: "running",
    label: "Running",
    colorToken: "bg-sky-200",
    srLabel: "Extraction in progress",
  },
  {
    status: "ok",
    label: "Extracted",
    colorToken: "bg-emerald-200",
    srLabel: "Extraction complete",
  },
  {
    status: "manual_review",
    label: "Manual review",
    colorToken: "bg-amber-200",
    srLabel: "Extraction needs manual review",
  },
  {
    status: "failed",
    label: "Failed",
    colorToken: "bg-red-200",
    srLabel: "Extraction failed",
  },
];

describe("ExtractionBadge", () => {
  it.each(CASES)(
    "renders $status with its color token and accessible label",
    ({ status, label, colorToken, srLabel }) => {
      const { container } = render(<ExtractionBadge status={status} />);
      const badge = container.querySelector(`[data-status="${status}"]`);
      expect(badge).not.toBeNull();
      expect(badge?.className).toContain(colorToken);
      expect(badge?.getAttribute("aria-label")).toBe(srLabel);
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it("shows the error text in the hover title when failed", () => {
    const { container } = render(
      <ExtractionBadge status="failed" error="Schema validation failed" />,
    );
    const badge = container.querySelector('[data-status="failed"]');
    expect(badge?.getAttribute("title")).toBe("Schema validation failed");
  });

  it("shows the error text in the hover title when manual_review", () => {
    const { container } = render(
      <ExtractionBadge
        status="manual_review"
        error="Requirements JSON rejected twice"
      />,
    );
    const badge = container.querySelector('[data-status="manual_review"]');
    expect(badge?.getAttribute("title")).toBe("Requirements JSON rejected twice");
  });

  it("applies spin animation only while running", () => {
    const runningRender = render(<ExtractionBadge status="running" />);
    const runningIcon = runningRender.container.querySelector("svg");
    expect(runningIcon?.getAttribute("class") ?? "").toContain("animate-spin");
    cleanup();

    const okRender = render(<ExtractionBadge status="ok" />);
    const okIcon = okRender.container.querySelector("svg");
    expect(okIcon?.getAttribute("class") ?? "").not.toContain("animate-spin");
  });
});
