"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RegenerateButtonProps {
  fieldId: string;
  /**
   * Version of the draft currently displayed. Polling stops as soon as the
   * drafts-list endpoint reports a row with a higher version than this.
   */
  currentVersion: number | null;
  className?: string;
  /** Testing hooks. */
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type Status = "idle" | "requesting" | "polling" | "error" | "timeout";

/**
 * "Regenerate" button. POSTs to the draft-generation endpoint, then polls
 * the drafts-list endpoint every 2 seconds until a newer draft appears, up
 * to 90 seconds. On success, refreshes the route so the server component
 * re-fetches the new draft.
 *
 * Agent C owns the API routes. If the routes are not yet deployed at
 * merge time the POST will 404; the error is surfaced inline and the
 * button returns to idle.
 */
export function RegenerateButton({
  fieldId,
  currentVersion,
  className,
  pollIntervalMs = 2000,
  timeoutMs = 90000,
  fetchImpl,
}: RegenerateButtonProps) {
  const router = useRouter();
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const timersRef = React.useRef<{
    poll: ReturnType<typeof setInterval> | null;
    timeout: ReturnType<typeof setTimeout> | null;
  }>({ poll: null, timeout: null });

  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);

  const clearTimers = React.useCallback(() => {
    if (timersRef.current.poll) {
      clearInterval(timersRef.current.poll);
      timersRef.current.poll = null;
    }
    if (timersRef.current.timeout) {
      clearTimeout(timersRef.current.timeout);
      timersRef.current.timeout = null;
    }
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  async function checkForNewDraft(): Promise<boolean> {
    if (!doFetch) return false;
    try {
      const res = await doFetch(`/api/report-fields/${fieldId}/drafts`, {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { drafts?: Array<{ version: number }> };
      const latest = (body.drafts ?? []).reduce(
        (acc, d) => (d.version > acc ? d.version : acc),
        -Infinity,
      );
      if (!Number.isFinite(latest)) return false;
      if (currentVersion == null) return latest > 0;
      return latest > currentVersion;
    } catch {
      return false;
    }
  }

  async function onClick() {
    if (!doFetch) {
      setError("Network unavailable.");
      setStatus("error");
      return;
    }
    setError(null);
    setStatus("requesting");
    try {
      const res = await doFetch(`/api/report-fields/${fieldId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError(
          res.status === 404
            ? "Draft endpoint not yet deployed."
            : `Request failed (${res.status}).`,
        );
        setStatus("error");
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setStatus("error");
      return;
    }

    setStatus("polling");

    timersRef.current.poll = setInterval(async () => {
      const fresh = await checkForNewDraft();
      if (fresh) {
        clearTimers();
        setStatus("idle");
        router.refresh();
      }
    }, pollIntervalMs);

    timersRef.current.timeout = setTimeout(() => {
      clearTimers();
      setStatus("timeout");
      setError("Draft generation timed out after 90s. Try again.");
    }, timeoutMs);
  }

  const busy = status === "requesting" || status === "polling";
  const label =
    status === "requesting"
      ? "Starting…"
      : status === "polling"
        ? "Generating…"
        : "Regenerate";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        data-state={status}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{label}</span>
      </Button>
      {error ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="regenerate-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
