import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase admin client before importing the module under test so
// the module-level import graph doesn't try to reach the real service-role
// key.
const mockCreateSignedUploadUrl = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockRemove = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== "documents") throw new Error(`unexpected bucket ${bucket}`);
        return {
          createSignedUploadUrl: mockCreateSignedUploadUrl,
          createSignedUrl: mockCreateSignedUrl,
          remove: mockRemove,
        };
      },
    },
  }),
}));

// jose needs a secret. Set one before importing the module so upload-token
// signers (exported from the same file) are exercisable.
process.env.UPLOAD_TOKEN_SECRET = "test-upload-token-secret-32-bytes!!";

import {
  buildStoragePath,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  DOCUMENTS_BUCKET,
  sanitizeFilename,
  signUploadToken,
  verifyUploadToken,
} from "./storage";

const TENANT = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  mockCreateSignedUploadUrl.mockReset();
  mockCreateSignedUrl.mockReset();
  mockRemove.mockReset();
});

describe("sanitizeFilename", () => {
  it("accepts a normal filename", () => {
    expect(sanitizeFilename("Rasmuson-Tier1.pdf")).toBe("Rasmuson-Tier1.pdf");
  });

  it("rejects empty and missing", () => {
    expect(() => sanitizeFilename("")).toThrow(/required/);
    // @ts-expect-error testing bad input
    expect(() => sanitizeFilename(undefined)).toThrow(/required/);
  });

  it("rejects path separators", () => {
    expect(() => sanitizeFilename("a/b.pdf")).toThrow(/path separator/);
    expect(() => sanitizeFilename("a\\b.pdf")).toThrow(/path separator/);
  });

  it("rejects traversal", () => {
    expect(() => sanitizeFilename("../etc/passwd")).toThrow(/path/);
  });

  it("rejects overly long names", () => {
    expect(() => sanitizeFilename("a".repeat(256))).toThrow(/too long/);
  });
});

describe("buildStoragePath", () => {
  it("generates a tenant-scoped path", () => {
    const p = buildStoragePath(TENANT);
    expect(p.startsWith(`tenants/${TENANT}/documents/`)).toBe(true);
    expect(p.endsWith(".pdf")).toBe(true);
  });

  it("requires a tenant", () => {
    expect(() => buildStoragePath("")).toThrow(/tenantId/);
  });
});

describe("createUploadUrl", () => {
  it("calls Supabase with the generated path and returns the signed URL", async () => {
    mockCreateSignedUploadUrl.mockResolvedValue({
      data: {
        signedUrl: "https://storage.example/upload",
        token: "upload-token",
        path: "ignored",
      },
      error: null,
    });

    const result = await createUploadUrl(TENANT, "report.pdf");

    expect(mockCreateSignedUploadUrl).toHaveBeenCalledTimes(1);
    const calledWithPath = mockCreateSignedUploadUrl.mock.calls[0][0];
    expect(calledWithPath).toContain(`tenants/${TENANT}/documents/`);
    expect(result.signedUrl).toBe("https://storage.example/upload");
    expect(result.storagePath).toBe(calledWithPath);
    expect(result.token).toBe("upload-token");
    expect(DOCUMENTS_BUCKET).toBe("documents");
  });

  it("surfaces Supabase errors", async () => {
    mockCreateSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    await expect(createUploadUrl(TENANT, "x.pdf")).rejects.toThrow(/boom/);
  });

  it("rejects bad filenames before calling Supabase", async () => {
    await expect(createUploadUrl(TENANT, "../x.pdf")).rejects.toThrow();
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("createDownloadUrl", () => {
  it("passes the TTL to Supabase", async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/d" },
      error: null,
    });
    const res = await createDownloadUrl(
      TENANT,
      `tenants/${TENANT}/documents/abc.pdf`,
      900,
    );
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      `tenants/${TENANT}/documents/abc.pdf`,
      900,
    );
    expect(res.signedUrl).toBe("https://storage.example/d");
    expect(typeof res.expiresAt).toBe("string");
  });

  it("defaults to a 1h TTL", async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://x" },
      error: null,
    });
    await createDownloadUrl(TENANT, `tenants/${TENANT}/documents/a.pdf`);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(expect.any(String), 3600);
  });

  it("refuses to sign paths outside the tenant prefix", async () => {
    await expect(
      createDownloadUrl(TENANT, `tenants/other/documents/a.pdf`),
    ).rejects.toThrow(/not owned/);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });
});

describe("deleteObject", () => {
  it("is a noop for empty paths", async () => {
    await deleteObject("");
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("treats not_found as success", async () => {
    mockRemove.mockResolvedValue({ error: { message: "object not found" } });
    await expect(deleteObject("tenants/x/documents/a.pdf")).resolves.toBeUndefined();
  });

  it("surfaces other errors", async () => {
    mockRemove.mockResolvedValue({ error: { message: "permission denied" } });
    await expect(
      deleteObject("tenants/x/documents/a.pdf"),
    ).rejects.toThrow(/permission denied/);
  });

  it("is idempotent across duplicate calls", async () => {
    mockRemove.mockResolvedValue({ error: null });
    await deleteObject("tenants/x/documents/a.pdf");
    await deleteObject("tenants/x/documents/a.pdf");
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});

describe("upload token", () => {
  it("round-trips claims", async () => {
    const token = await signUploadToken(TENANT, "tenants/x/documents/a.pdf", 42);
    const claims = await verifyUploadToken(token);
    expect(claims).toEqual({
      tenant_id: TENANT,
      storage_path: "tenants/x/documents/a.pdf",
      size_bytes: 42,
    });
  });

  it("returns null for tampered tokens", async () => {
    const token = await signUploadToken(TENANT, "tenants/x/documents/a.pdf", 42);
    const tampered = token.slice(0, -4) + "AAAA";
    expect(await verifyUploadToken(tampered)).toBeNull();
  });
});
