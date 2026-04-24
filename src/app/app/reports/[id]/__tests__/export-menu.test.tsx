// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportMenu } from "@/app/app/reports/[id]/_components/export-menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mkBlobResponse(
  body: string,
  filename: string,
  contentType: string,
  status = 200,
): Response {
  const blob = new Blob([body], { type: contentType });
  return new Response(blob, {
    status,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

describe("<ExportMenu>", () => {
  beforeEach(() => {
    // jsdom does not implement URL.createObjectURL; stub both.
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  it("renders a disabled trigger with a tooltip when the report is not ready", () => {
    render(<ExportMenu reportId="r-1" isReady={false} />);
    const btn = screen.getByTestId("export-menu-trigger-disabled");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("title")).toMatch(/approve all required fields/i);
  });

  it("does not open a menu when disabled trigger is clicked", () => {
    render(<ExportMenu reportId="r-1" isReady={false} />);
    const btn = screen.getByTestId("export-menu-trigger-disabled");
    fireEvent.click(btn);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a menu with three format options when ready", () => {
    render(<ExportMenu reportId="r-1" isReady={true} />);
    fireEvent.click(screen.getByTestId("export-menu-trigger"));
    const menu = screen.getByRole("menu");
    expect(menu).toBeDefined();
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBe(3);
    const formats = items.map((el) => el.getAttribute("data-format"));
    expect(formats).toContain("pdf");
    expect(formats).toContain("docx");
    expect(formats).toContain("text");
  });

  it("POSTs the selected format and triggers a download", async () => {
    const fetchSpy = vi.fn(async () =>
      mkBlobResponse(
        "hello",
        "rasmuson-report-2026-04-24.pdf",
        "application/pdf",
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Intercept anchor click so we can observe the download attempt without
    // the real jsdom navigator fighting us.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");

    render(<ExportMenu reportId="r-1" isReady={true} />);
    fireEvent.click(screen.getByTestId("export-menu-trigger"));
    const pdfItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.getAttribute("data-format") === "pdf");
    expect(pdfItem).toBeDefined();
    fireEvent.click(pdfItem as HTMLElement);

    // Allow the awaited fetch + blob parsing to resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [
      string | URL,
      RequestInit | undefined,
    ];
    const [url, init] = firstCall;
    expect(url).toBe("/api/reports/r-1/export");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ format: "pdf" });

    // A download was initiated.
    expect(clickSpy).toHaveBeenCalled();
  });

  it("sends format=docx when the DOCX option is clicked", async () => {
    const fetchSpy = vi.fn(async () =>
      mkBlobResponse(
        "docx-bytes",
        "rasmuson-report-2026-04-24.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportMenu reportId="r-2" isReady={true} />);
    fireEvent.click(screen.getByTestId("export-menu-trigger"));
    const docxItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.getAttribute("data-format") === "docx");
    fireEvent.click(docxItem as HTMLElement);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calls = fetchSpy.mock.calls as unknown as Array<
      [string | URL, RequestInit?]
    >;
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body).toEqual({ format: "docx" });
  });

  it("sends format=text when the plain-text option is clicked", async () => {
    const fetchSpy = vi.fn(async () =>
      mkBlobResponse("text", "x.txt", "text/plain; charset=utf-8"),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportMenu reportId="r-3" isReady={true} />);
    fireEvent.click(screen.getByTestId("export-menu-trigger"));
    const textItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.getAttribute("data-format") === "text");
    fireEvent.click(textItem as HTMLElement);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = fetchSpy.mock.calls as unknown as Array<
      [string | URL, RequestInit?]
    >;
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body).toEqual({ format: "text" });
  });

  it("surfaces an error message when the API returns non-2xx", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "not_ready" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<ExportMenu reportId="r-4" isReady={true} />);
    fireEvent.click(screen.getByTestId("export-menu-trigger"));
    const pdfItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.getAttribute("data-format") === "pdf");
    fireEvent.click(pdfItem as HTMLElement);

    // Wait for the rejection to propagate and render the alert.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/not_ready/);
  });
});
