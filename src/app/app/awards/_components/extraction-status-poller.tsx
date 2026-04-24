"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  isExtractionTerminal,
  type ExtractionStatus,
} from "./extraction-badge";

interface ExtractionStatusPollerProps {
  awardId: string;
  currentStatus: ExtractionStatus;
  /**
   * How often to poll, in ms. Default 3000 per the task spec.
   */
  intervalMs?: number;
}

/**
 * Polls /api/awards/[id] every `intervalMs` while extraction is in flight.
 * When the status transitions to a terminal value (ok, manual_review, failed),
 * triggers a server component refresh so the award detail page re-renders
 * with the new status and any created reports.
 *
 * This component renders nothing visible. All status UI is handled by the
 * server page so that the detail view stays SSR-driven and shareable.
 */
export function ExtractionStatusPoller({
  awardId,
  currentStatus,
  intervalMs = 3000,
}: ExtractionStatusPollerProps) {
  const router = useRouter();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isExtractionTerminal(currentStatus)) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/awards/${awardId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          award?: { extraction_status?: ExtractionStatus };
        };
        const next = body.award?.extraction_status;
        if (!next) return;
        if (isExtractionTerminal(next) && !cancelled && mountedRef.current) {
          router.refresh();
        }
      } catch {
        // Silent on polling failures. The next tick will retry.
      }
    };

    const handle = setInterval(poll, intervalMs);
    // Also poll immediately so a fast-completing extraction flips quickly.
    void poll();

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [awardId, currentStatus, intervalMs, router]);

  return null;
}
