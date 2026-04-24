// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: refreshMock,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { APPROVAL_ATTESTATION_PHRASE } from "@/lib/types/draft";

import { ApproveButton } from "../approve-button";

const FIELD_ID = "fffffff1-0000-0000-0000-000000000000";

beforeEach(() => {
  refreshMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ApproveButton", () => {
  it("keeps the confirm button disabled until the exact phrase is typed", async () => {
    render(
      <ApproveButton
        fieldId={FIELD_ID}
        fetchImpl={(async () => jsonRes({})) as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByTestId("approve-field-button"));

    const confirm = await screen.findByTestId("confirm-approve");
    expect(confirm.getAttribute("disabled")).not.toBeNull();

    const input = screen.getByTestId("attestation-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wrong phrase" } });
    expect(confirm.getAttribute("disabled")).not.toBeNull();

    fireEvent.change(input, {
      target: { value: APPROVAL_ATTESTATION_PHRASE },
    });
    expect(confirm.getAttribute("disabled")).toBeNull();
  });

  it("POSTs { signer_attestation: true } only after the phrase matches", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      // Record the body for assertion.
      const body = init ? JSON.parse(String(init.body)) : null;
      (fetchImpl as unknown as { lastBody: unknown }).lastBody = body;
      return jsonRes({ ok: true });
    });

    render(
      <ApproveButton
        fieldId={FIELD_ID}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByTestId("approve-field-button"));
    fireEvent.change(screen.getByTestId("attestation-input"), {
      target: { value: APPROVAL_ATTESTATION_PHRASE },
    });
    fireEvent.click(screen.getByTestId("confirm-approve"));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
    });

    const lastBody = (fetchImpl as unknown as { lastBody: unknown }).lastBody;
    expect(lastBody).toEqual({ signer_attestation: true });

    const [[url, init]] = fetchImpl.mock.calls;
    expect(String(url)).toContain(`/api/report-fields/${FIELD_ID}/approve`);
    expect((init as RequestInit).method).toBe("POST");
  });

  it("renders the already-approved state without a dialog", () => {
    render(<ApproveButton fieldId={FIELD_ID} alreadyApproved />);
    const btn = screen.getByRole("button", { name: /field approved/i });
    expect(btn.getAttribute("disabled")).not.toBeNull();
    expect(screen.queryByTestId("attestation-input")).toBeNull();
  });

  it("disables the open-dialog button when blocked by quality gate", () => {
    render(<ApproveButton fieldId={FIELD_ID} blocked />);
    const btn = screen.getByTestId("approve-field-button");
    expect(btn.getAttribute("disabled")).not.toBeNull();
  });

  it("surfaces a 403 as a not-designated-signer error", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({}, 403));

    render(
      <ApproveButton
        fieldId={FIELD_ID}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByTestId("approve-field-button"));
    fireEvent.change(screen.getByTestId("attestation-input"), {
      target: { value: APPROVAL_ATTESTATION_PHRASE },
    });
    fireEvent.click(screen.getByTestId("confirm-approve"));

    await waitFor(() => {
      expect(screen.getByTestId("approve-error").textContent).toMatch(
        /designated signer/i,
      );
    });
  });
});
