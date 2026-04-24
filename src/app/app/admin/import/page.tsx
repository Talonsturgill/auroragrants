"use client";

import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface FileProgress {
  name: string;
  status: "uploading" | "queued" | "failed";
  message?: string;
}

export default function AdminImportPage() {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    if (!file.name.endsWith(".zip")) {
      setFiles([{ name: file.name, status: "failed", message: "Only .zip files are accepted." }]);
      return;
    }

    setFiles([{ name: file.name, status: "uploading" }]);
    setUploading(true);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/import", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setFiles([{ name: file.name, status: "queued", message: (data as { message?: string }).message }]);
      } else {
        setFiles([{
          name: file.name,
          status: "failed",
          message: (data as { error?: string }).error ?? "Upload failed.",
        }]);
      }
    } catch {
      setFiles([{ name: file.name, status: "failed", message: "Network error." }]);
    } finally {
      setUploading(false);
    }
  }, []);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  const statusColor: Record<FileProgress["status"], string> = {
    uploading: "text-muted-foreground",
    queued: "text-green-700",
    failed: "text-destructive",
  };

  const statusLabel: Record<FileProgress["status"], string> = {
    uploading: "Uploading...",
    queued: "Queued for ingest",
    failed: "Failed",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">White-glove import</h1>
        <p className="text-sm text-muted-foreground">
          Upload a ZIP file containing PDFs. Each PDF will be parsed and
          ingested into the current tenant&apos;s workspace.
        </p>
      </div>

      <Card
        className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop zone for ZIP file upload"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
          disabled={uploading}
        />
        <p className="text-sm font-medium">
          {dragging ? "Drop your ZIP here" : "Drop a .zip file here, or click to select"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Maximum 200 MB. ZIP should contain PDF files.
        </p>
      </Card>

      {files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Import progress</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">File</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {files.map((f, i) => (
                  <tr key={i} className="bg-card">
                    <td className="px-4 py-2 font-mono text-xs">{f.name}</td>
                    <td className={`px-4 py-2 font-medium ${statusColor[f.status]}`}>
                      {statusLabel[f.status]}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{f.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiles([])}
          disabled={uploading}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
