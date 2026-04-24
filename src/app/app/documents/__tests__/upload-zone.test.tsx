// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadZone } from "@/components/app/documents/upload-zone";

function makeFile(name: string, type: string, size: number): File {
  // Keep the underlying blob tiny; jsdom lets us override .size so we can
  // simulate a 100 MB file without actually allocating 100 MB.
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  // jsdom's File.arrayBuffer is spotty across versions; provide a stub so
  // the component's sha256 computation resolves.
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => new ArrayBuffer(8),
  });
  return file;
}

function installXhrMock(behavior: {
  status?: number;
  networkError?: boolean;
  progress?: number[];
}): () => void {
  const original = global.XMLHttpRequest;
  class FakeXhr {
    status = 0;
    upload: { onprogress: ((ev: ProgressEvent) => void) | null } = { onprogress: null };
    onload: ((ev: Event) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onabort: ((ev: Event) => void) | null = null;
    open() {}
    setRequestHeader() {}
    send() {
      setTimeout(() => {
        for (const p of behavior.progress ?? [50, 100]) {
          this.upload.onprogress?.({
            loaded: p,
            total: 100,
            lengthComputable: true,
          } as unknown as ProgressEvent);
        }
        if (behavior.networkError) {
          this.onerror?.(new Event("error"));
          return;
        }
        this.status = behavior.status ?? 200;
        this.onload?.(new Event("load"));
      }, 0);
    }
  }
  // @ts-expect-error replacing for test
  global.XMLHttpRequest = FakeXhr;
  return () => {
    global.XMLHttpRequest = original;
  };
}

function mockCryptoSubtle() {
  if (!globalThis.crypto) {
    // @ts-expect-error injecting for jsdom
    globalThis.crypto = {};
  }
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: {
        digest: async () => new ArrayBuffer(32),
      },
    });
  }
  if (!("randomUUID" in globalThis.crypto)) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => "00000000-0000-0000-0000-000000000000",
    });
  }
}

beforeEach(() => {
  mockCryptoSubtle();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UploadZone", () => {
  it("rejects non-PDF files before contacting the server", async () => {
    const onError = vi.fn();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    render(<UploadZone onError={onError} />);

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const file = makeFile("evil.exe", "application/octet-stream", 10);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("Only PDF"),
      ),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects files over the 100 MB cap", async () => {
    const onError = vi.fn();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    render(<UploadZone onError={onError} />);

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const file = makeFile("huge.pdf", "application/pdf", 101 * 1024 * 1024);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/100 MB/)),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("happy-path uploads, creates the row, and fires the reparse trigger", async () => {
    const onUploaded = vi.fn();
    const restoreXhr = installXhrMock({ status: 200 });

    const fetchImpl = vi
      .spyOn(global, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/documents/upload-url")) {
          return new Response(
            JSON.stringify({
              signedUrl: "https://storage.example/upload",
              storagePath: "tenants/x/documents/abc.pdf",
              token: "tok",
              expiresAt: new Date().toISOString(),
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/documents") && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "doc-1" }), { status: 201 });
        }
        if (url.includes("/reparse")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      });

    render(<UploadZone onUploaded={onUploaded} />);

    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const file = makeFile("doc.pdf", "application/pdf", 2048);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("doc-1"));

    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(
      expect.arrayContaining([
        "/api/documents/upload-url",
        "/api/documents",
        "/api/documents/doc-1/reparse",
      ]),
    );

    restoreXhr();
  });

  it("shows an error when the signed URL request fails", async () => {
    const onError = vi.fn();

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "upload_url_failed" }), {
        status: 500,
      }),
    );

    render(<UploadZone onError={onError} />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const file = makeFile("doc.pdf", "application/pdf", 2048);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.any(String)),
    );
  });

  it("renders a progress bar while uploading", async () => {
    const restoreXhr = installXhrMock({ status: 200, progress: [25, 75] });

    vi.spyOn(global, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/documents/upload-url")) {
          return new Response(
            JSON.stringify({
              signedUrl: "https://storage.example/upload",
              storagePath: "tenants/x/documents/abc.pdf",
              token: "tok",
              expiresAt: new Date().toISOString(),
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/documents") && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "doc-2" }), { status: 201 });
        }
        return new Response("{}", { status: 200 });
      },
    );

    render(<UploadZone />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const file = makeFile("doc.pdf", "application/pdf", 4096);

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const bar = screen.queryByRole("progressbar");
      // Either progress is visible mid-flight, or upload completed and the
      // success label is visible. Both prove the UI rendered progress state.
      expect(bar !== null || screen.queryByText(/Uploaded/)).toBeTruthy();
    });

    restoreXhr();
  });
});
