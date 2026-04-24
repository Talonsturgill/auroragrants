// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DraftBanner } from "../draft-banner";

afterEach(() => {
  cleanup();
});

describe("DraftBanner", () => {
  it("renders the legally required wording and aria attributes", () => {
    const { container, getByRole } = render(<DraftBanner />);
    const banner = getByRole("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(container.textContent).toContain(
      "Draft, review before submission",
    );
  });

  it("defaults to the compact variant", () => {
    const { container } = render(<DraftBanner />);
    const banner = container.querySelector('div[data-variant]');
    expect(banner?.getAttribute("data-variant")).toBe("default");
  });

  it("renders extra copy in the expanded variant", () => {
    const { container } = render(<DraftBanner variant="expanded" />);
    const banner = container.querySelector('div[data-variant="expanded"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("explicit attestation");
  });

  it("always keeps the destructive border class, both variants", () => {
    const compact = render(<DraftBanner />).container.querySelector(
      'div[data-variant]',
    );
    cleanup();
    const expanded = render(
      <DraftBanner variant="expanded" />,
    ).container.querySelector('div[data-variant]');
    expect(compact?.className).toContain("border-destructive");
    expect(expanded?.className).toContain("border-destructive");
  });
});
