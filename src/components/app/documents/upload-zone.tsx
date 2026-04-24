"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp, UploadCloud, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
  type UploadResponse,
} from "@/lib/types/documents";

interface UploadZoneProps {
  onUploaded?: (documentId: string) => void;
  onError?: (message: string) => void;
}

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

const ACCEPT_ATTR = ALLOWED_DOCUMENT_MIME_TYPES.join(",");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as "application/pdf")) {
    return "Only PDF files are supported";
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return `File exceeds ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB limit`;
  }
  if (file.size === 0) {
    return "File is empty";
  }
  return null;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function putWithProgress(
  url: string,
  file: File,
  token: string | undefined,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", file.type);
    if (token) {
      // Supabase accepts the token embedded in the signed URL, but some
      // configurations expect it as a bearer. Belt-and-suspenders.
      xhr.setRequestHeader("x-upsert", "false");
    }
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress((ev.loaded / ev.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413)
        reject(new Error("File too large for storage"));
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(file);
  });
}

export function UploadZone({ onUploaded, onError }: UploadZoneProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const updateItem = useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      try {
        updateItem(item.id, { status: "uploading", progress: 0 });

        // 1. Ask the server for a signed upload URL.
        const uploadRes = await fetch("/api/documents/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: item.file.name,
            content_type: item.file.type,
            size_bytes: item.file.size,
          }),
        });
        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => ({}));
          throw new Error(body?.error ?? `Upload URL request failed (${uploadRes.status})`);
        }
        const upload: UploadResponse = await uploadRes.json();

        // 2. PUT the file bytes directly to Supabase Storage.
        await putWithProgress(upload.signedUrl, item.file, upload.token, (pct) =>
          updateItem(item.id, { progress: pct }),
        );

        // 3. Compute sha256 client-side for the document row. Matches the
        //    worker's hash so we can dedupe later.
        const sha256 = await sha256Hex(item.file);

        // 4. Create the DB row; this kicks off `parse_status = 'queued'`.
        const createRes = await fetch("/api/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: item.file.name,
            mime_type: item.file.type,
            size_bytes: item.file.size,
            storage_path: upload.storagePath,
            sha256,
            upload_token: upload.token,
          }),
        });
        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          throw new Error(body?.error ?? `Create document failed (${createRes.status})`);
        }
        const created: { id: string } = await createRes.json();

        // 5. Fire-and-forget reparse trigger so the worker starts.
        void fetch(`/api/documents/${created.id}/reparse`, { method: "POST" });

        updateItem(item.id, { status: "success", progress: 100 });
        onUploaded?.(created.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        updateItem(item.id, { status: "error", error: message });
        onError?.(message);
      }
    },
    [onUploaded, onError, updateItem],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const next: UploadItem[] = [];
      for (const file of Array.from(files)) {
        const err = validateFile(file);
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        if (err) {
          next.push({ id, file, progress: 0, status: "error", error: err });
          onError?.(err);
        } else {
          next.push({ id, file, progress: 0, status: "pending" });
        }
      }
      setItems((prev) => [...prev, ...next]);
      for (const item of next) {
        if (item.status === "pending") void uploadOne(item);
      }
    },
    [onError, uploadOne],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const retry = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item && item.status === "error" && !validateFile(item.file)) {
        void uploadOne(item);
      }
    },
    [items, uploadOne],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  return (
    <div className="space-y-4">
      <label
        htmlFor="document-upload-input"
        aria-label="Upload PDF documents"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-muted/30 p-10 text-center transition-colors",
          "hover:bg-muted/50 focus-within:border-primary focus-within:bg-muted/50",
          isDragging && "border-primary bg-muted/60",
        )}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Drop PDFs here or click to browse</p>
          <p className="text-xs text-muted-foreground">
            PDF only. Up to {MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB per file.
          </p>
        </div>
        <input
          id="document-upload-input"
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
          data-testid="upload-input"
        />
      </label>

      {items.length > 0 && (
        <ul
          className="space-y-2"
          aria-label="Current uploads"
          data-testid="upload-list"
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
            >
              <FileUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{item.file.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(item.file.size)}
                  </span>
                </div>
                {item.status === "uploading" && (
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(item.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.status === "success" && (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Uploaded. Parsing will begin shortly.
                  </p>
                )}
                {item.status === "error" && (
                  <p className="mt-1 text-xs text-destructive">{item.error}</p>
                )}
              </div>
              {item.status === "error" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retry(item.id)}
                  aria-label={`Retry upload of ${item.file.name}`}
                >
                  Retry
                </Button>
              )}
              {(item.status === "success" || item.status === "error") && (
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={`Dismiss ${item.file.name}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
