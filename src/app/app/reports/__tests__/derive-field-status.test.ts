import { describe, expect, it } from "vitest";

import { deriveFieldStatus } from "@/lib/types/reports";

describe("deriveFieldStatus", () => {
  it("returns 'approved' when human_approved is true", () => {
    expect(
      deriveFieldStatus({
        human_approved: true,
        current_value: "anything",
        draft_value: "anything",
      }),
    ).toBe("approved");

    // Even with no values, if flagged approved, honor the flag.
    expect(
      deriveFieldStatus({
        human_approved: true,
        current_value: null,
        draft_value: null,
      }),
    ).toBe("approved");
  });

  it("returns 'ready_for_review' when current_value is set and not approved", () => {
    expect(
      deriveFieldStatus({
        human_approved: false,
        current_value: "Final narrative paragraph.",
        draft_value: "older draft",
      }),
    ).toBe("ready_for_review");
  });

  it("returns 'drafting' when only draft_value is set", () => {
    expect(
      deriveFieldStatus({
        human_approved: false,
        current_value: null,
        draft_value: "Writer output iteration 1.",
      }),
    ).toBe("drafting");
  });

  it("returns 'not_started' when nothing is set", () => {
    expect(
      deriveFieldStatus({
        human_approved: false,
        current_value: null,
        draft_value: null,
      }),
    ).toBe("not_started");
  });

  it("treats empty strings the same as null", () => {
    expect(
      deriveFieldStatus({
        human_approved: false,
        current_value: "",
        draft_value: "",
      }),
    ).toBe("not_started");
  });
});
