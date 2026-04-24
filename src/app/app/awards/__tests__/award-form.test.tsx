// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { AwardForm } from "../_components/award-form";

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const FUNDER_ID = "22222222-2222-2222-2222-222222222222";

const documents = [
  { id: DOC_ID, filename: "rasmuson-tier1.pdf", kind: "nofo" },
];
const funders = [
  { id: FUNDER_ID, name: "Rasmuson Foundation", type: "foundation" },
];

function typeInto(id: string, value: string) {
  const input = document.getElementById(id) as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  if (!input) throw new Error(`missing input ${id}`);
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AwardForm", () => {
  it("surfaces required-field errors when submitted empty", async () => {
    render(<AwardForm documents={documents} funders={funders} />);
    const submit = screen.getByRole("button", { name: /register award/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByTestId("error-source_document_id")).toBeTruthy();
      expect(screen.getByTestId("error-funder_id")).toBeTruthy();
      expect(screen.getByTestId("error-program_name")).toBeTruthy();
      expect(screen.getByTestId("error-amount_usd")).toBeTruthy();
      expect(screen.getByTestId("error-awarded_at")).toBeTruthy();
      expect(screen.getByTestId("error-period_start")).toBeTruthy();
      expect(screen.getByTestId("error-period_end")).toBeTruthy();
    });
  });

  it("rejects period_end that is not after period_start", async () => {
    render(<AwardForm documents={documents} funders={funders} />);

    typeInto("source_document_id", DOC_ID);
    typeInto("funder_id", FUNDER_ID);
    typeInto("program_name", "Tier 1 Community Support");
    typeInto("amount_usd", "25000");
    typeInto("awarded_at", "2026-04-01");
    typeInto("period_start", "2026-05-01");
    typeInto("period_end", "2026-05-01");

    fireEvent.click(screen.getByRole("button", { name: /register award/i }));

    await waitFor(() => {
      const err = screen.getByTestId("error-period_end");
      expect(err.textContent ?? "").toMatch(/after period start/i);
    });
  });

  it("rejects non-positive amounts", async () => {
    render(<AwardForm documents={documents} funders={funders} />);

    typeInto("source_document_id", DOC_ID);
    typeInto("funder_id", FUNDER_ID);
    typeInto("program_name", "Program");
    typeInto("amount_usd", "0");
    typeInto("awarded_at", "2026-04-01");
    typeInto("period_start", "2026-05-01");
    typeInto("period_end", "2027-05-01");

    fireEvent.click(screen.getByRole("button", { name: /register award/i }));

    await waitFor(() => {
      expect(screen.getByTestId("error-amount_usd")).toBeTruthy();
    });
  });

  it("submits a valid payload and redirects to the detail page", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "award-1" }), { status: 201 }),
      );

    render(<AwardForm documents={documents} funders={funders} />);

    typeInto("source_document_id", DOC_ID);
    typeInto("funder_id", FUNDER_ID);
    typeInto("program_name", "Tier 1");
    typeInto("amount_usd", "25000");
    typeInto("awarded_at", "2026-04-01");
    typeInto("period_start", "2026-05-01");
    typeInto("period_end", "2027-05-01");

    fireEvent.click(screen.getByRole("button", { name: /register award/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/awards/award-1");
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/awards",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.source_document_id).toBe(DOC_ID);
    expect(body.funder_id).toBe(FUNDER_ID);
    expect(body.amount_usd).toBe(25000);
  });

  it("applies API-returned 400 fieldErrors inline", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_body",
          details: {
            fieldErrors: { program_name: ["Program name is taken."] },
          },
        }),
        { status: 400 },
      ),
    );

    render(<AwardForm documents={documents} funders={funders} />);

    typeInto("source_document_id", DOC_ID);
    typeInto("funder_id", FUNDER_ID);
    typeInto("program_name", "Tier 1");
    typeInto("amount_usd", "25000");
    typeInto("awarded_at", "2026-04-01");
    typeInto("period_start", "2026-05-01");
    typeInto("period_end", "2027-05-01");

    fireEvent.click(screen.getByRole("button", { name: /register award/i }));

    await waitFor(() => {
      const err = screen.getByTestId("error-program_name");
      expect(err.textContent ?? "").toContain("Program name is taken");
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
