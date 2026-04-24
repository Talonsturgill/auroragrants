// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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

import { RegenerateButton } from "../regenerate-button";

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

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RegenerateButton", () => {
  it("POSTs to /draft and polls /drafts until a newer version appears", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/draft") && init?.method === "POST") {
        return jsonRes({ job_id: "j-1" });
      }
      if (u.endsWith("/drafts")) {
        return jsonRes({ drafts: [{ version: 3 }] });
      }
      throw new Error(`unexpected ${u}`);
    });

    render(
      <RegenerateButton
        fieldId={FIELD_ID}
        currentVersion={2}
        pollIntervalMs={100}
        timeoutMs={5000}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await flushMicrotasks();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    await flushMicrotasks();

    expect(refreshMock).toHaveBeenCalledTimes(1);

    const posts = fetchImpl.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    const gets = fetchImpl.mock.calls.filter(
      ([url]) => String(url).endsWith("/drafts"),
    );
    expect(posts.length).toBe(1);
    expect(gets.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });

  it("shows the generating label while polling", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/draft") && init?.method === "POST") {
        return jsonRes({ job_id: "j-1" });
      }
      return jsonRes({ drafts: [{ version: 1 }] });
    });

    render(
      <RegenerateButton
        fieldId={FIELD_ID}
        currentVersion={5}
        pollIntervalMs={10000}
        timeoutMs={30000}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await flushMicrotasks();

    const btn = screen.getByRole("button");
    expect(btn.getAttribute("data-state")).toBe("polling");
    expect(btn.textContent).toContain("Generating");

    vi.useRealTimers();
  });

  it("falls into a timeout state after timeoutMs with a visible error", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/draft") && init?.method === "POST") {
        return jsonRes({ job_id: "j-1" });
      }
      return jsonRes({ drafts: [] });
    });

    render(
      <RegenerateButton
        fieldId={FIELD_ID}
        currentVersion={null}
        pollIntervalMs={5000}
        timeoutMs={100}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await flushMicrotasks();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("regenerate-error").textContent ?? "").toMatch(
      /timed out/i,
    );

    vi.useRealTimers();
  });

  it("surfaces a 404 as a friendly not-deployed error", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({}, 404));

    render(
      <RegenerateButton
        fieldId={FIELD_ID}
        currentVersion={null}
        pollIntervalMs={1000}
        timeoutMs={5000}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await flushMicrotasks();

    expect(screen.getByTestId("regenerate-error").textContent ?? "").toMatch(
      /not yet deployed/i,
    );
  });
});
