"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isParseInFlight,
  type DocumentWithChunkCount,
} from "@/lib/types/documents";

import { StatusBadge } from "./status-badge";

interface DocumentListProps {
  initialDocuments?: DocumentWithChunkCount[];
  onError?: (message: string) => void;
  refreshTick?: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const POLL_INTERVAL_MS = 3000;

export function DocumentList({
  initialDocuments = [],
  onError,
  refreshTick = 0,
}: DocumentListProps) {
  const [documents, setDocuments] =
    useState<DocumentWithChunkCount[]>(initialDocuments);
  const [loading, setLoading] = useState(initialDocuments.length === 0);
  const mountedRef = useRef(true);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      if (!res.ok) throw new Error(`List failed (${res.status})`);
      const body: { documents: DocumentWithChunkCount[] } = await res.json();
      if (mountedRef.current) setDocuments(body.documents ?? []);
    } catch (err) {
      // Silent on polling failures per the task spec.
      if (onError && err instanceof Error && loading) onError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [onError, loading]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchDocuments();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchDocuments]);

  // External refresh trigger (e.g., when an upload completes).
  useEffect(() => {
    if (refreshTick > 0) void fetchDocuments();
  }, [refreshTick, fetchDocuments]);

  // Poll while any doc is in flight.
  useEffect(() => {
    const hasInFlight = documents.some((d) => isParseInFlight(d.parse_status));
    if (!hasInFlight) return;
    const handle = setInterval(() => {
      if (mountedRef.current) void fetchDocuments();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [documents, fetchDocuments]);

  const onRename = useCallback(
    async (id: string, current: string) => {
      const next = window.prompt("New filename", current);
      if (!next || next === current) return;
      try {
        const res = await fetch(`/api/documents/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: next }),
        });
        if (!res.ok) throw new Error(`Rename failed (${res.status})`);
        await fetchDocuments();
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [fetchDocuments, onError],
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this document? This cannot be undone.")) return;
      try {
        const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Delete failed");
      }
    },
    [onError],
  );

  const onReparse = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/documents/${id}/reparse`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`Reparse failed (${res.status})`);
        await fetchDocuments();
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Reparse failed");
      }
    },
    [fetchDocuments, onError],
  );

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading documents...
      </p>
    );
  }

  if (documents.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Filename
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Uploaded
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Pages
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Size
            </th>
            <th scope="col" className="w-12 px-4 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {documents.map((doc) => (
            <tr key={doc.id} className={cn("bg-card")}>
              <td className="max-w-[320px] truncate px-4 py-2 font-medium">
                {doc.filename}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {formatDate(doc.created_at)}
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={doc.parse_status} error={doc.parse_error} />
              </td>
              <td className="px-4 py-2 tabular-nums text-muted-foreground">
                {doc.page_count ?? "—"}
              </td>
              <td className="px-4 py-2 tabular-nums text-muted-foreground">
                {formatBytes(doc.size_bytes)}
              </td>
              <td className="px-4 py-2 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${doc.filename}`}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[160px] rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
                  >
                    <DropdownMenuItem
                      className="cursor-pointer rounded px-2 py-1.5 outline-none hover:bg-accent"
                      onSelect={() => onRename(doc.id, doc.filename)}
                    >
                      Rename
                    </DropdownMenuItem>
                    {doc.parse_status === "failed" && (
                      <DropdownMenuItem
                        className="cursor-pointer rounded px-2 py-1.5 outline-none hover:bg-accent"
                        onSelect={() => onReparse(doc.id)}
                      >
                        Retry parse
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator className="my-1 h-px bg-border" />
                    <DropdownMenuItem
                      className="cursor-pointer rounded px-2 py-1.5 text-destructive outline-none hover:bg-destructive/10"
                      onSelect={() => onDelete(doc.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
